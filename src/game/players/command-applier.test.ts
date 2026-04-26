import { describe, expect, it, vi } from 'vitest';
import { spawnBuilding, spawnMineralNode, spawnUnit } from '../entities';
import { cellToPx, createWorld } from '../world';
import { applyAICommand } from './command-applier';

describe('applyAICommand: team rejection', () => {
  it('rejects move on a unit owned by another team and warn-logs', () => {
    const w = createWorld();
    const enemyMarine = spawnUnit(w, 'marine', 'enemy', cellToPx(20, 20));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ok = applyAICommand(w, 'player', {
      type: 'move',
      unitIds: [enemyMarine.id],
      target: { x: 100, y: 100 },
    });
    expect(ok).toBe(false);
    expect(warn).toHaveBeenCalled();
    expect(enemyMarine.command).toBeNull();
    warn.mockRestore();
  });

  it('rejects gather on enemy worker when called by player', () => {
    const w = createWorld();
    const enemyW = spawnUnit(w, 'worker', 'enemy', cellToPx(5, 5));
    const node = spawnMineralNode(w, 30, 30, 1500);
    const depot = spawnBuilding(w, 'supplyDepot', 'enemy', 30, 30);
    node.depotId = depot.id;
    depot.mineralNodeId = node.id;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ok = applyAICommand(w, 'player', {
      type: 'gather',
      unitIds: [enemyW.id],
      nodeId: node.id,
    });
    expect(ok).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('applyAICommand: gather success', () => {
  it('issues gather to an owned worker on a depot-claimed node', () => {
    const w = createWorld();
    const node = spawnMineralNode(w, 30, 30, 1500);
    const depot = spawnBuilding(w, 'supplyDepot', 'enemy', 30, 30);
    node.depotId = depot.id;
    depot.mineralNodeId = node.id;
    const worker = spawnUnit(w, 'worker', 'enemy', cellToPx(20, 20));

    const ok = applyAICommand(w, 'enemy', {
      type: 'gather',
      unitIds: [worker.id],
      nodeId: node.id,
    });
    expect(ok).toBe(true);
    expect(worker.command).toEqual({ type: 'gather', nodeId: node.id });
    expect(worker.gatherSubState).toBeUndefined();
    expect(worker.path).toBeNull();
  });

  it('rejects gather when target is not a mineralNode/supplyDepot', () => {
    const w = createWorld();
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(5, 5));
    const cc = spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ok = applyAICommand(w, 'player', {
      type: 'gather',
      unitIds: [worker.id],
      nodeId: cc.id,
    });
    expect(ok).toBe(false);
    warn.mockRestore();
  });

  it('rejects gather on a non-worker unit', () => {
    const w = createWorld();
    const marine = spawnUnit(w, 'marine', 'player', cellToPx(5, 5));
    const node = spawnMineralNode(w, 30, 30, 1500);
    const depot = spawnBuilding(w, 'supplyDepot', 'player', 30, 30);
    node.depotId = depot.id;
    depot.mineralNodeId = node.id;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ok = applyAICommand(w, 'player', {
      type: 'gather',
      unitIds: [marine.id],
      nodeId: node.id,
    });
    expect(ok).toBe(false);
    warn.mockRestore();
  });
});

describe('applyAICommand: move / attackMove', () => {
  it('move sets command on owned unit and clamps walkable', () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(5, 5));
    const ok = applyAICommand(w, 'player', {
      type: 'move',
      unitIds: [m.id],
      target: { x: 200, y: 200 },
    });
    expect(ok).toBe(true);
    expect(m.command?.type).toBe('move');
  });

  it('attackMove sets attackMove command', () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(5, 5));
    const ok = applyAICommand(w, 'player', {
      type: 'attackMove',
      unitIds: [m.id],
      target: { x: 200, y: 200 },
    });
    expect(ok).toBe(true);
    expect(m.command?.type).toBe('attackMove');
  });

  it('rejects move target out of map bounds', () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(5, 5));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ok = applyAICommand(w, 'player', {
      type: 'move',
      unitIds: [m.id],
      target: { x: -10, y: -10 },
    });
    expect(ok).toBe(false);
    warn.mockRestore();
  });
});

