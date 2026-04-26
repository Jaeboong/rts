import { CELL, type Entity, type EntityId, type Team } from '../../types';
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
      // Right-click on under-construction depot (or a node whose depot is
      // still being built) → enter waitForDepot: walk to depot perimeter and
      // hold there until construction completes, then transition to toNode.
      // Cross-team safety: enemy-team depots are NEVER a valid gather route —
      // not for direct clicks, not for waitForDepot, not for fallbacks. The
      // worker falls through to findNearestMineralNode (own team only) or idles.
      const target = world.entities.get(e.command.nodeId);
      let resolvedNodeId: number | null = null;
      let pendingDepotId: number | null = null;
      if (target) {
        if (target.kind === 'supplyDepot') {
          if (
            target.mineralNodeId !== null &&
            target.mineralNodeId !== undefined &&
            target.team === e.team
          ) {
            if (target.underConstruction) {
              pendingDepotId = target.id;
            } else {
              resolvedNodeId = target.mineralNodeId;
            }
          }
        } else if (target.kind === 'mineralNode') {
          // Raw patch is gatherable only when claimed by a fully-built own-team depot;
          // an own-team under-construction depot defers via waitForDepot.
          if (target.depotId !== null && target.depotId !== undefined) {
            const depot = world.entities.get(target.depotId);
            if (depot && depot.team === e.team) {
              if (depot.underConstruction) {
                pendingDepotId = depot.id;
              } else {
                resolvedNodeId = target.id;
              }
            }
          }
        }
      }
      if (pendingDepotId !== null) {
        e.gatherHomeId = findNearestCC(world, e);
        walkToDepotInProgress(world, e, pendingDepotId);
        continue;
      }
      if (resolvedNodeId === null) {
        // Fallback: scan for any own-team depot-claimed node
        // (covers depleted-target case and enemy-depot rejection).
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

    // Mid-cycle depot-death guard. cleanupDead runs LAST in runTick (after
    // combat/gather), so a depot killed in tick N gets nilled+removed at
    // end of N: releaseStampedResource sets node.depotId = null, then
    // removeEntity drops the building. By the time gatherSystem runs in
    // tick N+1, the chain (worker → gatherNodeId → depot) is broken and
    // downstream sub-states would otherwise: keep mining a now-unclaimed
    // node, deposit at the CC anyway, then walk back to a node that's no
    // longer ours. Guard re-validates per tick and reroutes to the nearest
    // own-team claimed node (preserving cargo so an in-flight haul doesn't
    // vaporize). waitForDepot owns its own death handling (gatherNodeId is
    // overloaded to the depot id there), so skip it here to avoid
    // double-handling.
    if (e.gatherSubState !== 'waitForDepot' && !hasValidDepotChain(world, e)) {
      const carrying = e.carrying ?? 0;
      const alt = findNearestMineralNode(world, e);
      if (carrying > 0) {
        // Don't disturb an in-flight toDepot/mining/depositing walk: just
        // repoint the post-deposit target. If alt is null, the next
        // depositing-end falls into autoRepathOrIdle and idles cleanly.
        e.gatherNodeId = alt ? alt.id : null;
      } else {
        if (alt) {
          e.gatherNodeId = alt.id;
          walkToNode(world, e);
        } else {
          e.command = null;
          e.gatherSubState = undefined;
          e.gatherNodeId = null;
          e.gatherHomeId = null;
          e.gatherTimer = 0;
          e.path = null;
        }
        continue;
      }
    }

    switch (e.gatherSubState) {
      case 'waitForDepot': {
        // gatherNodeId holds the depot id during this sub-state (overload).
        // Transition rules:
        //   depot missing/dead   → fall back to nearest gatherable node, else idle
        //   depot completed      → flip gatherNodeId to depot.mineralNodeId, walkToNode
        //   depot still building → keep waiting (path may still be in progress)
        const depotId = e.gatherNodeId;
        const depot = depotId ? world.entities.get(depotId) : null;
        if (!depot || depot.dead || depot.kind !== 'supplyDepot') {
          autoRepathOrIdle(world, e);
          break;
        }
        if (depot.underConstruction) {
          // Hold position; if path expired (arrived at perimeter), stay put.
          break;
        }
        // Depot completed — flip gatherNodeId to the underlying mineralNode and resume.
        if (depot.mineralNodeId === null || depot.mineralNodeId === undefined) {
          autoRepathOrIdle(world, e);
          break;
        }
        e.gatherNodeId = depot.mineralNodeId;
        walkToNode(world, e);
        break;
      }
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

// gatherNodeId is overloaded to hold the depot id while waiting; the switch's
// waitForDepot branch flips it back to the underlying mineralNode at completion.
function walkToDepotInProgress(world: World, w: Entity, depotId: number): void {
  const depot = world.entities.get(depotId);
  if (!depot) {
    w.command = null;
    return;
  }
  w.gatherSubState = 'waitForDepot';
  w.gatherNodeId = depotId;
  w.gatherTimer = 0;
  if (!requestPathAdjacent(world, w, depot)) {
    // Can't reach the depot perimeter — abandon rather than idle without state.
    w.command = null;
    w.gatherSubState = undefined;
    w.gatherNodeId = null;
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
// Only nodes whose depot is fully built and on the worker's team are considered:
// raw patches without a depot, under-construction depots, and enemy-team depots
// are all excluded (the last one prevents cross-team resource theft).
function findNearestMineralInRadius(world: World, w: Entity): Entity | null {
  const maxD2 = (WORKER_AUTO_REPATH_RADIUS * CELL) * (WORKER_AUTO_REPATH_RADIUS * CELL);
  let best: Entity | null = null;
  let bestD2 = Infinity;
  for (const e of world.entities.values()) {
    if (!isGatherableNode(world, e, w.team)) continue;
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

// Unbounded fallback for the initial-setup branch (user clicked an already-dead
// or enemy-team-depot node). Only nodes whose depot is fully built and on the
// worker's team count.
function findNearestMineralNode(world: World, w: Entity): Entity | null {
  let best: Entity | null = null;
  let bestD2 = Infinity;
  for (const e of world.entities.values()) {
    if (!isGatherableNode(world, e, w.team)) continue;
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

// Belt-and-suspenders chain check for the mid-cycle guard. Cleanup-dead nils
// node.depotId before removing the building, but this also defends against a
// dropped link, a kind mutation, an own-depot captured by team change, or a
// depot caught mid-construction that we shouldn't be mining yet. Returns true
// only when the worker's gatherNodeId still points at an own-team, fully built,
// alive supplyDepot via node.depotId.
function hasValidDepotChain(world: World, w: Entity): boolean {
  const nodeId = w.gatherNodeId;
  if (!nodeId) return false;
  const node = world.entities.get(nodeId);
  if (!node || node.dead || node.kind !== 'mineralNode') return false;
  if (node.depotId === null || node.depotId === undefined) return false;
  const depot = world.entities.get(node.depotId);
  if (!depot || depot.dead) return false;
  if (depot.kind !== 'supplyDepot') return false;
  if (depot.underConstruction) return false;
  if (depot.team !== w.team) return false;
  return true;
}

// Cross-team safety: workerTeam parameter ensures enemy-team depots' claimed
// patches are never gatherable. Strict !== so an undefined worker.team still
// rejects (deny by default).
function isGatherableNode(world: World, e: Entity, workerTeam: Team): boolean {
  if (e.kind !== 'mineralNode') return false;
  if ((e.remaining ?? 0) <= 0) return false;
  if (e.depotId === null || e.depotId === undefined) return false;
  const depot = world.entities.get(e.depotId);
  if (!depot || depot.underConstruction) return false;
  if (depot.team !== workerTeam) return false;
  return true;
}
