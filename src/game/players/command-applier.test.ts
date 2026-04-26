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
    expect(ok.ok).toBe(false);
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
    expect(ok.ok).toBe(false);
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
    expect(ok.ok).toBe(true);
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
    expect(ok.ok).toBe(false);
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
    expect(ok.ok).toBe(false);
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
    expect(ok.ok).toBe(true);
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
    expect(ok.ok).toBe(true);
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
    expect(ok.ok).toBe(false);
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
    expect(ok.ok).toBe(true);
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
    expect(ok.ok).toBe(false);
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
    expect(ok.ok).toBe(false);
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
    expect(ok.ok).toBe(true);
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
    expect(ok.ok).toBe(false);
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
    expect(ok.ok).toBe(false);
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
    expect(ok.ok).toBe(true);
    expect(cc.rallyPoint).toEqual({ x: 200, y: 200 });
  });

  it('setRally accepts a safe rally with no enemies in range', () => {
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    // Distant enemy marine — rally well outside attackRange (160px * 1.5 = 240px).
    spawnUnit(w, 'marine', 'enemy', cellToPx(120, 120));
    const ok = applyAICommand(w, 'player', {
      type: 'setRally',
      buildingId: cc.id,
      pos: { x: 200, y: 200 },
    });
    expect(ok.ok).toBe(true);
    expect(cc.rallyPoint).toEqual({ x: 200, y: 200 });
  });

  it('setRally rejects when an enemy marine is within attackRange of the rally', () => {
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    // Marine attackRange=160px. Place marine 100px from rally → within 160*1.5.
    const marine = spawnUnit(w, 'marine', 'enemy', { x: 700, y: 700 });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = applyAICommand(w, 'player', {
      type: 'setRally',
      buildingId: cc.id,
      pos: { x: 700, y: 800 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain('setRally');
      expect(r.reason).toContain('marine');
      expect(r.reason).toContain(`#${marine.id}`);
      expect(r.reason).toContain('produced units will die en route');
    }
    // Rally must NOT be set when rejected — fresh CC has rallyPoint=null.
    expect(cc.rallyPoint).toBeNull();
    warn.mockRestore();
  });

  it('setRally rejects when an enemy turret covers the rally point', () => {
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    // Turret attackRange = 12*16 = 192px. Place turret 100px from rally.
    const turret = spawnBuilding(w, 'turret', 'enemy', 50, 50);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = applyAICommand(w, 'player', {
      type: 'setRally',
      buildingId: cc.id,
      pos: { x: turret.pos.x + 100, y: turret.pos.y },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain('turret');
      expect(r.reason).toContain(`#${turret.id}`);
    }
    warn.mockRestore();
  });

  it('setRally accepts a rally next to an enemy worker (no attackRange)', () => {
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    // Worker has no attackRange — must NOT trigger rally rejection.
    spawnUnit(w, 'worker', 'enemy', { x: 700, y: 700 });
    const ok = applyAICommand(w, 'player', {
      type: 'setRally',
      buildingId: cc.id,
      pos: { x: 705, y: 705 },
    });
    expect(ok.ok).toBe(true);
    expect(cc.rallyPoint).toEqual({ x: 705, y: 705 });
  });

  it('setRally accepts a rally next to an enemy CC (no attackRange)', () => {
    const w = createWorld();
    const myCc = spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    // Enemy CC has no weapon. (Turret-defended bases trigger via the turret entity.)
    const enemyCc = spawnBuilding(w, 'commandCenter', 'enemy', 50, 50);
    const ok = applyAICommand(w, 'player', {
      type: 'setRally',
      buildingId: myCc.id,
      pos: { x: enemyCc.pos.x + 30, y: enemyCc.pos.y + 30 },
    });
    expect(ok.ok).toBe(true);
  });

  it('cancel pops last queued production and refunds cost', () => {
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'enemy', 10, 10);
    w.resources.enemy = 500;
    applyAICommand(w, 'enemy', { type: 'produce', buildingId: cc.id, unit: 'worker' });
    expect(w.resources.enemy).toBe(450);
    const ok = applyAICommand(w, 'enemy', { type: 'cancel', entityId: cc.id });
    expect(ok.ok).toBe(true);
    expect(cc.productionQueue?.length).toBe(0);
    expect(w.resources.enemy).toBe(500);
  });

  it('cancel on a unit clears its command and gather state', () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(5, 5));
    m.command = { type: 'move', target: { x: 100, y: 100 } };
    const ok = applyAICommand(w, 'player', { type: 'cancel', entityId: m.id });
    expect(ok.ok).toBe(true);
    expect(m.command).toBeNull();
  });
});

