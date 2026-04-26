import { describe, expect, it, vi } from 'vitest';

import { spawnBuilding, spawnGasGeyser, spawnMineralNode, spawnUnit } from '../entities';
import { cellToPx, createWorld } from '../world';

import { applyAICommand } from './command-applier';

describe('applyAICommand: build supplyDepot via host helper', () => {
  it('snaps onto a mineralNode at the click cell, links host↔depot, issues build to worker', () => {
    const w = createWorld();
    w.resources.enemy = 100;
    spawnBuilding(w, 'commandCenter', 'enemy', 10, 10);
    const node = spawnMineralNode(w, 30, 30, 1500);
    const worker = spawnUnit(w, 'worker', 'enemy', cellToPx(20, 20));

    const ok = applyAICommand(w, 'enemy', {
      type: 'build',
      workerId: worker.id,
      building: 'supplyDepot',
      cellX: 32, // any cell inside the 5×5 footprint
      cellY: 31,
    });
    expect(ok.ok).toBe(true);
    // Find the new depot
    const depots = [...w.entities.values()].filter((e) => e.kind === 'supplyDepot' && e.team === 'enemy');
    expect(depots).toHaveLength(1);
    const depot = depots[0];
    expect(depot.cellX).toBe(30);
    expect(depot.cellY).toBe(30);
    expect(depot.underConstruction).toBe(true);
    expect(node.depotId).toBe(depot.id);
    expect(depot.mineralNodeId).toBe(node.id);
    expect(worker.command).toEqual({ type: 'build', buildingId: depot.id });
  });

  it('rejects when no unclaimed mineralNode at the cell', () => {
    const w = createWorld();
    w.resources.enemy = 100;
    const worker = spawnUnit(w, 'worker', 'enemy', cellToPx(5, 5));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ok = applyAICommand(w, 'enemy', {
      type: 'build',
      workerId: worker.id,
      building: 'supplyDepot',
      cellX: 60,
      cellY: 60,
    });
    expect(ok.ok).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('rejects when mineralNode already claimed by another depot', () => {
    const w = createWorld();
    w.resources.enemy = 100;
    const node = spawnMineralNode(w, 30, 30, 1500);
    const existing = spawnBuilding(w, 'supplyDepot', 'enemy', 30, 30);
    node.depotId = existing.id;
    existing.mineralNodeId = node.id;
    const worker = spawnUnit(w, 'worker', 'enemy', cellToPx(5, 5));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ok = applyAICommand(w, 'enemy', {
      type: 'build',
      workerId: worker.id,
      building: 'supplyDepot',
      cellX: 31,
      cellY: 31,
    });
    expect(ok.ok).toBe(false);
    warn.mockRestore();
  });
});

describe('applyAICommand: build refinery via host helper', () => {
  it('snaps onto a geyser, links host↔refinery, debits cost', () => {
    const w = createWorld();
    w.resources.enemy = 200;
    spawnBuilding(w, 'commandCenter', 'enemy', 10, 10);
    const geyser = spawnGasGeyser(w, 30, 30);
    const worker = spawnUnit(w, 'worker', 'enemy', cellToPx(20, 20));

    const ok = applyAICommand(w, 'enemy', {
      type: 'build',
      workerId: worker.id,
      building: 'refinery',
      cellX: 32,
      cellY: 32,
    });
    expect(ok.ok).toBe(true);
    const refineries = [...w.entities.values()].filter((e) => e.kind === 'refinery' && e.team === 'enemy');
    expect(refineries).toHaveLength(1);
    const refinery = refineries[0];
    expect(geyser.refineryId).toBe(refinery.id);
    expect(refinery.geyserId).toBe(geyser.id);
    // Refinery costs 100; enemy started with 200.
    expect(w.resources.enemy).toBe(100);
  });
});

describe('applyAICommand: per-team gas (Phase 43)', () => {
  it('enemy worker tries to build factory with no gas → rejected with insufficient-gas reason', () => {
    const w = createWorld();
    w.resources.enemy = 1000;
    expect(w.gas.enemy).toBe(0);
    const worker = spawnUnit(w, 'worker', 'enemy', cellToPx(5, 5));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ok = applyAICommand(w, 'enemy', {
      type: 'build',
      workerId: worker.id,
      building: 'factory',
      cellX: 30,
      cellY: 30,
    });
    expect(ok.ok).toBe(false);
    if (!ok.ok) expect(ok.reason).toContain('insufficient gas');
    // Resources untouched on rejection.
    expect(w.resources.enemy).toBe(1000);
    expect(w.gas.enemy).toBe(0);
    warn.mockRestore();
  });

  it('enemy refinery accumulates gas on the enemy pool, NOT the player pool', async () => {
    const { runRefinerySystem } = await import('../systems/refinery');
    const w = createWorld();
    spawnBuilding(w, 'refinery', 'enemy', 30, 30); // built (not underConstruction)
    const beforeEnemy = w.gas.enemy;
    const beforePlayer = w.gas.player;
    // 2s @ 5/sec → +10 enemy gas.
    for (let i = 0; i < 40; i++) runRefinerySystem(w, 1 / 20);
    expect(w.gas.enemy).toBe(beforeEnemy + 10);
    expect(w.gas.player).toBe(beforePlayer);
  });

  it('enemy can produce tank from factory once enemy gas covers cost', () => {
    const w = createWorld();
    w.resources.enemy = 500;
    w.gas.enemy = 200;
    const fac = spawnBuilding(w, 'factory', 'enemy', 30, 30);
    const ok = applyAICommand(w, 'enemy', {
      type: 'produce',
      buildingId: fac.id,
      unit: 'tank',
    });
    expect(ok.ok).toBe(true);
    expect(fac.productionQueue?.[0].produces).toBe('tank');
    // Tank costs 250 minerals + 100 gas.
    expect(w.resources.enemy).toBe(500 - 250);
    expect(w.gas.enemy).toBe(200 - 100);
    // Player gas untouched.
    expect(w.gas.player).toBe(200);
  });

  it('enemy produce refunds to enemy pool on cancel', () => {
    const w = createWorld();
    w.resources.enemy = 500;
    w.gas.enemy = 200;
    const fac = spawnBuilding(w, 'factory', 'enemy', 30, 30);
    applyAICommand(w, 'enemy', {
      type: 'produce',
      buildingId: fac.id,
      unit: 'tank',
    });
    expect(w.gas.enemy).toBe(100);
    const ok = applyAICommand(w, 'enemy', { type: 'cancel', entityId: fac.id });
    expect(ok.ok).toBe(true);
    expect(w.resources.enemy).toBe(500);
    expect(w.gas.enemy).toBe(200);
  });
});

describe('applyAICommand: build commandCenter (non-hosted, 750M / 60s)', () => {
  it('worker builds CC at empty location → ok, deducts 750 minerals, spawns under-construction CC', () => {
    const w = createWorld();
    w.resources.enemy = 1000;
    const worker = spawnUnit(w, 'worker', 'enemy', cellToPx(5, 5));

    const ok = applyAICommand(w, 'enemy', {
      type: 'build',
      workerId: worker.id,
      building: 'commandCenter',
      cellX: 50,
      cellY: 50,
    });
    expect(ok.ok).toBe(true);
    expect(w.resources.enemy).toBe(250); // 1000 - 750
    const ccs = [...w.entities.values()].filter(
      (e) => e.kind === 'commandCenter' && e.team === 'enemy' && e.cellX === 50 && e.cellY === 50,
    );
    expect(ccs).toHaveLength(1);
    const cc = ccs[0];
    expect(cc.underConstruction).toBe(true);
    expect(cc.buildTotalSeconds).toBe(60);
    expect(cc.buildProgress).toBe(0);
    expect(worker.command).toEqual({ type: 'build', buildingId: cc.id });
  });

  it('rejects when team has insufficient minerals (< 750)', () => {
    const w = createWorld();
    w.resources.enemy = 700; // 50 short
    const worker = spawnUnit(w, 'worker', 'enemy', cellToPx(5, 5));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const r = applyAICommand(w, 'enemy', {
      type: 'build',
      workerId: worker.id,
      building: 'commandCenter',
      cellX: 50,
      cellY: 50,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('insufficient minerals');
    // No deduction on rejection.
    expect(w.resources.enemy).toBe(700);
    // No CC spawned.
    const ccs = [...w.entities.values()].filter((e) => e.kind === 'commandCenter');
    expect(ccs).toHaveLength(0);
    warn.mockRestore();
  });

  it('rejects when build site is blocked (overlapping existing building)', () => {
    const w = createWorld();
    w.resources.enemy = 1000;
    // Pre-existing CC at (50,50) covers cells [50..64] × [50..64]. Try to plant
    // a second CC at (52,52) — guaranteed footprint overlap.
    spawnBuilding(w, 'commandCenter', 'enemy', 50, 50);
    const worker = spawnUnit(w, 'worker', 'enemy', cellToPx(5, 5));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const r = applyAICommand(w, 'enemy', {
      type: 'build',
      workerId: worker.id,
      building: 'commandCenter',
      cellX: 52,
      cellY: 52,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/blocked|footprint/);
    // Resources untouched.
    expect(w.resources.enemy).toBe(1000);
    warn.mockRestore();
  });
});

describe('applyAICommand: build barracks displaces caught units', () => {
  it('teleports a worker out of the new footprint', () => {
    const w = createWorld();
    w.resources.enemy = 200;
    const worker = spawnUnit(w, 'worker', 'enemy', cellToPx(20, 20));
    const inside = spawnUnit(w, 'worker', 'enemy', cellToPx(22, 22)); // inside the future 7×14 barracks footprint at (20,20)
    const insideStartPos = { ...inside.pos };

    const ok = applyAICommand(w, 'enemy', {
      type: 'build',
      workerId: worker.id,
      building: 'barracks',
      cellX: 20,
      cellY: 20,
    });
    expect(ok.ok).toBe(true);
    // The "inside" worker should have been teleported off (its pos should have changed
    // OR worker itself was builder and is also displaced — at minimum, the *other* worker
    // is no longer inside the cell range it started in).
    expect(inside.pos).not.toEqual(insideStartPos);
  });
});
