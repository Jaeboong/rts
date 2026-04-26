import { describe, expect, it } from 'vitest';
import { type Entity } from '../../types';
import { spawnBuilding, spawnMineralNode, spawnUnit } from '../entities';
import { cellToPx, createWorld, type World } from '../world';
import { idleAutoGatherSystem } from './idle-auto-gather';

// Spawn a mineral node with a fully-built supplyDepot on top (mirrors
// confirmPlacement('supplyDepot') minus the construction step). Auto-gather
// only targets depot-claimed nodes, so this is the canonical "valid target".
// `team` lets cross-team theft tests stage enemy-owned depot claims.
function spawnNodeWithDepot(
  world: World,
  cellX: number,
  cellY: number,
  remaining = 1500,
  team: 'player' | 'enemy' = 'player',
): { node: Entity; depot: Entity } {
  const node = spawnMineralNode(world, cellX, cellY, remaining);
  const depot = spawnBuilding(world, 'supplyDepot', team, cellX, cellY);
  node.depotId = depot.id;
  depot.mineralNodeId = node.id;
  return { node, depot };
}

// Drive the system N times, bumping world.tickCount the same way loop.ts
// does (after the systems run for a tick).
function runSystemTicks(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    idleAutoGatherSystem(world);
    world.tickCount++;
  }
}

// Helper: run for `ticksElapsed` units of "idle elapsed time". The first
// invocation seeds idleSinceTick (0 elapsed), so we need ticksElapsed + 1
// invocations total to make the last call see delta == ticksElapsed.
//   ticksElapsed = 299 → no fire (delta < 300)
//   ticksElapsed = 300 → fires (delta NOT < 300)
function runForElapsedIdle(world: World, ticksElapsed: number): void {
  runSystemTicks(world, ticksElapsed + 1);
}

describe('idleAutoGatherSystem — fire threshold', () => {
  it('worker idle 14.95s (299 ticks elapsed) → no command', () => {
    const w = createWorld();
    spawnNodeWithDepot(w, 36, 12, 1500);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(34, 12));
    worker.command = null;
    worker.path = null;

    runForElapsedIdle(w, 299);

    expect(worker.command).toBeNull();
    expect(worker.idleSinceTick).toBe(0); // counter still ticking
  });

  it('worker idle 15s (300 ticks elapsed) → gather command issued targeting depot-claimed node', () => {
    const w = createWorld();
    const { node } = spawnNodeWithDepot(w, 36, 12, 1500);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(34, 12));
    worker.command = null;
    worker.path = null;

    runForElapsedIdle(w, 300);

    expect(worker.command).toEqual({ type: 'gather', nodeId: node.id });
    // Counter cleared so the next idle stretch starts fresh.
    expect(worker.idleSinceTick).toBeUndefined();
  });
});

describe('idleAutoGatherSystem — target selection', () => {
  it('prefers the nearest depot-claimed node, ignoring closer raw mineralNodes', () => {
    const w = createWorld();
    // Closer raw patch (no depot) at cells 28,12 — must be ignored.
    spawnMineralNode(w, 28, 12, 1500);
    // Farther depot-claimed node at cells 50,12 — must win.
    const { node: farClaimed } = spawnNodeWithDepot(w, 50, 12, 1500);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(30, 12));
    worker.command = null;
    worker.path = null;

    runForElapsedIdle(w, 300);

    expect(worker.command).toEqual({ type: 'gather', nodeId: farClaimed.id });
  });

  it('ignores nodes whose depot is still under construction', () => {
    const w = createWorld();
    const node = spawnMineralNode(w, 36, 12, 1500);
    // spawnBuilding(..., completed=false) → underConstruction=true.
    const depot = spawnBuilding(w, 'supplyDepot', 'player', 36, 12, false);
    node.depotId = depot.id;
    depot.mineralNodeId = node.id;
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(34, 12));
    worker.command = null;
    worker.path = null;

    runForElapsedIdle(w, 300);

    expect(worker.command).toBeNull();
  });

  it('all nodes raw (no depots anywhere) → idle stays idle (no-op)', () => {
    const w = createWorld();
    spawnMineralNode(w, 36, 12, 1500);
    spawnMineralNode(w, 50, 12, 1500);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(34, 12));
    worker.command = null;
    worker.path = null;

    runForElapsedIdle(w, 300);

    expect(worker.command).toBeNull();
    // idleSinceTick stays set so the next tick can fire the moment a depot
    // appears; it is NOT reset just because no target was found.
    expect(worker.idleSinceTick).toBe(0);
  });

  it('depleted depot-claimed node (remaining=0) is skipped', () => {
    const w = createWorld();
    const { node: depleted } = spawnNodeWithDepot(w, 36, 12, 0);
    const { node: alive } = spawnNodeWithDepot(w, 60, 12, 1500);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(34, 12));
    worker.command = null;
    worker.path = null;

    runForElapsedIdle(w, 300);

    expect(worker.command).toEqual({ type: 'gather', nodeId: alive.id });
    expect(depleted.id).toBeDefined(); // referenced to silence unused
  });

  it('cross-team theft block: only enemy-team depot-claimed node available → worker stays idle', () => {
    // Bug regression: idleAutoGatherSystem used to auto-route player workers
    // onto enemy supplyDepots, letting them mine and deposit ore claimed by
    // the opposing team. Now an enemy depot is filtered out of the candidate
    // set, so a player worker with no own-team depot stays idle.
    const w = createWorld();
    spawnNodeWithDepot(w, 36, 12, 1500, 'enemy');
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(34, 12));
    worker.command = null;
    worker.path = null;

    runForElapsedIdle(w, 300);

    expect(worker.command).toBeNull();
    // Like the "all raw" case, idleSinceTick stays set so a future own-team
    // depot can be picked up the moment it appears.
    expect(worker.idleSinceTick).toBe(0);
  });

  it('mixed teams: prefers own-team depot even when enemy depot is closer', () => {
    const w = createWorld();
    // Closer enemy-claimed patch — must be ignored due to team filter.
    spawnNodeWithDepot(w, 36, 12, 1500, 'enemy');
    // Farther own-team-claimed patch — must win.
    const { node: ownFar } = spawnNodeWithDepot(w, 60, 12, 1500, 'player');
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(34, 12));
    worker.command = null;
    worker.path = null;

    runForElapsedIdle(w, 300);

    expect(worker.command).toEqual({ type: 'gather', nodeId: ownFar.id });
  });
});

