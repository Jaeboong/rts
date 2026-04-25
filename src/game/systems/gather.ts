import type { Entity, EntityId } from '../../types';
import {
  DEPOSIT_SECONDS,
  MINING_SECONDS,
  WORKER_CARRY_CAP,
} from '../entities';
import { requestPathAdjacent } from './movement';
import type { World } from '../world';

export function gatherSystem(world: World, dt: number): void {
  for (const e of world.entities.values()) {
    if (e.kind !== 'worker') continue;
    if (!e.command || e.command.type !== 'gather') {
      if (e.gatherSubState !== undefined) {
        e.gatherSubState = undefined;
        e.gatherTimer = 0;
        e.gatherNodeId = null;
        e.gatherHomeId = null;
      }
      continue;
    }

    if (e.gatherSubState === undefined) {
      e.gatherNodeId = e.command.nodeId;
      e.gatherHomeId = findNearestCC(world, e);
      const node = world.entities.get(e.command.nodeId);
      if (!node || (node.remaining ?? 0) <= 0) {
        const newNode = findNearestMineralNode(world, e);
        if (!newNode) {
          e.command = null;
          continue;
        }
        e.gatherNodeId = newNode.id;
      }
      walkToNode(world, e);
      continue;
    }

    switch (e.gatherSubState) {
      case 'toNode': {
        if (!e.path || e.path.length === 0) {
          const node = e.gatherNodeId
            ? world.entities.get(e.gatherNodeId)
            : null;
          if (!node || (node.remaining ?? 0) <= 0) {
            const newNode = findNearestMineralNode(world, e);
            if (!newNode) {
              e.command = null;
              e.gatherSubState = undefined;
              break;
            }
            e.gatherNodeId = newNode.id;
            walkToNode(world, e);
            break;
          }
          e.gatherSubState = 'mining';
          e.gatherTimer = MINING_SECONDS;
        }
        break;
      }
      case 'mining': {
        e.gatherTimer = (e.gatherTimer ?? 0) - dt;
        if (e.gatherTimer <= 0) {
          const node = e.gatherNodeId
            ? world.entities.get(e.gatherNodeId)
            : null;
          if (node && (node.remaining ?? 0) > 0) {
            const taken = Math.min(WORKER_CARRY_CAP, node.remaining ?? 0);
            node.remaining = (node.remaining ?? 0) - taken;
            e.carrying = taken;
            if ((node.remaining ?? 0) <= 0) node.dead = true;
          }
          walkToHome(world, e);
        }
        break;
      }
      case 'toDepot': {
        if (!e.path || e.path.length === 0) {
          const home = e.gatherHomeId
            ? world.entities.get(e.gatherHomeId)
            : null;
          if (!home || home.dead || home.underConstruction) {
            const cc = findNearestCC(world, e);
            if (!cc) {
              e.command = null;
              e.gatherSubState = undefined;
              break;
            }
            e.gatherHomeId = cc;
            walkToHome(world, e);
            break;
          }
          e.gatherSubState = 'depositing';
          e.gatherTimer = DEPOSIT_SECONDS;
        }
        break;
      }
      case 'depositing': {
        e.gatherTimer = (e.gatherTimer ?? 0) - dt;
        if (e.gatherTimer <= 0) {
          world.resources[e.team] += e.carrying ?? 0;
          e.carrying = 0;
          let node = e.gatherNodeId
            ? world.entities.get(e.gatherNodeId)
            : null;
          if (!node || (node.remaining ?? 0) <= 0) {
            const nn = findNearestMineralNode(world, e);
            if (!nn) {
              e.command = null;
              e.gatherSubState = undefined;
              break;
            }
            e.gatherNodeId = nn.id;
            node = nn;
          }
          walkToNode(world, e);
        }
        break;
      }
    }
  }
}

function walkToNode(world: World, w: Entity): void {
  const node = w.gatherNodeId ? world.entities.get(w.gatherNodeId) : null;
  if (!node) return;
  w.gatherSubState = 'toNode';
  w.gatherTimer = 0;
  if (!requestPathAdjacent(world, w, node)) {
    w.command = null;
    w.gatherSubState = undefined;
  }
}

function walkToHome(world: World, w: Entity): void {
  if (!w.gatherHomeId) {
    const cc = findNearestCC(world, w);
    if (cc) w.gatherHomeId = cc;
    else return;
  }
  const target = w.gatherHomeId ? world.entities.get(w.gatherHomeId) : null;
  if (!target) return;
  w.gatherSubState = 'toDepot';
  w.gatherTimer = 0;
  if (!requestPathAdjacent(world, w, target)) {
    w.command = null;
    w.gatherSubState = undefined;
  }
}

function findNearestCC(world: World, w: Entity): EntityId | null {
  let bestId: EntityId | null = null;
  let bestD2 = Infinity;
  for (const e of world.entities.values()) {
    if (e.kind !== 'commandCenter') continue;
    if (e.team !== w.team) continue;
    if (e.underConstruction) continue;
    const dx = e.pos.x - w.pos.x;
    const dy = e.pos.y - w.pos.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestId = e.id;
      bestD2 = d2;
    }
  }
  return bestId;
}

function findNearestMineralNode(world: World, w: Entity): Entity | null {
  let best: Entity | null = null;
  let bestD2 = Infinity;
  for (const e of world.entities.values()) {
    if (e.kind !== 'mineralNode') continue;
    if ((e.remaining ?? 0) <= 0) continue;
    const dx = e.pos.x - w.pos.x;
    const dy = e.pos.y - w.pos.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      best = e;
      bestD2 = d2;
    }
  }
  return best;
}
