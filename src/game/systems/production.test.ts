import { describe, expect, it } from 'vitest';
import { CELL } from '../../types';
import { UNIT_PRODUCTION } from '../balance';
import { spawnBuilding, spawnMineralNode } from '../entities';
import { enqueueProductionOn } from '../commands';
import { createWorld } from '../world';
import { productionSystem } from './production';

const DT = 1 / 20;

function runUntilSpawn(
  w: ReturnType<typeof createWorld>,
  totalSeconds: number,
): void {
  const ticks = Math.ceil((totalSeconds + 0.5) / DT);
  for (let i = 0; i < ticks; i++) productionSystem(w, DT);
}

describe('production system', () => {
  it('progresses queue and spawns unit', () => {
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const def = UNIT_PRODUCTION.worker!;
    cc.productionQueue!.push({
      produces: 'worker',
      totalSeconds: def.seconds,
      remainingSeconds: def.seconds,
    });
    const before = w.entities.size;

    runUntilSpawn(w, def.seconds);

    expect(cc.productionQueue!.length).toBe(0);
    expect(w.entities.size).toBe(before + 1);
    const newest = [...w.entities.values()].pop();
    expect(newest!.kind).toBe('worker');
    expect(newest!.team).toBe('player');
  });

  it('handles multiple queued items in order', () => {
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const def = UNIT_PRODUCTION.worker!;
    for (let i = 0; i < 3; i++) {
      cc.productionQueue!.push({
        produces: 'worker',
        totalSeconds: def.seconds,
        remainingSeconds: def.seconds,
      });
    }
    const ticks = Math.ceil((def.seconds * 3 + 1) / DT);
    for (let i = 0; i < ticks; i++) productionSystem(w, DT);
    expect(cc.productionQueue!.length).toBe(0);
    const workers = [...w.entities.values()].filter((e) => e.kind === 'worker');
    expect(workers.length).toBe(3);
  });
});