describe('applyAICommand: attack', () => {
  it('issues attack on enemy by attack-capable owned unit', () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(5, 5));
    const e = spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(20, 20));
    const ok = applyAICommand(w, 'player', {
      type: 'attack',
      unitIds: [m.id],
      targetId: e.id,
    });
    expect(ok).toBe(true);
    expect(m.command).toEqual({ type: 'attack', targetId: e.id });
  });

  it('rejects attack on friendly target', () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(5, 5));
    const ally = spawnUnit(w, 'marine', 'player', cellToPx(20, 20));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ok = applyAICommand(w, 'player', {
      type: 'attack',
      unitIds: [m.id],
      targetId: ally.id,
    });
    expect(ok).toBe(false);
    warn.mockRestore();
  });

  it('rejects attack from a unit with no attackRange (worker)', () => {
    const w = createWorld();
    const wkr = spawnUnit(w, 'worker', 'player', cellToPx(5, 5));
    const e = spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(20, 20));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ok = applyAICommand(w, 'player', {
      type: 'attack',
      unitIds: [wkr.id],
      targetId: e.id,
    });
    expect(ok).toBe(false);
    warn.mockRestore();
  });
});

describe('applyAICommand: produce', () => {
  it('queues a worker on a completed enemy commandCenter (resources permitting)', () => {
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'enemy', 10, 10);
    w.resources.enemy = 500;
    const ok = applyAICommand(w, 'enemy', {
      type: 'produce',
      buildingId: cc.id,
      unit: 'worker',
    });
    expect(ok).toBe(true);
    expect(cc.productionQueue?.length).toBe(1);
    expect(cc.productionQueue?.[0].produces).toBe('worker');
    expect(w.resources.enemy).toBe(450);
  });

  it('rejects produce on an under-construction building', () => {
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'player', 10, 10, false);
    w.resources.player = 500;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ok = applyAICommand(w, 'player', {
      type: 'produce',
      buildingId: cc.id,
      unit: 'worker',
    });
    expect(ok).toBe(false);
    warn.mockRestore();
  });

  it('rejects produce on a building of wrong producer', () => {
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    w.resources.player = 500;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ok = applyAICommand(w, 'player', {
      type: 'produce',
      buildingId: cc.id,
      unit: 'marine',
    });
    expect(ok).toBe(false);
    warn.mockRestore();
  });
});

describe('applyAICommand: setRally / cancel', () => {
  it('setRally sets the rallyPoint on a producer building', () => {
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'enemy', 10, 10);
    const ok = applyAICommand(w, 'enemy', {
      type: 'setRally',
      buildingId: cc.id,
      pos: { x: 200, y: 200 },
    });
    expect(ok).toBe(true);
    expect(cc.rallyPoint).toEqual({ x: 200, y: 200 });
  });

  it('cancel pops last queued production and refunds cost', () => {
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'enemy', 10, 10);
    w.resources.enemy = 500;
    applyAICommand(w, 'enemy', { type: 'produce', buildingId: cc.id, unit: 'worker' });
    expect(w.resources.enemy).toBe(450);
    const ok = applyAICommand(w, 'enemy', { type: 'cancel', entityId: cc.id });
    expect(ok).toBe(true);
    expect(cc.productionQueue?.length).toBe(0);
    expect(w.resources.enemy).toBe(500);
  });

  it('cancel on a unit clears its command and gather state', () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(5, 5));
    m.command = { type: 'move', target: { x: 100, y: 100 } };
    const ok = applyAICommand(w, 'player', { type: 'cancel', entityId: m.id });
    expect(ok).toBe(true);
    expect(m.command).toBeNull();
  });
});
