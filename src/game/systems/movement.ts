import type { Entity, Vec2 } from '../../types';
import { findPath } from '../pathfinding';
import { inBounds, isCellBlocked, pxToCell, type World } from '../world';

const REPATH_INTERVAL = 0.5;
const repathTimer = new Map<number, number>();

export function movementSystem(world: World, dt: number): void {
  for (const e of world.entities.values()) {
    if (!isUnit(e)) continue;
    if (!e.path || e.path.length === 0) continue;
    if (!e.speed) continue;

    let remaining = e.speed * dt;
    while (remaining > 0 && e.path.length > 0) {
      const wp = e.path[0];
      const dx = wp.x - e.pos.x;
      const dy = wp.y - e.pos.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= remaining + 0.001) {
        e.pos.x = wp.x;
        e.pos.y = wp.y;
        e.path.shift();
        remaining -= dist;
      } else {
        e.pos.x += (dx / dist) * remaining;
        e.pos.y += (dy / dist) * remaining;
        remaining = 0;
      }
    }
  }
  // tick repath timers
  for (const [id, t] of repathTimer) {
    const nt = t - dt;
    if (nt <= 0) repathTimer.delete(id);
    else repathTimer.set(id, nt);
  }
}

export function requestPath(
  world: World,
  unit: Entity,
  target: Vec2,
  ignoreId: number = -1,
): boolean {
  const from = pxToCell(unit.pos);
  const to = pxToCell(target);
  const path = findPath(world, from.x, from.y, to.x, to.y, ignoreId);
  if (!path) {
    unit.path = null;
    return false;
  }
  unit.path = path;
  unit.pathTargetCell = { x: to.x, y: to.y };
  return true;
}

/**
 * Path to a cell adjacent to the target entity (mineral node or building).
 * Returns true if a path was found.
 */
export function requestPathAdjacent(
  world: World,
  unit: Entity,
  target: Entity,
): boolean {
  const from = pxToCell(unit.pos);
  const adj = bestAdjacentCell(world, target, from);
  if (!adj) {
    unit.path = null;
    return false;
  }
  const path = findPath(world, from.x, from.y, adj.x, adj.y);
  if (!path) {
    unit.path = null;
    return false;
  }
  unit.path = path;
  unit.pathTargetCell = adj;
  return true;
}

export function bestAdjacentCell(
  world: World,
  target: Entity,
  from: { x: number; y: number },
): { x: number; y: number } | null {
  if (target.cellX === undefined || target.cellY === undefined) return null;
  const w = target.sizeW ?? 1;
  const h = target.sizeH ?? 1;
  const cells: Array<{ x: number; y: number }> = [];
  // Perimeter ring
  for (let x = target.cellX - 1; x <= target.cellX + w; x++) {
    cells.push({ x, y: target.cellY - 1 });
    cells.push({ x, y: target.cellY + h });
  }
  for (let y = target.cellY; y < target.cellY + h; y++) {
    cells.push({ x: target.cellX - 1, y });
    cells.push({ x: target.cellX + w, y });
  }
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (const c of cells) {
    if (!inBounds(c.x, c.y)) continue;
    if (isCellBlocked(world, c.x, c.y)) continue;
    const dx = c.x - from.x;
    const dy = c.y - from.y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

export function shouldRepath(id: number): boolean {
  if (repathTimer.has(id)) return false;
  repathTimer.set(id, REPATH_INTERVAL);
  return true;
}

function isUnit(e: Entity): boolean {
  return e.kind === 'worker' || e.kind === 'marine' || e.kind === 'enemyDummy';
}
