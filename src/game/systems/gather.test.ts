import { describe, expect, it } from 'vitest';
import {
  DEPOSIT_SECONDS,
  MINING_SECONDS,
  WORKER_CARRY_CAP,
  spawnBuilding,
  spawnMineralNode,
  spawnUnit,
} from '../entities';
import { cellToPx, createWorld } from '../world';
import { gatherSystem } from './gather';
import { movementSystem } from './movement';

const DT = 1 / 20;

function stepMany(world: ReturnType<typeof createWorld>, seconds: number): void {
  const ticks = Math.ceil(seconds / DT);
  for (let i = 0; i < ticks; i++) {
    gatherSystem(world, DT);
    movementSystem(world, DT);
  }
}

describe('gather state machine', () => {
  it('walks to node, mines, returns, deposits', () => {
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const node = spawnMineralNode(w, 16, 12, 1500);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(14, 12));
    worker.command = { type: 'gather', nodeId: node.id };

    // First tick — initialize and request path
    gatherSystem(w, DT);
    expect(worker.gatherSubState).toBe('toNode');
    expect(worker.path).not.toBeNull();
    expect(worker.path!.length).toBeGreaterThan(0);

    // Walk and mine and return — give plenty of time
    stepMany(w, 30);

    expect(w.resources.player).toBeGreaterThanOrEqual(100 + WORKER_CARRY_CAP);
    expect((node.remaining ?? 0)).toBeLessThan(1500);
  });

  it('mining takes MINING_SECONDS once adjacent', () => {
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const node = spawnMineralNode(w, 16, 12, 100);
    // Place worker next to node (cell 15,12) so it arrives quickly
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(15, 12));
    worker.command = { type: 'gather', nodeId: node.id };

    // Drive long enough to reach node and start mining
    let mining = false;
    for (let i = 0; i < 200 && !mining; i++) {
      gatherSystem(w, DT);
      movementSystem(w, DT);
      if (worker.gatherSubState === 'mining') mining = true;
    }
    expect(mining).toBe(true);
    const t0 = worker.gatherTimer ?? 0;
    expect(t0).toBeCloseTo(MINING_SECONDS, 1);
  });

  it('depositing increases team resources', () => {
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const node = spawnMineralNode(w, 16, 12, 100);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(15, 12));
    worker.command = { type: 'gather', nodeId: node.id };
    worker.carrying = 0;

    const before = w.resources.player;
    // Run long enough to do a full cycle and deposit
    stepMany(w, 30);
    expect(w.resources.player).toBeGreaterThanOrEqual(before + WORKER_CARRY_CAP);
    expect(cc.id).toBeDefined();
    expect(DEPOSIT_SECONDS).toBeGreaterThan(0);
  });
});