describe('production rally dispatch', () => {
  it('null rallyPoint → spawned unit has no command', () => {
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const def = UNIT_PRODUCTION.worker!;
    cc.productionQueue!.push({
      produces: 'worker',
      totalSeconds: def.seconds,
      remainingSeconds: def.seconds,
    });
    const before = w.entities.size;

    runUntilSpawn(w, def.seconds);

    expect(w.entities.size).toBe(before + 1);
    const spawned = [...w.entities.values()].pop()!;
    expect(spawned.command).toBeNull();
  });

  it('rallyPoint on empty walkable cell → Move command with exact pixel target', () => {
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const rally = { x: 40 * CELL + 7, y: 40 * CELL + 11 };
    cc.rallyPoint = rally;
    const def = UNIT_PRODUCTION.worker!;
    cc.productionQueue!.push({
      produces: 'worker',
      totalSeconds: def.seconds,
      remainingSeconds: def.seconds,
    });

    runUntilSpawn(w, def.seconds);

    const spawned = [...w.entities.values()].pop()!;
    expect(spawned.kind).toBe('worker');
    expect(spawned.command).toEqual({ type: 'move', target: rally });
    // Ensure spread copy (not aliased to the rallyPoint reference)
    const cmd = spawned.command;
    if (!cmd || cmd.type !== 'move') throw new Error('expected move');
    expect(cmd.target).not.toBe(rally);
  });

  it('rallyPoint on mineral cell + Worker → Gather command targeting that node', () => {
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const node = spawnMineralNode(w, 30, 30);
    cc.rallyPoint = { x: 30 * CELL + CELL / 2, y: 30 * CELL + CELL / 2 };
    const def = UNIT_PRODUCTION.worker!;
    cc.productionQueue!.push({
      produces: 'worker',
      totalSeconds: def.seconds,
      remainingSeconds: def.seconds,
    });

    runUntilSpawn(w, def.seconds);

    const spawned = [...w.entities.values()]
      .reverse()
      .find((e) => e.kind === 'worker')!;
    expect(spawned.command).toEqual({ type: 'gather', nodeId: node.id });
  });

  it('rallyPoint on supplyDepot + Worker → Gather (depot resolves to underlying mineralNode)', () => {
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    // Stamp a supplyDepot directly on the mineralNode footprint (mirrors hosted-build).
    const node = spawnMineralNode(w, 30, 30);
    const depot = spawnBuilding(w, 'supplyDepot', 'player', 30, 30);
    node.depotId = depot.id;
    depot.mineralNodeId = node.id;
    cc.rallyPoint = { x: 30 * CELL + CELL / 2, y: 30 * CELL + CELL / 2 };
    const def = UNIT_PRODUCTION.worker!;
    cc.productionQueue!.push({
      produces: 'worker',
      totalSeconds: def.seconds,
      remainingSeconds: def.seconds,
    });

    runUntilSpawn(w, def.seconds);

    const spawned = [...w.entities.values()]
      .reverse()
      .find((e) => e.kind === 'worker')!;
    // Gather targets the depot id; gather.ts resolves depot → underlying mineralNode.
    expect(spawned.command).toEqual({ type: 'gather', nodeId: depot.id });
  });

  it('rallyPoint on mineral cell + Marine → Move command clamped to walkable', () => {
    const w = createWorld();
    // Barracks (15×15) at (10,10) covers cells 10..24; place mineral at row 40 to clear it.
    const barracks = spawnBuilding(w, 'barracks', 'player', 10, 10);
    spawnMineralNode(w, 40, 40);
    const rally = { x: 40 * CELL + CELL / 2, y: 40 * CELL + CELL / 2 };
    barracks.rallyPoint = rally;
    const def = UNIT_PRODUCTION.marine!;
    barracks.productionQueue!.push({
      produces: 'marine',
      totalSeconds: def.seconds,
      remainingSeconds: def.seconds,
    });

    runUntilSpawn(w, def.seconds);

    const spawned = [...w.entities.values()]
      .reverse()
      .find((e) => e.kind === 'marine')!;
    expect(spawned.command?.type).toBe('move');
    if (spawned.command?.type !== 'move') throw new Error('expected move');
    // Clamp must not leave it on the mineral cell.
    expect(spawned.command.target).not.toEqual(rally);
    // Clamped target must lie on a walkable cell (mineral is 5×5 at cells 40..44).
    const tx = Math.floor(spawned.command.target.x / CELL);
    const ty = Math.floor(spawned.command.target.y / CELL);
    const onMineral = tx >= 40 && tx <= 44 && ty >= 40 && ty <= 44;
    expect(onMineral).toBe(false);
  });

  it('rallyPoint on building cell + Worker → Move command clamped to walkable', () => {
    const w = createWorld();
    // CC (20×20) at (10,10) covers cells 10..29; place barracks at (40,40) so footprints don't touch.
    const cc = spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    spawnBuilding(w, 'barracks', 'player', 40, 40);
    const rally = { x: 41 * CELL + CELL / 2, y: 41 * CELL + CELL / 2 };
    cc.rallyPoint = rally;
    const def = UNIT_PRODUCTION.worker!;
    cc.productionQueue!.push({
      produces: 'worker',
      totalSeconds: def.seconds,
      remainingSeconds: def.seconds,
    });

    runUntilSpawn(w, def.seconds);

    const spawned = [...w.entities.values()]
      .reverse()
      .find((e) => e.kind === 'worker')!;
    expect(spawned.command?.type).toBe('move');
    if (spawned.command?.type !== 'move') throw new Error('expected move');
    expect(spawned.command.target).not.toEqual(rally);
    const tx = Math.floor(spawned.command.target.x / CELL);
    const ty = Math.floor(spawned.command.target.y / CELL);
    // Barracks (15×15) occupies cells 40..54.
    const onBarracks =
      tx >= 40 && tx <= 54 && ty >= 40 && ty <= 54;
    expect(onBarracks).toBe(false);
  });

  it('rallyPoint on building cell + Marine → Move command clamped to walkable', () => {
    const w = createWorld();
    // Barracks (15×15) at (10,10) covers cells 10..24; place turret at (40,40) so footprints don't touch.
    const barracks = spawnBuilding(w, 'barracks', 'player', 10, 10);
    spawnBuilding(w, 'turret', 'player', 40, 40);
    const rally = { x: 40 * CELL + 4, y: 40 * CELL + 4 };
    barracks.rallyPoint = rally;
    const def = UNIT_PRODUCTION.marine!;
    barracks.productionQueue!.push({
      produces: 'marine',
      totalSeconds: def.seconds,
      remainingSeconds: def.seconds,
    });

    runUntilSpawn(w, def.seconds);

    const spawned = [...w.entities.values()]
      .reverse()
      .find((e) => e.kind === 'marine')!;
    expect(spawned.command?.type).toBe('move');
    if (spawned.command?.type !== 'move') throw new Error('expected move');
    expect(spawned.command.target).not.toEqual(rally);
    const tx = Math.floor(spawned.command.target.x / CELL);
    const ty = Math.floor(spawned.command.target.y / CELL);
    // Turret (5×5) occupies cells 40..44.
    const onTurret =
      tx >= 40 && tx <= 44 && ty >= 40 && ty <= 44;
    expect(onTurret).toBe(false);
  });
});

