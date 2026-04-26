import { CELL, type Entity, type EntityId } from '../../types';
import { requestPath, shouldRepath } from './movement';
import {
  ensureSpatialGrid,
  queryRadius,
  rebuildSpatialGrid,
} from './spatial-grid';
import type { World } from '../world';

// Reusable scratch buffers for queryRadius results — avoids per-call array
// allocation on the hot path (called for every armed entity every tick).
const acquireCandidates: EntityId[] = [];
const hasHostileCandidates: EntityId[] = [];

export function combatSystem(world: World, dt: number): void {
  // Authoritative rebuild: positions can change between consecutive system
  // calls (movementSystem runs between two combat ticks; tests mutate `pos`
  // directly), so we never trust a stale grid here. This rebuild is also
  // required mid-tick because productionSystem (simulate.ts:35) runs AFTER
  // collision's rebuild and may spawn fresh units that aren't yet in the
  // grid. ensureSpatialGrid() doesn't help — its empty-flag stays false
  // after collision rebuilds, even though the new entities arrived after.
  rebuildSpatialGrid(world);

  // Tick attack-effect timers on all entities (incl. those without attackRange).
  // Decoupled from the attack loop so a combatant that just lost its target still cools.
  for (const e of world.entities.values()) {
    if (e.attackEffectMs && e.attackEffectMs > 0) {
      e.attackEffectMs = Math.max(0, e.attackEffectMs - dt * 1000);
    }
  }
  for (const e of world.entities.values()) {
    if (e.attackRange === undefined) continue;
    if (e.dead) continue;
    if (e.underConstruction) continue;

    let targetId: EntityId | null = null;
    if (e.command && e.command.type === 'attack') {
      targetId = e.command.targetId;
    } else {
      targetId = autoAcquire(world, e);
    }

    const target = targetId !== null ? world.entities.get(targetId) : null;

    // Maintain attack-command path / completion
    if (e.command && e.command.type === 'attack') {
      if (!target || target.dead) {
        e.command = null;
        e.path = null;
        e.attackTargetId = null;
      } else {
        const d = dist(e, target);
        if (d <= e.attackRange) {
          e.path = null;
        } else if (isPathStale(e, target) && shouldRepath(e.id)) {
          requestPath(world, e, target.pos, target.id);
        }
      }
    }

    // Attack-move auto engage
    if (e.command && e.command.type === 'attackMove') {
      if (target && !target.dead) {
        const d = dist(e, target);
        if (d <= e.attackRange) {
          // pause walking to fire
          e.path = null;
        }
      }
    }

    // Idle auto-approach: sighted but out of attackRange → chase (transient, no command).
    // Guarded on speed>0 so static turrets don't request paths.
    if (
      !e.command &&
      target &&
      !target.dead &&
      e.speed !== undefined &&
      e.speed > 0
    ) {
      const d = dist(e, target);
      if (d <= e.attackRange) {
        e.path = null;
      } else if (isPathStale(e, target) && shouldRepath(e.id)) {
        requestPath(world, e, target.pos, target.id);
      }
    }

    if (!target || target.dead) {
      e.attackTargetId = null;
      e.attackCooldown = Math.max(0, (e.attackCooldown ?? 0) - dt);
      continue;
    }

    e.attackTargetId = target.id;
    const d = dist(e, target);
    if (d > e.attackRange) {
      e.attackCooldown = Math.max(0, (e.attackCooldown ?? 0) - dt);
      continue;
    }

    // In range: face target, then tick cooldown and fire.
    if (e.facing !== undefined) {
      e.facing = Math.atan2(target.pos.y - e.pos.y, target.pos.x - e.pos.x);
    }
    e.attackCooldown = (e.attackCooldown ?? 0) - dt;
    if (e.attackCooldown <= 0) {
      // Set BEFORE the hp deduction so a kill-shot still records the attacker;
      // event-tracker reads this on death for kill-attribution.
      target.lastDamageBy = e.id;
      target.hp -= e.attackDamage ?? 0;
      e.attackCooldown = e.attackInterval ?? 1;
      e.attackEffectMs = 200;
      if (target.hp <= 0) target.dead = true;
    }
  }
}

