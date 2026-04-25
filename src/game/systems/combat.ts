import type { Entity, EntityId } from '../../types';
import { requestPath, shouldRepath } from './movement';
import type { World } from '../world';

export function combatSystem(world: World, dt: number): void {
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
        } else if ((!e.path || e.path.length === 0) && shouldRepath(e.id)) {
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

    // In range: tick cooldown and fire
    e.attackCooldown = (e.attackCooldown ?? 0) - dt;
    if (e.attackCooldown <= 0) {
      target.hp -= e.attackDamage ?? 0;
      e.attackCooldown = e.attackInterval ?? 1;
      if (target.hp <= 0) target.dead = true;
    }
  }
}

function autoAcquire(world: World, e: Entity): EntityId | null {
  const range = e.attackRange ?? 0;
  let bestId: EntityId | null = null;
  let bestD2 = range * range;
  for (const other of world.entities.values()) {
    if (other.id === e.id) continue;
    if (other.dead) continue;
    if (!isHostile(e, other)) continue;
    const dx = other.pos.x - e.pos.x;
    const dy = other.pos.y - e.pos.y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) {
      bestId = other.id;
      bestD2 = d2;
    }
  }
  return bestId;
}

function isHostile(self: Entity, other: Entity): boolean {
  if (other.team === 'neutral') return false;
  if (other.team === self.team) return false;
  if (other.kind === 'mineralNode') return false;
  return true;
}

function dist(a: Entity, b: Entity): number {
  return Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y);
}
