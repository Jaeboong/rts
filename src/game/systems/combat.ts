import { CELL, type Entity, type EntityId } from '../../types';
import { requestPath, shouldRepath } from './movement';
import type { World } from '../world';

export function combatSystem(world: World, dt: number): void {
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
function autoAcquire(world: World, e: Entity): EntityId | null {
  const range = e.sightRange ?? e.attackRange ?? 0;
  let bestAttackerId: EntityId | null = null;
  let bestAttackerD = range;
  let bestPassiveId: EntityId | null = null;
  let bestPassiveD = range;
  for (const other of world.entities.values()) {
    if (other.id === e.id) continue;
    if (other.dead) continue;
    if (!isHostile(e, other)) continue;
    const d = dist(e, other);
    if (d > range) continue;
    if ((other.attackRange ?? 0) > 0) {
      if (d <= bestAttackerD) {
        bestAttackerId = other.id;
        bestAttackerD = d;
      }
    } else {
      if (d <= bestPassiveD) {
        bestPassiveId = other.id;
        bestPassiveD = d;
      }
    }
  }
  return bestAttackerId !== null ? bestAttackerId : bestPassiveId;
}

// Used by simulate.driveCommands to suppress attackMove path re-issue while a
// hostile is engageable. Without this, combat sets path=null but driveCommands
// re-requests path the next tick, causing a fire-while-creeping oscillation.
export function hasHostileInAttackRange(world: World, e: Entity): boolean {
  if (e.attackRange === undefined) return false;
  for (const other of world.entities.values()) {
    if (other.id === e.id) continue;
    if (other.dead) continue;
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
