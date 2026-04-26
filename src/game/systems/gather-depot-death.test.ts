import { describe, expect, it } from 'vitest';

import { type Entity } from '../../types';
import { WORKER_CARRY_CAP } from '../balance';
import { spawnBuilding, spawnMineralNode, spawnUnit } from '../entities';
import { cellToPx, createWorld, type World } from '../world';
import { gatherSystem } from './gather';
import { movementSystem } from './movement';

const DT = 1 / 20;

// Mirrors what cleanupDead/releaseStampedResource do for a destroyed supplyDepot:
// nil the back-pointer on the surviving mineralNode, mark dead, delete from entity map.
// (cleanupDead also re-stamps occupancy; not needed for these unit tests.)
function killDepot(world: World, depot: Entity, node: Entity): void {
  node.depotId = null;
  depot.dead = true;
  world.entities.delete(depot.id);
}

function spawnNodeWithDepot(
  world: World,
  cellX: number,
  cellY: number,
  remaining = 1500,
): { node: Entity; depot: Entity } {
  const node = spawnMineralNode(world, cellX, cellY, remaining);
  const depot = spawnBuilding(world, 'supplyDepot', 'player', cellX, cellY);
  node.depotId = depot.id;
  depot.mineralNodeId = node.id;
  return { node, depot };
}

// Bug under test: a worker mid-cycle (mining/toNode/toDepot/depositing) on a
// node whose claiming supplyDepot was just destroyed used to keep mining the
// now-unclaimed node, deposit, then walk back to the dead depot's node. The
// new mid-cycle guard in gatherSystem re-validates the depot chain each tick.

