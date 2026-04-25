import { GRID_W, type Entity } from '../types';
import { cellToPx, inBounds, isCellBlocked, pxToCell, type World } from './world';

const SEARCH_RADIUS_PAD = 10;

/**
 * After placing a building, teleport any units whose cell falls inside the
 * footprint to the nearest walkable cell outside it. Preserves command/path/
 * gather state — separation + repath handle post-displacement overlap.
 */
export function displaceUnitsFromFootprint(
  world: World,
  cellX: number,
  cellY: number,
  sizeW: number,
  sizeH: number,
): void {
  const claimed = new Set<number>();
  for (const e of world.entities.values()) {
    if (!isUnit(e)) continue;
    const cell = pxToCell(e.pos);
    if (
      cell.x < cellX ||
      cell.x >= cellX + sizeW ||
      cell.y < cellY ||
      cell.y >= cellY + sizeH
    ) {
      continue;
    }
    const dest = nearestWalkableOutsideFootprint(
      world,
      cell.x,
      cell.y,
      cellX,
      cellY,
      sizeW,
      sizeH,
      claimed,
    );
    if (!dest) continue;
    claimed.add(dest.y * GRID_W + dest.x);
    e.pos = cellToPx(dest.x, dest.y);
  }
}

function nearestWalkableOutsideFootprint(
  world: World,
  fromX: number,
  fromY: number,
  cellX: number,
  cellY: number,
  sizeW: number,
  sizeH: number,
  claimed: Set<number>,
): { x: number; y: number } | null {
  const maxR = Math.max(sizeW, sizeH) + SEARCH_RADIUS_PAD;
  for (let r = 1; r <= maxR; r++) {
    const ring = collectRing(fromX, fromY, r);
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const c of ring) {
      if (!inBounds(c.x, c.y)) continue;
      // Inside-footprint cells are occupancy-blocked anyway; explicit check guards
      // against walkable interior (e.g. refinery's geyser cells share the id).
      if (
        c.x >= cellX &&
        c.x < cellX + sizeW &&
        c.y >= cellY &&
        c.y < cellY + sizeH
      ) {
        continue;
      }
      if (isCellBlocked(world, c.x, c.y)) continue;
      if (claimed.has(c.y * GRID_W + c.x)) continue;
      const dx = c.x - fromX;
      const dy = c.y - fromY;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        best = c;
        bestD = d;
      }
    }
    if (best) return best;
  }
  return null;
}

function collectRing(cx: number, cy: number, r: number): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let x = cx - r; x <= cx + r; x++) {
    out.push({ x, y: cy - r });
    out.push({ x, y: cy + r });
  }
  for (let y = cy - r + 1; y <= cy + r - 1; y++) {
    out.push({ x: cx - r, y });
    out.push({ x: cx + r, y });
  }
  return out;
}

function isUnit(e: Entity): boolean {
  return (
    e.kind === 'worker' ||
    e.kind === 'marine' ||
    e.kind === 'tank' ||
    e.kind === 'tank-light' ||
    e.kind === 'medic' ||
    e.kind === 'enemyDummy'
  );
}