// Tiered: prefer hostiles that can shoot back (attackRange>0) — turret, marine,
// tank, etc — over passive ones (worker, medic, building footprints). AABB-edge
// distance otherwise lets a 4×4 CC's edge beat any unit at the building's side.
//
// Phase 49 — focus fire: within the chosen tier, pick the candidate with the
// LOWEST hp/hpMax ratio so a wounded enemy dies first (less wasted damage when
// 3+ marines split shots evenly). Distance is the secondary tie-break — a
// wounded enemy at sight-edge still beats a fresh enemy point-blank, since
// finishing the kill removes one DPS source from the fight faster.
//
// Tank-priority: tanks (and tank-light) prefer high-mass enemies (other tanks,
// armored units, buildings) over light infantry/workers when both are in range.
// Reasoning: tank shots are slow + expensive — wasting one on a worker that a
// marine can two-shot is bad value. Marines/turrets stay neutral on weight.
function autoAcquire(world: World, e: Entity): EntityId | null {
  const range = e.sightRange ?? e.attackRange ?? 0;
  const isTankShooter = e.kind === 'tank' || e.kind === 'tank-light';
  let bestAttackerId: EntityId | null = null;
  let bestAttackerScore = Infinity;
  let bestPassiveId: EntityId | null = null;
  let bestPassiveScore = Infinity;
  // Broad-phase: only entities in buckets the sight circle touches. With
  // bucket=64px and marine sight=240px (15 cells), this typically returns far
  // fewer candidates than the full entity list in dense combat. Buildings
  // inserted into multiple buckets may appear duplicated; the narrow-phase
  // selection below is idempotent on best-id, so dupes only cost extra dist
  // calls (still bounded by the per-bucket population).
  queryRadius(world.spatialGrid, e.pos.x, e.pos.y, range, acquireCandidates);
  for (const otherId of acquireCandidates) {
    if (otherId === e.id) continue;
    const other = world.entities.get(otherId);
    if (!other || other.dead) continue;
    if (!isHostile(e, other)) continue;
    const d = dist(e, other);
    if (d > range) continue;
    // Score: lower = better. Primary axis is HP ratio (focus fire), secondary
    // is distance scaled into a small fraction so it only breaks ties between
    // candidates with the same ratio (e.g. two fresh enemies at full HP).
    // Tank-priority weight further reduces the score for armored/large
    // targets when the shooter is a tank.
    const ratio = other.hp / Math.max(1, other.hpMax);
    const distFactor = d / Math.max(1, range);
    const tankWeight = isTankShooter ? tankPriorityWeight(other) : 1;
    const score = ratio * tankWeight + distFactor * 0.01;
    if ((other.attackRange ?? 0) > 0) {
      if (score < bestAttackerScore) {
        bestAttackerId = other.id;
        bestAttackerScore = score;
      }
    } else {
      if (score < bestPassiveScore) {
        bestPassiveId = other.id;
        bestPassiveScore = score;
      }
    }
  }
  return bestAttackerId !== null ? bestAttackerId : bestPassiveId;
}

// Tank prefers heavy targets. Multiplier on HP-ratio score (lower = preferred):
//   0.4  — heavy: tank, tank-light, building footprint (CC, barracks, factory…)
//   1.0  — neutral: marine, medic
//   1.6  — soft: worker (deprioritized — marine handles workers more efficiently)
// The multiplier compresses the lowest-HP-wins logic for heavy targets so a
// fresh tank (ratio 1.0 → score 0.4) still outranks a wounded worker (ratio
// 0.5 → score 0.8). Buildings have no attackRange so they only compete in the
// passive tier, but we still want a tank to pick CC over a worker there too.
function tankPriorityWeight(target: Entity): number {
  if (target.kind === 'tank' || target.kind === 'tank-light') return 0.4;
  if (
    target.cellX !== undefined &&
    target.cellY !== undefined &&
    target.kind !== 'mineralNode' &&
    target.kind !== 'gasGeyser'
  ) {
    return 0.4;
  }
  if (target.kind === 'worker') return 1.6;
  return 1;
}

// Used by simulate.driveCommands to suppress attackMove path re-issue while a
// hostile is engageable. Without this, combat sets path=null but driveCommands
// re-requests path the next tick, causing a fire-while-creeping oscillation.
//
// Called per-entity from driveCommands (potentially N times per tick) — we
// CANNOT afford a full rebuild on every call. Instead lazy-fill once via
// ensureSpatialGrid; combatSystem's authoritative rebuild later restamps the
// grid after movementSystem has shuffled positions.
export function hasHostileInAttackRange(world: World, e: Entity): boolean {
  if (e.attackRange === undefined) return false;
  ensureSpatialGrid(world);
  queryRadius(
    world.spatialGrid,
    e.pos.x,
    e.pos.y,
    e.attackRange,
    hasHostileCandidates,
  );
  for (const otherId of hasHostileCandidates) {
    if (otherId === e.id) continue;
    const other = world.entities.get(otherId);
    if (!other || other.dead) continue;
    if (!isHostile(e, other)) continue;
    if (dist(e, other) <= e.attackRange) return true;
  }
  return false;
}

// Path is stale if missing/empty OR target drifted ≥ 1 cell from where the path was aimed.
function isPathStale(e: Entity, target: Entity): boolean {
  if (!e.path || e.path.length === 0) return true;
  if (!e.pathTargetCell) return true;
  const aimedX = e.pathTargetCell.x * CELL + CELL / 2;
  const aimedY = e.pathTargetCell.y * CELL + CELL / 2;
  const dx = target.pos.x - aimedX;
  const dy = target.pos.y - aimedY;
  return dx * dx + dy * dy > CELL * CELL;
}

function isHostile(self: Entity, other: Entity): boolean {
  if (other.team === 'neutral') return false;
  if (other.team === self.team) return false;
  if (other.kind === 'mineralNode') return false;
  return true;
}

// AABB-edge distance: for buildings/resources (cell footprint), distance is
// from the nearest edge — not the center. So a Marine with 160px range can
// shoot a 320px-wide CC from outside the footprint instead of needing to be
// at the unreachable interior center. Point entities (units) degenerate to
// pos-pos which gives the same result as center-to-center.
function dist(a: Entity, b: Entity): number {
  const ar = entityRect(a);
  const br = entityRect(b);
  const dx = Math.max(0, ar.left - br.right, br.left - ar.right);
  const dy = Math.max(0, ar.top - br.bottom, br.top - ar.bottom);
  return Math.hypot(dx, dy);
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function entityRect(e: Entity): Rect {
  if (
    e.cellX !== undefined &&
    e.cellY !== undefined &&
    e.sizeW !== undefined &&
    e.sizeH !== undefined
  ) {
    return {
      left: e.cellX * CELL,
      top: e.cellY * CELL,
      right: (e.cellX + e.sizeW) * CELL,
      bottom: (e.cellY + e.sizeH) * CELL,
    };
  }
  return { left: e.pos.x, top: e.pos.y, right: e.pos.x, bottom: e.pos.y };
}
