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
    expect(ok).toBe(true);
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
    expect(ok).toBe(false);
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
    expect(ok).toBe(false);
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
    expect(ok).toBe(true);
    const refineries = [...w.entities.values()].filter((e) => e.kind === 'refinery' && e.team === 'enemy');
    expect(refineries).toHaveLength(1);
    const refinery = refineries[0];
    expect(geyser.refineryId).toBe(refinery.id);
    expect(refinery.geyserId).toBe(geyser.id);
    // Refinery costs 100; enemy started with 200.
    expect(w.resources.enemy).toBe(100);
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
    expect(ok).toBe(true);
    // The "inside" worker should have been teleported off (its pos should have changed
    // OR worker itself was builder and is also displaced — at minimum, the *other* worker
    // is no longer inside the cell range it started in).
    expect(inside.pos).not.toEqual(insideStartPos);
  });
});