describe('production gas-cost gating', () => {
  it('insufficient gas → tank queue refused, no resource change', () => {
    const w = createWorld();
    const fac = spawnBuilding(w, 'factory', 'player', 30, 30);
    w.resources.player = 1000;
    w.gas = 50; // tank needs 100
    const before = { min: w.resources.player, gas: w.gas };
    const ok = enqueueProductionOn(w, fac, 'tank');
    expect(ok).toBe(false);
    expect(fac.productionQueue!.length).toBe(0);
    expect(w.resources.player).toBe(before.min);
    expect(w.gas).toBe(before.gas);
  });

  it('sufficient resources → tank queued, costs deducted (250 min + 100 gas)', () => {
    const w = createWorld();
    const fac = spawnBuilding(w, 'factory', 'player', 30, 30);
    w.resources.player = 500;
    w.gas = 200;
    const ok = enqueueProductionOn(w, fac, 'tank');
    expect(ok).toBe(true);
    expect(fac.productionQueue!.length).toBe(1);
    expect(fac.productionQueue![0].produces).toBe('tank');
    expect(w.resources.player).toBe(500 - 250);
    expect(w.gas).toBe(200 - 100);
  });

  it('gas-only-shortfall (mineral OK) → refused', () => {
    const w = createWorld();
    const fac = spawnBuilding(w, 'factory', 'player', 30, 30);
    w.resources.player = 9999;
    w.gas = 0;
    const ok = enqueueProductionOn(w, fac, 'tank');
    expect(ok).toBe(false);
    expect(w.resources.player).toBe(9999);
    expect(w.gas).toBe(0);
  });

  it('marine queue ignores gas (no gasCost) — stays unchanged', () => {
    const w = createWorld();
    const bx = spawnBuilding(w, 'barracks', 'player', 30, 30);
    w.resources.player = 50;
    w.gas = 0;
    const ok = enqueueProductionOn(w, bx, 'marine');
    expect(ok).toBe(true);
    expect(w.gas).toBe(0);
  });

  it('production system spawns a tank after seconds pass', () => {
    const w = createWorld();
    const fac = spawnBuilding(w, 'factory', 'player', 30, 30);
    const def = UNIT_PRODUCTION.tank!;
    fac.productionQueue!.push({
      produces: 'tank',
      totalSeconds: def.seconds,
      remainingSeconds: def.seconds,
    });
    const before = w.entities.size;
    const ticks = Math.ceil((def.seconds + 0.5) / (1 / 20));
    for (let i = 0; i < ticks; i++) productionSystem(w, 1 / 20);
    expect(fac.productionQueue!.length).toBe(0);
    expect(w.entities.size).toBe(before + 1);
    const newest = [...w.entities.values()].pop()!;
    expect(newest.kind).toBe('tank');
    expect(newest.team).toBe('player');
  });
});

