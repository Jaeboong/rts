import { describe, expect, it } from 'vitest';
import { CELL } from '../../types';
import {
  DEPOSIT_SECONDS,
  MINING_SECONDS,
  WORKER_AUTO_REPATH_RADIUS,
  WORKER_CARRY_CAP,
} from '../balance';
import { spawnBuilding, spawnMineralNode, spawnUnit } from '../entities';
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
    // CC (20×20) occupies cells 10..29; mineral and worker placed outside its footprint.
    spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const node = spawnMineralNode(w, 36, 12, 1500);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(34, 12));
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
    // CC (20×20) occupies cells 10..29; node and worker placed outside its footprint.
    spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const node = spawnMineralNode(w, 36, 12, 100);
    // Place worker next to node (cell 35,12) so it arrives quickly
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(35, 12));
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
    // CC (20×20) occupies cells 10..29; node and worker placed outside its footprint.
    const cc = spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const node = spawnMineralNode(w, 36, 12, 100);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(35, 12));
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

describe('mineral auto-repath on depletion', () => {
  it('auto-targets another mineral within radius when current depletes mid-mining', () => {
    const w = createWorld();
    // CC (20×20) at (10,10) covers cells 10..29; place workers/minerals at row 40 to clear it.
    spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const primary = spawnMineralNode(w, 35, 40, 100);
    // 6 cells right of primary, within 8-cell radius (5×5 mineral spacing precludes <6 cell gap).
    const alt = spawnMineralNode(w, 41, 40, 1500);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(35, 40));
    worker.command = { type: 'gather', nodeId: primary.id };
    worker.gatherSubState = 'mining';
    worker.gatherTimer = 0.01;
    worker.gatherNodeId = primary.id;
    primary.remaining = 0;

    gatherSystem(w, 1 / 20);

    expect(worker.gatherSubState).toBe('toNode');
    expect(worker.gatherNodeId).toBe(alt.id);
    expect(worker.command).not.toBeNull();
  });

  it('clears gather state when no mineral within radius after depletion', () => {
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const primary = spawnMineralNode(w, 35, 40, 100);
    // Far outside 8-cell radius.
    spawnMineralNode(w, 35 + WORKER_AUTO_REPATH_RADIUS + 5, 40, 1500);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(35, 40));
    worker.command = { type: 'gather', nodeId: primary.id };
    worker.gatherSubState = 'mining';
    worker.gatherTimer = 0.01;
    worker.gatherNodeId = primary.id;
    primary.remaining = 0;

    gatherSystem(w, 1 / 20);

    expect(worker.gatherSubState).toBeUndefined();
    expect(worker.gatherNodeId).toBeNull();
    expect(worker.gatherTimer).toBe(0);
    expect(worker.command).toBeNull();
  });

  it('picks the closest mineral by Euclidean distance when multiple are in radius', () => {
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const primary = spawnMineralNode(w, 35, 40, 100);
    // 5×5 mineral footprints require ≥6 cells between TLs to avoid overlap. Near at +6, far at +12 — both inside 8-cell radius? Far at +12 is outside. Use +6 (near) and +7 (far) to stay within radius and not overlap; +6 and +7 overlap. Use cell distances guaranteeing radius+non-overlap: near +6 (dist=6), far ≥ near+5 → +11 cells (dist=11) outside. Switch to a Y-axis split.
    const farAlt = spawnMineralNode(w, 35, 47, 1500);
    const nearAlt = spawnMineralNode(w, 41, 40, 1500);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(35, 40));
    worker.command = { type: 'gather', nodeId: primary.id };
    worker.gatherSubState = 'mining';
    worker.gatherTimer = 0.01;
    worker.gatherNodeId = primary.id;
    primary.remaining = 0;

    gatherSystem(w, 1 / 20);

    expect(worker.gatherNodeId).toBe(nearAlt.id);
    expect(worker.gatherNodeId).not.toBe(farAlt.id);
  });

  it('does not auto-repath an idle worker when minerals deplete in the world', () => {
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const node = spawnMineralNode(w, 35, 40, 100);
    spawnMineralNode(w, 41, 40, 1500);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(35, 40));
    // Idle: no command, no gather sub-state.
    worker.command = null;
    worker.gatherSubState = undefined;
    node.remaining = 0;

    gatherSystem(w, 1 / 20);

    expect(worker.command).toBeNull();
    expect(worker.gatherSubState).toBeUndefined();
    expect(worker.gatherNodeId == null).toBe(true);
  });

  it('treats radius boundary as inclusive (mineral at exactly N*CELL is selected)', () => {
    // Inclusive boundary: a mineral whose center is exactly WORKER_AUTO_REPATH_RADIUS * CELL away counts.
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const primary = spawnMineralNode(w, 35, 40, 100);
    // cellToPx(35,40) → (35*16+8, 40*16+8). Mineral at (35+8, 40) → dx = 8*CELL, dy = 0 → exactly on boundary.
    const boundaryAlt = spawnMineralNode(w, 35 + WORKER_AUTO_REPATH_RADIUS, 40, 1500);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(35, 40));
    worker.command = { type: 'gather', nodeId: primary.id };
    worker.gatherSubState = 'mining';
    worker.gatherTimer = 0.01;
    worker.gatherNodeId = primary.id;
    primary.remaining = 0;

    gatherSystem(w, 1 / 20);

    // Sanity check the geometry assumption.
    const dx = boundaryAlt.pos.x - worker.pos.x;
    const dy = boundaryAlt.pos.y - worker.pos.y;
    expect(Math.hypot(dx, dy)).toBeCloseTo(WORKER_AUTO_REPATH_RADIUS * CELL, 5);

    expect(worker.gatherNodeId).toBe(boundaryAlt.id);
    expect(worker.gatherSubState).toBe('toNode');
  });
});