describe('idleAutoGatherSystem — counter reset on activity', () => {
  it('worker receives a manual command mid-idle → counter resets, must re-accumulate 15s after returning idle', () => {
    const w = createWorld();
    const { node } = spawnNodeWithDepot(w, 36, 12, 1500);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(34, 12));
    worker.command = null;
    worker.path = null;

    // Idle 200 ticks, well below threshold.
    runSystemTicks(w, 200);
    expect(worker.idleSinceTick).toBe(0);

    // Player issues a manual move command — counter must clear next tick.
    worker.command = { type: 'move', target: cellToPx(40, 12) };
    idleAutoGatherSystem(w);
    w.tickCount++;
    expect(worker.idleSinceTick).toBeUndefined();

    // Player cancels (worker becomes idle again at the current tick).
    worker.command = null;
    worker.path = null;

    // 300 elapsed since re-idle → fires (full 15s required again).
    runForElapsedIdle(w, 300);
    expect(worker.command).toEqual({ type: 'gather', nodeId: node.id });
  });

  it('worker in middle of gather cycle (gatherSubState set) is NOT considered idle', () => {
    const w = createWorld();
    const { node } = spawnNodeWithDepot(w, 36, 12, 1500);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(34, 12));
    // Mimic gather.ts internal state — command already gone, but sub-state active.
    worker.command = null;
    worker.path = null;
    worker.gatherSubState = 'mining';
    worker.gatherNodeId = node.id;

    runForElapsedIdle(w, 300);

    expect(worker.command).toBeNull();
    expect(worker.idleSinceTick).toBeUndefined();
  });

  it('worker with active path (mid-move) is NOT considered idle', () => {
    const w = createWorld();
    spawnNodeWithDepot(w, 36, 12, 1500);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(34, 12));
    worker.command = null;
    worker.path = [cellToPx(35, 12), cellToPx(36, 12)];

    runForElapsedIdle(w, 300);

    expect(worker.command).toBeNull();
    expect(worker.idleSinceTick).toBeUndefined();
  });

  it('dead worker is not considered idle', () => {
    const w = createWorld();
    spawnNodeWithDepot(w, 36, 12, 1500);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(34, 12));
    worker.command = null;
    worker.path = null;
    worker.dead = true;

    runForElapsedIdle(w, 300);

    expect(worker.command).toBeNull();
  });
});

describe('idleAutoGatherSystem — determinism', () => {
  it('two equidistant depot-claimed nodes → smaller id wins (id ascending tie-break)', () => {
    const w = createWorld();
    // Spawn order matters: spawnMineralNode then spawnBuilding for first node;
    // then same for second. ids increment monotonically. First node has smaller id.
    const { node: first } = spawnNodeWithDepot(w, 50, 12, 1500);
    const { node: second } = spawnNodeWithDepot(w, 18, 12, 1500);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(34, 12));
    worker.command = null;
    worker.path = null;

    // Both at distance 16 cells (256 px) along x — exactly equidistant.
    expect(Math.abs(first.pos.x - worker.pos.x)).toBe(Math.abs(second.pos.x - worker.pos.x));
    expect(first.id).toBeLessThan(second.id);

    runForElapsedIdle(w, 300);

    expect(worker.command).toEqual({ type: 'gather', nodeId: first.id });
  });

  it('only worker kind is considered (marines/tanks ignored)', () => {
    const w = createWorld();
    spawnNodeWithDepot(w, 36, 12, 1500);
    const marine = spawnUnit(w, 'marine', 'player', cellToPx(34, 12));
    marine.command = null;
    marine.path = null;

    runForElapsedIdle(w, 300);

    expect(marine.command).toBeNull();
    expect(marine.idleSinceTick).toBeUndefined();
  });
});
