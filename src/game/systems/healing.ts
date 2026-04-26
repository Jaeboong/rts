import { CELL, type Entity, type EntityId, type EntityKind } from '../../types';
import { requestPath, shouldRepath } from './movement';
import { ensureSpatialGrid, queryRadius } from './spatial-grid';
import type { World } from '../world';

// Reusable scratch buffer for spatialGrid queries. Module-scope to avoid
// per-call allocation on the hot path (medic runs every tick).
const healCandidates: EntityId[] = [];

// Phase 49: medic now heals all armed friendlies (marine + tank + tank-light),
// not just marines. Workers and other medics are excluded — workers self-heal
// at the depot, medics shouldn't queue up to heal each other in formation.
const HEAL_TARGET_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>([
  'marine',
  'tank',
  'tank-light',
]);

// Hysteresis around the marine: don't path while inside leashMin; repath when outside leashMax.
// Distance-only — spec asks "behind" but velocity-derived rear-position adds churn for negligible UX gain.
const FOLLOW_LEASH_MIN = 2 * CELL;
const FOLLOW_LEASH_MAX = 4 * CELL;
const HEAL_TICK_SECONDS = 1;

export function runHealingSystem(world: World, dt: number): void {
  for (const e of world.entities.values()) {
    if (e.kind !== 'medic') continue;
    if (e.dead) continue;
    if (e.team !== 'player') continue;

    const wounded = findClosestWoundedFriendly(world, e);
    if (wounded) {
      runHealingMode(world, e, wounded, dt);
      continue;
    }

    const ally = findClosestFriendlyMarine(world, e);
    if (!ally) {
      enterIdle(e);
      continue;
    }
    runFollowMode(world, e, ally);
  }
}

function runHealingMode(
  world: World,
  medic: Entity,
  target: Entity,
  dt: number,
): void {
  const wasHealing = medic.healSubState === 'healing';
  medic.healSubState = 'healing';
  if (medic.healTargetId !== target.id) {
    medic.healTargetId = target.id;
    medic.healTimer = 0;
  } else if (!wasHealing) {
    medic.healTimer = 0;
  }

  const range = medic.healRange ?? 0;
  const d = distance(medic, target);

  if (d <= range) {
    medic.path = null;
    if (medic.facing !== undefined) {
      medic.facing = Math.atan2(target.pos.y - medic.pos.y, target.pos.x - medic.pos.x);
    }
    medic.healTimer = (medic.healTimer ?? 0) + dt;
    while (medic.healTimer >= HEAL_TICK_SECONDS) {
      medic.healTimer -= HEAL_TICK_SECONDS;
      const amount = medic.healRate ?? 0;
      target.hp = Math.min(target.hpMax, target.hp + amount);
      if (target.hp >= target.hpMax) break;
    }
    return;
  }

  // Out of healRange but target still wounded → close the gap.
  if (
    (!medic.path || medic.path.length === 0 || isPathStale(medic, target)) &&
    shouldRepath(medic.id)
  ) {
    requestPath(world, medic, target.pos, target.id);
  }
}

function runFollowMode(world: World, medic: Entity, ally: Entity): void {
  medic.healSubState = 'following';
  medic.healTargetId = null;
  medic.healTimer = 0;

  const d = distance(medic, ally);

  if (d < FOLLOW_LEASH_MIN) {
    medic.path = null;
    medic.pathTargetCell = null;
    return;
  }

  if (d > FOLLOW_LEASH_MAX) {
    if (
      (!medic.path || medic.path.length === 0 || isPathStale(medic, ally)) &&
      shouldRepath(medic.id)
    ) {
      requestPath(world, medic, ally.pos, ally.id);
    }
    return;
  }

  // In leash band: if a previous path is exhausted, leave it cleared; otherwise let it finish.
  if (medic.path && medic.path.length === 0) {
    medic.path = null;
  }
}

function enterIdle(medic: Entity): void {
  medic.healSubState = 'idle';
  medic.healTargetId = null;
  medic.healTimer = 0;
  medic.path = null;
  medic.pathTargetCell = null;
}

// Phase 49: scans armed friendly units (marine/tank/tank-light) and picks the
// one with the LOWEST hp/hpMax ratio. Distance is the secondary tie-break.
// Reasoning: a 10/200 tank dies in one shot if not healed; a 50/60 marine has
// time. Heal the worst-off first.
//
// Uses spatialGrid (broad-phase) to avoid iterating every entity on big maps —
// pre-Phase-49 this iterated all entities, which became O(N×M) when the medic
// system ticked every entity that was a medic.
function findClosestWoundedFriendly(world: World, medic: Entity): Entity | null {
  const sight = medic.sightRange ?? 0;
  if (sight <= 0) return null;
  ensureSpatialGrid(world);
  queryRadius(world.spatialGrid, medic.pos.x, medic.pos.y, sight, healCandidates);
  const sightSq = sight * sight;
  let best: Entity | null = null;
  let bestRatio = Infinity;
  let bestD2 = Infinity;
  for (const id of healCandidates) {
    if (id === medic.id) continue;
    const other = world.entities.get(id);
    if (!other) continue;
    if (!HEAL_TARGET_KINDS.has(other.kind)) continue;
    if (other.team !== medic.team) continue;
    if (other.dead) continue;
    if (other.hp >= other.hpMax) continue;
    const dx = other.pos.x - medic.pos.x;
    const dy = other.pos.y - medic.pos.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > sightSq) continue;
    const ratio = other.hp / Math.max(1, other.hpMax);
    if (ratio < bestRatio || (ratio === bestRatio && d2 < bestD2)) {
      best = other;
      bestRatio = ratio;
      bestD2 = d2;
    }
  }
  return best;
}

function findClosestFriendlyMarine(world: World, medic: Entity): Entity | null {
  let best: Entity | null = null;
  let bestSq = Infinity;
  for (const other of world.entities.values()) {
    if (other.kind !== 'marine') continue;
    if (other.team !== medic.team) continue;
    if (other.dead) continue;
    const dx = other.pos.x - medic.pos.x;
    const dy = other.pos.y - medic.pos.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestSq) {
      best = other;
      bestSq = d2;
    }
  }
  return best;
}

function distance(a: Entity, b: Entity): number {
  return Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y);
}

function isPathStale(e: Entity, target: Entity): boolean {
  if (!e.path || e.path.length === 0) return true;
  if (!e.pathTargetCell) return true;
  const aimedX = e.pathTargetCell.x * CELL + CELL / 2;
  const aimedY = e.pathTargetCell.y * CELL + CELL / 2;
  const dx = target.pos.x - aimedX;
  const dy = target.pos.y - aimedY;
  return dx * dx + dy * dy > CELL * CELL;
}
