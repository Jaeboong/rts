import type { Entity } from '../../types';
import type { World } from '../world';

// 15s @ 20Hz tick = 300 ticks. Worker must be continuously idle for this many
// ticks (command/path/gatherSubState all clear) before auto-gather fires.
const IDLE_THRESHOLD_TICKS = 300;

// Auto-issues a `gather` command to any worker that has been idle for
// IDLE_THRESHOLD_TICKS consecutive ticks, targeting the nearest depot-claimed
// mineralNode. Runs BEFORE gatherSystem in the tick order so the freshly-set
// command is consumed the same tick (init branch starts toNode walk).
//
// Determinism: tick-driven counter + (distance, id) tie-break. No Math.random.
export function idleAutoGatherSystem(world: World): void {
  for (const e of world.entities.values()) {
    if (!isIdleWorker(e)) {
      // Any non-idle condition resets the counter so a future idle stretch
      // starts cleanly from world.tickCount, not stale state.
      e.idleSinceTick = undefined;
      continue;
    }
    if (e.idleSinceTick === undefined) {
      e.idleSinceTick = world.tickCount;
      continue;
    }
    if (world.tickCount - e.idleSinceTick < IDLE_THRESHOLD_TICKS) continue;
    const node = findNearestDepotClaimedNode(world, e);
    if (!node) continue; // Stay idle; retry next tick.
    e.command = { type: 'gather', nodeId: node.id };
    e.idleSinceTick = undefined;
    // gatherSystem (next in tick order) hits its init branch this same tick.
  }
}

function isIdleWorker(e: Entity): boolean {
  if (e.kind !== 'worker') return false;
  if (e.dead || e.hp <= 0) return false;
  if (e.command !== null && e.command !== undefined) return false;
  if (e.path && e.path.length > 0) return false;
  if (e.gatherSubState !== undefined) return false;
  return true;
}

// Self-contained nearest-depot-claimed-node search. Mirrors gather.ts's
// isGatherableNode predicate (depot exists, fully built, node has remaining)
// but we don't import from gather.ts to keep these systems independent.
// Cross-team safety: enemy-team depots are filtered out so an idle worker can
// never be auto-routed onto an opposing depot's claimed mineral patch.
// Tie-break: smaller id wins → deterministic across replays.
function findNearestDepotClaimedNode(world: World, worker: Entity): Entity | null {
  let best: Entity | null = null;
  let bestD2 = Infinity;
  let bestId = Infinity;
  for (const n of world.entities.values()) {
    if (n.kind !== 'mineralNode') continue;
    if (n.dead) continue;
    if ((n.remaining ?? 0) <= 0) continue;
    if (n.depotId === null || n.depotId === undefined) continue;
    const depot = world.entities.get(n.depotId);
    if (!depot || depot.dead || depot.underConstruction) continue;
    // Deny-by-default cross-team check: only own-team depots count. If
    // worker.team is somehow undefined, the strict !== still rejects.
    if (depot.team !== worker.team) continue;
    const dx = n.pos.x - worker.pos.x;
    const dy = n.pos.y - worker.pos.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2 || (d2 === bestD2 && n.id < bestId)) {
      best = n;
      bestD2 = d2;
      bestId = n.id;
    }
  }
  return best;
}
