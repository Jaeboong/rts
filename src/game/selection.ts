import { CELL, type Entity } from '../types';
import type { World } from './world';

export function clearSelection(world: World): void {
  world.selection.clear();
}

export function applyClick(
  world: World,
  wx: number,
  wy: number,
  shift: boolean,
): void {
  const hit = pickEntityAt(world, wx, wy);
  if (!hit) {
    if (!shift) world.selection.clear();
    return;
  }
  if (shift) {
    if (world.selection.has(hit.id)) world.selection.delete(hit.id);
    else world.selection.add(hit.id);
  } else {
    world.selection.clear();
    world.selection.add(hit.id);
  }
}

export function applyDragBox(
  world: World,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  shift: boolean,
): void {
  const x0 = Math.min(ax, bx);
  const x1 = Math.max(ax, bx);
  const y0 = Math.min(ay, by);
  const y1 = Math.max(ay, by);

  const ids: number[] = [];
  for (const e of world.entities.values()) {
    if (!isSelectableUnit(e)) continue;
    if (e.team !== 'player') continue; // drag selects own units only
    if (e.pos.x >= x0 && e.pos.x <= x1 && e.pos.y >= y0 && e.pos.y <= y1) {
      ids.push(e.id);
    }
  }

  // If the drag selected nothing belonging to the player, fall through:
  // try player buildings too (still own only).
  if (ids.length === 0) {
    if (!shift) world.selection.clear();
    return;
  }

  if (!shift) world.selection.clear();
  for (const id of ids) world.selection.add(id);
}

export function pickEntityAt(
  world: World,
  wx: number,
  wy: number,
): Entity | null {
  // Prefer units (smaller, on top), then buildings, then resources.
  let best: Entity | null = null;
  let bestPriority = -1;
  for (const e of world.entities.values()) {
    const hit = hitTest(e, wx, wy);
    if (!hit) continue;
    const pri = priority(e);
    if (pri > bestPriority) {
      best = e;
      bestPriority = pri;
    }
  }
  return best;
}

function priority(e: Entity): number {
  if (isUnit(e)) return 3;
  if (isBuilding(e)) return 2;
  if (e.kind === 'mineralNode') return 1;
  return 0;
}

function hitTest(e: Entity, wx: number, wy: number): boolean {
  if (isUnit(e)) {
    const r = e.radius ?? 10;
    return Math.hypot(wx - e.pos.x, wy - e.pos.y) <= r + 2;
  }
  if (isBuilding(e) || e.kind === 'mineralNode') {
    if (e.cellX === undefined || e.cellY === undefined || !e.sizeW || !e.sizeH) {
      return false;
    }
    const x0 = e.cellX * CELL;
    const y0 = e.cellY * CELL;
    const x1 = (e.cellX + e.sizeW) * CELL;
    const y1 = (e.cellY + e.sizeH) * CELL;
    return wx >= x0 && wx <= x1 && wy >= y0 && wy <= y1;
  }
  return false;
}

function isUnit(e: Entity): boolean {
  return e.kind === 'worker' || e.kind === 'marine' || e.kind === 'enemyDummy';
}

function isBuilding(e: Entity): boolean {
  return (
    e.kind === 'commandCenter' || e.kind === 'barracks' || e.kind === 'turret'
  );
}

function isSelectableUnit(e: Entity): boolean {
  return isUnit(e);
}