describe('production: tank-light from factory', () => {
  it('sufficient resources → tank-light queued, costs deducted (120 min + 30 gas)', () => {
    const w = createWorld();
    const fac = spawnBuilding(w, 'factory', 'player', 30, 30);
    w.resources.player = 500;
    w.gas = 200;
    const ok = enqueueProductionOn(w, fac, 'tank-light');
    expect(ok).toBe(true);
    expect(fac.productionQueue!.length).toBe(1);
    expect(fac.productionQueue![0].produces).toBe('tank-light');
    expect(w.resources.player).toBe(500 - 120);
    expect(w.gas).toBe(200 - 30);
  });

  it('insufficient gas → tank-light queue refused, no resource change', () => {
    const w = createWorld();
    const fac = spawnBuilding(w, 'factory', 'player', 30, 30);
    w.resources.player = 1000;
    w.gas = 10; // tank-light needs 30
    const ok = enqueueProductionOn(w, fac, 'tank-light');
    expect(ok).toBe(false);
    expect(fac.productionQueue!.length).toBe(0);
    expect(w.resources.player).toBe(1000);
    expect(w.gas).toBe(10);
  });

  it('insufficient mineral → tank-light queue refused, no resource change', () => {
    const w = createWorld();
    const fac = spawnBuilding(w, 'factory', 'player', 30, 30);
    w.resources.player = 50; // tank-light needs 120
    w.gas = 200;
    const ok = enqueueProductionOn(w, fac, 'tank-light');
    expect(ok).toBe(false);
    expect(fac.productionQueue!.length).toBe(0);
    expect(w.resources.player).toBe(50);
    expect(w.gas).toBe(200);
  });

  it('barracks cannot produce tank-light (wrong producer)', () => {
    const w = createWorld();
    const bx = spawnBuilding(w, 'barracks', 'player', 30, 30);
    w.resources.player = 500;
    w.gas = 200;
    const ok = enqueueProductionOn(w, bx, 'tank-light');
    expect(ok).toBe(false);
    expect(bx.productionQueue!.length).toBe(0);
  });
});

describe('production: medic from barracks', () => {
  it('sufficient resources → medic queued, costs deducted (50 min + 25 gas)', () => {
    const w = createWorld();
    const bx = spawnBuilding(w, 'barracks', 'player', 30, 30);
    w.resources.player = 200;
    w.gas = 100;
    const ok = enqueueProductionOn(w, bx, 'medic');
    expect(ok).toBe(true);
    expect(bx.productionQueue!.length).toBe(1);
    expect(bx.productionQueue![0].produces).toBe('medic');
    expect(w.resources.player).toBe(200 - 50);
    expect(w.gas).toBe(100 - 25);
  });

  it('insufficient gas → medic queue refused, no resource change', () => {
    const w = createWorld();
    const bx = spawnBuilding(w, 'barracks', 'player', 30, 30);
    w.resources.player = 200;
    w.gas = 10; // medic needs 25
    const ok = enqueueProductionOn(w, bx, 'medic');
    expect(ok).toBe(false);
    expect(bx.productionQueue!.length).toBe(0);
    expect(w.resources.player).toBe(200);
    expect(w.gas).toBe(10);
  });

  it('insufficient mineral → refused', () => {
    const w = createWorld();
    const bx = spawnBuilding(w, 'barracks', 'player', 30, 30);
    w.resources.player = 10;
    w.gas = 100;
    const ok = enqueueProductionOn(w, bx, 'medic');
    expect(ok).toBe(false);
    expect(w.resources.player).toBe(10);
    expect(w.gas).toBe(100);
  });

  it('factory cannot produce medic (wrong producer)', () => {
    const w = createWorld();
    const fac = spawnBuilding(w, 'factory', 'player', 30, 30);
    w.resources.player = 500;
    w.gas = 200;
    const ok = enqueueProductionOn(w, fac, 'medic');
    expect(ok).toBe(false);
    expect(fac.productionQueue!.length).toBe(0);
  });

  it('production system spawns a medic after seconds pass', () => {
    const w = createWorld();
    const bx = spawnBuilding(w, 'barracks', 'player', 30, 30);
    const def = UNIT_PRODUCTION.medic!;
    bx.productionQueue!.push({
      produces: 'medic',
      totalSeconds: def.seconds,
      remainingSeconds: def.seconds,
    });
    const before = w.entities.size;
    const ticks = Math.ceil((def.seconds + 0.5) / (1 / 20));
    for (let i = 0; i < ticks; i++) productionSystem(w, 1 / 20);
    expect(bx.productionQueue!.length).toBe(0);
    expect(w.entities.size).toBe(before + 1);
    const newest = [...w.entities.values()].pop()!;
    expect(newest.kind).toBe('medic');
    expect(newest.team).toBe('player');
  });
});
