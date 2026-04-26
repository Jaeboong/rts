import { CELL, type Entity, type EntityId } from '../../types';
import {
  DEPOSIT_SECONDS,
  MINING_SECONDS,
  WORKER_AUTO_REPATH_RADIUS,
  WORKER_CARRY_CAP,
} from '../balance';
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
      // Resolve gather target: depot indirection happens here so all later
      // states reference the underlying mineralNode directly via gatherNodeId.
      // Right-click on a supplyDepot → use its underlying mineralNode.
      // Right-click on a raw mineralNode without a depot → no-op (gather rejected).
      // Right-click on a mineralNode with depot → just use the node directly.
      // Depot must be fully constructed — under-construction depot blocks gather.
      const target = world.entities.get(e.command.nodeId);
      let resolvedNodeId: number | null = null;
      if (target) {
        if (target.kind === 'supplyDepot') {
          if (
            target.mineralNodeId !== null &&
            target.mineralNodeId !== undefined &&
            !target.underConstruction
          ) {
            resolvedNodeId = target.mineralNodeId;
          }
        } else if (target.kind === 'mineralNode') {
          // Raw patch is gatherable only when claimed by a fully-built depot.
          if (target.depotId !== null && target.depotId !== undefined) {
            const depot = world.entities.get(target.depotId);
            if (depot && !depot.underConstruction) {
              resolvedNodeId = target.id;
            }
          }
        }
      }
      if (resolvedNodeId === null) {
        // Fallback: scan for any depot-claimed node (covers depleted-target case).
        const newNode = findNearestMineralNode(world, e);
        if (!newNode) {
          e.command = null;
          continue;
        }
        resolvedNodeId = newNode.id;
      }
      e.gatherNodeId = resolvedNodeId;
      e.gatherHomeId = findNearestCC(world, e);
      const node = world.entities.get(resolvedNodeId);
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
            autoRepathOrIdle(world, e);
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
          // Node depleted mid-mining → auto-repath instead of wasting a CC trip with carrying=0.
          if (!node || (node.remaining ?? 0) <= 0) {
            autoRepathOrIdle(world, e);
            break;
          }
          const taken = Math.min(WORKER_CARRY_CAP, node.remaining ?? 0);
          node.remaining = (node.remaining ?? 0) - taken;
          e.carrying = taken;
          // A depleted node that has a supplyDepot on it must NOT be marked dead:
          // removeEntity would clearOccupancy and zero the depot's footprint cells.
          // The depot is meaningless without ore and stays standing as visual debris.
          if ((node.remaining ?? 0) <= 0 && (node.depotId === null || node.depotId === undefined)) {
            node.dead = true;
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
          const node = e.gatherNodeId
            ? world.entities.get(e.gatherNodeId)
            : null;
          if (!node || (node.remaining ?? 0) <= 0) {
            autoRepathOrIdle(world, e);
            break;
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

function autoRepathOrIdle(world: World, w: Entity): void {
  const next = findNearestMineralInRadius(world, w);
  if (!next) {
    w.command = null;
    w.gatherSubState = undefined;
    w.gatherNodeId = null;
    w.gatherTimer = 0;
    return;
  }
  w.gatherNodeId = next.id;
  walkToNode(world, w);
}

// Boundary is inclusive: a node exactly at radius * CELL pixels still counts.
// Only nodes whose depot is fully built are considered: raw patches without a
// depot, or nodes whose depot is still under construction, can't be gathered.
function findNearestMineralInRadius(world: World, w: Entity): Entity | null {
  const maxD2 = (WORKER_AUTO_REPATH_RADIUS * CELL) * (WORKER_AUTO_REPATH_RADIUS * CELL);
  let best: Entity | null = null;
  let bestD2 = Infinity;
  for (const e of world.entities.values()) {
    if (!isGatherableNode(world, e)) continue;
    const dx = e.pos.x - w.pos.x;
    const dy = e.pos.y - w.pos.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > maxD2) continue;
    if (d2 < bestD2) {
      best = e;
      bestD2 = d2;
    }
  }
  return best;
}

// Unbounded fallback for the initial-setup branch (user clicked an already-dead node).
// Only nodes whose depot is fully built count — raw patches and under-construction
// depots are excluded.
function findNearestMineralNode(world: World, w: Entity): Entity | null {
  let best: Entity | null = null;
  let bestD2 = Infinity;
  for (const e of world.entities.values()) {
    if (!isGatherableNode(world, e)) continue;
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

function isGatherableNode(world: World, e: Entity): boolean {
  if (e.kind !== 'mineralNode') return false;
  if ((e.remaining ?? 0) <= 0) return false;
  if (e.depotId === null || e.depotId === undefined) return false;
  const depot = world.entities.get(e.depotId);
  if (!depot || depot.underConstruction) return false;
  return true;
}