describe('gather: mid-cycle depot death', () => {
  it('mining → depot dies → switches to alt depot+node when one exists', () => {
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const { node: primaryNode, depot: primaryDepot } = spawnNodeWithDepot(w, 35, 40, 1500);
    // Alt depot+node nearby — guard should reroute to this.
    const { node: altNode } = spawnNodeWithDepot(w, 41, 40, 1500);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(35, 40));
    worker.command = { type: 'gather', nodeId: primaryDepot.id };
    worker.gatherSubState = 'mining';
    worker.gatherTimer = 1.0;
    worker.gatherNodeId = primaryNode.id;
    worker.carrying = 0;

    killDepot(w, primaryDepot, primaryNode);

    gatherSystem(w, DT);

    expect(worker.gatherNodeId).toBe(altNode.id);
    expect(worker.gatherSubState).toBe('toNode');
    expect(worker.command).not.toBeNull();
    expect(worker.path).not.toBeNull();
  });

  it('mining with cargo=0 → depot dies, no alt depot, CC alive → command cleared, idles', () => {
    // No alt depot to redirect to, no cargo to deposit → worker stops.
    // Idle-auto-gather will retry later (covered by its own tests).
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const { node, depot } = spawnNodeWithDepot(w, 35, 40, 1500);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(35, 40));
    worker.command = { type: 'gather', nodeId: depot.id };
    worker.gatherSubState = 'mining';
    worker.gatherTimer = 1.0;
    worker.gatherNodeId = node.id;
    worker.carrying = 0;

    killDepot(w, depot, node);

    gatherSystem(w, DT);

    expect(worker.command).toBeNull();
    expect(worker.gatherSubState).toBeUndefined();
    expect(worker.gatherNodeId).toBeNull();
    expect(worker.gatherHomeId).toBeNull();
  });

  it('toDepot with cargo → depot dies, no alt → walks home to CC, deposits, then idles', () => {
    // Cargo must NOT be lost to the guard. The existing toDepot/depositing
    // machinery already routes to the nearest CC and deposits; the guard
    // just nullifies gatherNodeId (no alt to redirect to) so the post-deposit
    // walkback falls into autoRepathOrIdle and ends cleanly.
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const { node, depot } = spawnNodeWithDepot(w, 35, 40, 1500);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(35, 40));
    worker.command = { type: 'gather', nodeId: depot.id };
    worker.gatherSubState = 'toDepot';
    worker.gatherTimer = 0;
    worker.gatherNodeId = node.id;
    worker.gatherHomeId = null;
    worker.carrying = WORKER_CARRY_CAP;

    const before = w.resources.player;
    killDepot(w, depot, node);

    // Drive long enough to walk home and deposit.
    for (let i = 0; i < 600; i++) {
      gatherSystem(w, DT);
      movementSystem(w, DT);
    }

    expect(w.resources.player).toBeGreaterThanOrEqual(before + WORKER_CARRY_CAP);
    expect(worker.carrying).toBe(0);
    // After deposit, no claimed node remains → idles.
    expect(worker.command).toBeNull();
    expect(worker.gatherSubState).toBeUndefined();
  });

  it('mining → depot dies, no alt depot, no CC, cargo=0 → command cleared, idles', () => {
    // Worst case: no fallback target, no home base. Guard must clear
    // command without crashing or stalling in a sub-state.
    const w = createWorld();
    const { node, depot } = spawnNodeWithDepot(w, 35, 40, 1500);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(35, 40));
    worker.command = { type: 'gather', nodeId: depot.id };
    worker.gatherSubState = 'mining';
    worker.gatherTimer = 1.0;
    worker.gatherNodeId = node.id;
    worker.carrying = 0;

    killDepot(w, depot, node);

    gatherSystem(w, DT);

    expect(worker.command).toBeNull();
    expect(worker.gatherSubState).toBeUndefined();
    expect(worker.gatherNodeId).toBeNull();
  });

  it('toDepot mid-walk → depot dies, alt depot+node exists → keeps walking, deposits, then walks to alt', () => {
    // Guard repoints gatherNodeId to alt without disturbing the in-flight
    // walk to the CC. After deposit, worker walks to the alt node.
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const { node: primaryNode, depot: primaryDepot } = spawnNodeWithDepot(w, 35, 40, 1500);
    const { node: altNode } = spawnNodeWithDepot(w, 41, 40, 1500);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(35, 40));
    worker.command = { type: 'gather', nodeId: primaryDepot.id };
    worker.gatherSubState = 'toDepot';
    worker.gatherTimer = 0;
    worker.gatherNodeId = primaryNode.id;
    worker.gatherHomeId = cc.id;
    worker.carrying = WORKER_CARRY_CAP;
    // Stand-in for an in-flight walk: a non-empty path keeps the toDepot
    // branch in its no-op (still walking) state for this tick so the guard's
    // "don't disturb in-flight cargo walks" semantics is observable.
    worker.path = [{ x: cellToPx(20, 20).x, y: cellToPx(20, 20).y }];

    killDepot(w, primaryDepot, primaryNode);

    gatherSystem(w, DT);

    // Cargo intact — guard must NOT vaporize it.
    expect(worker.carrying).toBe(WORKER_CARRY_CAP);
    // gatherNodeId repointed to alt for the post-deposit walk.
    expect(worker.gatherNodeId).toBe(altNode.id);
    // Sub-state still toDepot — in-flight walk preserved (path is non-empty).
    expect(worker.gatherSubState).toBe('toDepot');
    expect(worker.command).not.toBeNull();
    // Guard must NOT have replaced the path.
    expect(worker.path).not.toBeNull();
    expect(worker.path!.length).toBeGreaterThan(0);
  });

  it('regression: own-team depot still alive → guard does not misfire', () => {
    // Lock in that the guard never disturbs a healthy gather cycle.
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const { node, depot } = spawnNodeWithDepot(w, 35, 40, 1500);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(35, 40));
    worker.command = { type: 'gather', nodeId: depot.id };
    worker.gatherSubState = 'mining';
    worker.gatherTimer = 1.0;
    worker.gatherNodeId = node.id;
    worker.carrying = 0;

    gatherSystem(w, DT);

    // No state change from the guard — timer ticked down but everything
    // else (sub-state, node, command) is intact.
    expect(worker.gatherSubState).toBe('mining');
    expect(worker.gatherNodeId).toBe(node.id);
    expect(worker.command).not.toBeNull();
  });
});
