import type { Entity, EntityKind, Vec2 } from '../../types';
import { isCellBlocked, pxToCell, type World } from '../world';

const UNIT_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>([
  'worker',
  'marine',
  'tank',
  'tank-light',
  'medic',
  'enemyDummy',
]);

const EPSILON = 1e-6;

function isCollisionParticipant(e: Entity): boolean {
  return UNIT_KINDS.has(e.kind) && !e.dead && e.radius !== undefined;
}

// Workers in any active gather sub-state are "solid": they don't move from
// collision, but still push other (non-exempt) units the full overlap.
function isExempt(e: Entity): boolean {
  return e.kind === 'worker' && e.gatherSubState !== undefined;
}

export function runCollisionSystem(world: World): void {
  const units: Entity[] = [];
  for (const e of world.entities.values()) {
    if (isCollisionParticipant(e)) units.push(e);
  }

  // Accumulate per-entity displacements; apply at end so the result is
  // independent of iteration order.
  const deltas = new Map<number, Vec2>();
  for (const u of units) deltas.set(u.id, { x: 0, y: 0 });

  for (let i = 0; i < units.length; i++) {
    const a = units[i];
    const ra = a.radius ?? 0;
    for (let j = i + 1; j < units.length; j++) {
      const b = units[j];
      const rb = b.radius ?? 0;

      const dx = b.pos.x - a.pos.x;
      const dy = b.pos.y - a.pos.y;
      const distSq = dx * dx + dy * dy;
      const sumR = ra + rb;
      if (distSq >= sumR * sumR - EPSILON) continue;

      const dist = Math.sqrt(distSq);
      const overlap = sumR - dist;
      if (overlap <= EPSILON) continue;

      const aExempt = isExempt(a);
      const bExempt = isExempt(b);
      if (aExempt && bExempt) continue;

      // Direction from a to b. If positions coincide, fall back to a
      // deterministic axis based on id ordering.
      let nx: number;
      let ny: number;
      if (dist > EPSILON) {
        nx = dx / dist;
        ny = dy / dist;
      } else {
        nx = 1;
        ny = 0;
      }

      const da = deltas.get(a.id)!;
      const db = deltas.get(b.id)!;

      if (!aExempt && !bExempt) {
        const half = overlap / 2;
        da.x -= nx * half;
        da.y -= ny * half;
        db.x += nx * half;
        db.y += ny * half;
      } else if (aExempt) {
        db.x += nx * overlap;
        db.y += ny * overlap;
      } else {
        da.x -= nx * overlap;
        da.y -= ny * overlap;
      }
    }
  }

  for (const u of units) {
    const d = deltas.get(u.id);
    if (!d) continue;
    if (d.x === 0 && d.y === 0) continue;
    // Don't let separation push a unit onto a blocked cell (water, wall,
    // or building/mineral occupancy). If the new position would land in
    // a blocked cell, drop the push for this tick — units overlap rather
    // than walk into water.
    const newX = u.pos.x + d.x;
    const newY = u.pos.y + d.y;
    const cell = pxToCell({ x: newX, y: newY });
    if (isCellBlocked(world, cell.x, cell.y)) continue;
    u.pos.x = newX;
    u.pos.y = newY;
  }
}