describe('applyAICommand: building-worker hard guard', () => {
  function setupBuildingWorker(): {
    w: ReturnType<typeof createWorld>;
    worker: ReturnType<typeof spawnUnit>;
    site: ReturnType<typeof spawnBuilding>;
  } {
    const w = createWorld();
    const worker = spawnUnit(w, 'worker', 'enemy', cellToPx(20, 20));
    const site = spawnBuilding(w, 'barracks', 'enemy', 30, 30, false);
    worker.command = { type: 'build', buildingId: site.id };
    return { w, worker, site };
  }

  it('rejects move on a worker that is currently building', () => {
    const { w, worker, site } = setupBuildingWorker();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = applyAICommand(w, 'enemy', {
      type: 'move',
      unitIds: [worker.id],
      target: { x: 200, y: 200 },
    });
    expect(r.ok).toBe(false);
    expect(worker.command).toEqual({ type: 'build', buildingId: site.id });
    // The per-unit warn message contains the building id and a corrective hint.
    const warnMsg = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warnMsg).toContain(`worker ${worker.id} is building`);
    expect(warnMsg).toContain(`#${site.id}`);
    expect(warnMsg).toMatch(/cancel first|wait for completion/);
    warn.mockRestore();
  });

  it('rejects attackMove on a worker that is currently building', () => {
    const { w, worker, site } = setupBuildingWorker();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = applyAICommand(w, 'enemy', {
      type: 'attackMove',
      unitIds: [worker.id],
      target: { x: 200, y: 200 },
    });
    expect(r.ok).toBe(false);
    expect(worker.command).toEqual({ type: 'build', buildingId: site.id });
    warn.mockRestore();
  });

  it('rejects gather on a worker that is currently building', () => {
    const { w, worker, site } = setupBuildingWorker();
    const node = spawnMineralNode(w, 50, 50, 1500);
    const depot = spawnBuilding(w, 'supplyDepot', 'enemy', 50, 50);
    node.depotId = depot.id;
    depot.mineralNodeId = node.id;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = applyAICommand(w, 'enemy', {
      type: 'gather',
      unitIds: [worker.id],
      nodeId: node.id,
    });
    expect(r.ok).toBe(false);
    expect(worker.command).toEqual({ type: 'build', buildingId: site.id });
    expect(worker.gatherSubState).toBeUndefined();
    warn.mockRestore();
  });

  it('rejects attack on a worker that is currently building', () => {
    // Workers don't have attackRange so attack is normally rejected anyway —
    // but the build-guard runs first and surfaces the more useful reason.
    const { w, worker, site } = setupBuildingWorker();
    const enemy = spawnUnit(w, 'marine', 'player', cellToPx(40, 40));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = applyAICommand(w, 'enemy', {
      type: 'attack',
      unitIds: [worker.id],
      targetId: enemy.id,
    });
    expect(r.ok).toBe(false);
    expect(worker.command).toEqual({ type: 'build', buildingId: site.id });
    const warnMsg = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warnMsg).toContain(`worker ${worker.id} is building`);
    warn.mockRestore();
  });

  it('cancel still works on a building worker (explicit escape hatch)', () => {
    const { w, worker } = setupBuildingWorker();
    const r = applyAICommand(w, 'enemy', { type: 'cancel', entityId: worker.id });
    expect(r.ok).toBe(true);
    expect(worker.command).toBeNull();
  });

  it('does not block other (non-building) workers in the same batch', () => {
    const { w, worker: builder } = setupBuildingWorker();
    const idleWorker = spawnUnit(w, 'worker', 'enemy', cellToPx(25, 25));
    const node = spawnMineralNode(w, 50, 50, 1500);
    const depot = spawnBuilding(w, 'supplyDepot', 'enemy', 50, 50);
    node.depotId = depot.id;
    depot.mineralNodeId = node.id;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = applyAICommand(w, 'enemy', {
      type: 'gather',
      unitIds: [builder.id, idleWorker.id],
      nodeId: node.id,
    });
    // Batch semantics: at least one valid → ok=true. Builder retains build.
    expect(r.ok).toBe(true);
    expect(builder.command?.type).toBe('build');
    expect(idleWorker.command).toEqual({ type: 'gather', nodeId: node.id });
    warn.mockRestore();
  });
});

describe('applyAICommand: Result.reason content (LLM feedback)', () => {
  it('produce: insufficient minerals carries that reason', () => {
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'enemy', 10, 10);
    w.resources.enemy = 10;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = applyAICommand(w, 'enemy', { type: 'produce', buildingId: cc.id, unit: 'worker' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('insufficient minerals');
    warn.mockRestore();
  });

  it('build: site blocked carries that reason', () => {
    const w = createWorld();
    w.resources.enemy = 1000;
    const worker = spawnUnit(w, 'worker', 'enemy', cellToPx(5, 5));
    spawnBuilding(w, 'commandCenter', 'enemy', 20, 20);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = applyAICommand(w, 'enemy', {
      type: 'build',
      workerId: worker.id,
      building: 'barracks',
      cellX: 20,
      cellY: 20,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/blocked|footprint/);
    warn.mockRestore();
  });

  it('gather: missing node carries that reason', () => {
    const w = createWorld();
    const worker = spawnUnit(w, 'worker', 'enemy', cellToPx(5, 5));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = applyAICommand(w, 'enemy', { type: 'gather', unitIds: [worker.id], nodeId: 99999 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('99999');
    warn.mockRestore();
  });

  it('move with mixed valid/invalid unitIds returns ok (batch semantics)', () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(5, 5));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = applyAICommand(w, 'player', {
      type: 'move',
      unitIds: [m.id, 99999],
      target: { x: 200, y: 200 },
    });
    expect(r.ok).toBe(true);
    expect(m.command?.type).toBe('move');
    warn.mockRestore();
  });

  it('move with all-invalid unitIds returns ok=false with reason listing IDs', () => {
    const w = createWorld();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = applyAICommand(w, 'player', {
      type: 'move',
      unitIds: [99999, 88888],
      target: { x: 200, y: 200 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain('99999');
      expect(r.reason).toContain('88888');
    }
    warn.mockRestore();
  });
});
