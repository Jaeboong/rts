import { describe, expect, it } from 'vitest';

import type { Entity } from '../../types';
import { spawnBuilding, spawnMineralNode, spawnUnit } from '../entities';
import { cellToPx, createWorld, type World } from '../world';

import { ScriptedAI } from './scripted-ai';
import { runPlayers } from './runner';
import { buildView } from './view';

function seedTier3World(): World {
  const w = createWorld();
  w.resources.enemy = 250;
  spawnBuilding(w, 'commandCenter', 'enemy', 10, 10);
  spawnMineralNode(w, 30, 30, 1500);
  spawnUnit(w, 'worker', 'enemy', cellToPx(26, 26));
  spawnUnit(w, 'worker', 'enemy', cellToPx(27, 26));
  return w;
}

describe('ScriptedAI Tier 3: build-order step 1 = supplyDepot', () => {
  it('first tick issues a supplyDepot build aimed at the nearest mineralNode', () => {
    const w = seedTier3World();
    const ai = new ScriptedAI('enemy', w, { tier: 3 });
    const cmds = ai.tick(buildView(w, 'enemy'), 1 / 20);
    const buildCmd = cmds.find((c) => c.type === 'build');
    expect(buildCmd).toBeDefined();
    expect(buildCmd?.type).toBe('build');
    if (buildCmd && buildCmd.type === 'build') {
      expect(buildCmd.building).toBe('supplyDepot');
      expect(buildCmd.cellX).toBe(30);
      expect(buildCmd.cellY).toBe(30);
    }
  });

  it('does not re-issue supplyDepot build once one exists (idempotent)', () => {
    const w = seedTier3World();
    // Pre-place a depot — the AI should skip step 0 and try step 1 (barracks).
    const node = [...w.entities.values()].find((e) => e.kind === 'mineralNode') as Entity;
    const depot = spawnBuilding(w, 'supplyDepot', 'enemy', node.cellX!, node.cellY!);
    node.depotId = depot.id;
    depot.mineralNodeId = node.id;

    const ai = new ScriptedAI('enemy', w, { tier: 3 });
    const cmds = ai.tick(buildView(w, 'enemy'), 1 / 20);
    const supplyCmd = cmds.find((c) => c.type === 'build' && c.building === 'supplyDepot');
    expect(supplyCmd).toBeUndefined();
    // Should attempt the next step (barracks).
    const barracksCmd = cmds.find((c) => c.type === 'build' && c.building === 'barracks');
    expect(barracksCmd).toBeDefined();
  });
});

describe('ScriptedAI Tier 3: produce step', () => {
  it('queues a marine on a completed barracks once reached', () => {
    const w = seedTier3World();
    // Pre-stamp depot + completed barracks to skip ahead to produce step.
    const node = [...w.entities.values()].find((e) => e.kind === 'mineralNode') as Entity;
    const depot = spawnBuilding(w, 'supplyDepot', 'enemy', node.cellX!, node.cellY!);
    node.depotId = depot.id;
    depot.mineralNodeId = node.id;
    const barracks = spawnBuilding(w, 'barracks', 'enemy', 50, 50);
    expect(barracks.underConstruction).toBe(false);

    const ai = new ScriptedAI('enemy', w, { tier: 3 });
    const cmds = ai.tick(buildView(w, 'enemy'), 1 / 20);
    const produceCmd = cmds.find((c) => c.type === 'produce');
    expect(produceCmd).toBeDefined();
    if (produceCmd && produceCmd.type === 'produce') {
      expect(produceCmd.unit).toBe('marine');
      expect(produceCmd.buildingId).toBe(barracks.id);
    }
  });

  it('does not queue if barracks already has 1 in queue (idempotent)', () => {
    const w = seedTier3World();
    const node = [...w.entities.values()].find((e) => e.kind === 'mineralNode') as Entity;
    const depot = spawnBuilding(w, 'supplyDepot', 'enemy', node.cellX!, node.cellY!);
    node.depotId = depot.id;
    depot.mineralNodeId = node.id;
    const barracks = spawnBuilding(w, 'barracks', 'enemy', 50, 50);
    barracks.productionQueue = [
      { produces: 'marine', totalSeconds: 15, remainingSeconds: 15 },
    ];

    const ai = new ScriptedAI('enemy', w, { tier: 3 });
    const cmds = ai.tick(buildView(w, 'enemy'), 1 / 20);
    expect(cmds.find((c) => c.type === 'produce')).toBeUndefined();
  });
});

describe('ScriptedAI Tier 3: wave step', () => {
  it('emits attackMove with N marines once they exist', () => {
    const w = createWorld();
    w.resources.enemy = 0;
    spawnBuilding(w, 'commandCenter', 'enemy', 10, 10);
    spawnMineralNode(w, 30, 30, 1500);
    const node = [...w.entities.values()].find((e) => e.kind === 'mineralNode') as Entity;
    const depot = spawnBuilding(w, 'supplyDepot', 'enemy', node.cellX!, node.cellY!);
    node.depotId = depot.id;
    depot.mineralNodeId = node.id;
    spawnBuilding(w, 'barracks', 'enemy', 50, 50);
    // 4 marines + a player CC as wave target
    spawnBuilding(w, 'commandCenter', 'player', 80, 80);
    for (let i = 0; i < 4; i++) {
      spawnUnit(w, 'marine', 'enemy', cellToPx(40 + i, 40));
    }

    const ai = new ScriptedAI('enemy', w, { tier: 3 });
    // Each tick advances one step at most. Run until we get an attackMove.
    let attackMove = null;
    for (let t = 0; t < 20 && !attackMove; t++) {
      const cmds = ai.tick(buildView(w, 'enemy'), 1 / 20);
      attackMove = cmds.find((c) => c.type === 'attackMove') ?? null;
      w.tickCount++;
    }
    expect(attackMove).toBeTruthy();
    if (attackMove && attackMove.type === 'attackMove') {
      expect(attackMove.unitIds.length).toBe(4);
      // Target should be the player CC (only visible enemy building).
      expect(attackMove.target.x).toBeCloseTo(80 * 16 + (15 * 16) / 2, 0);
    }
  });
});

describe('ScriptedAI Tier 3: deterministic across runs', () => {
  function snapshotEntities(w: World): Array<{
    kind: string;
    team: string;
    x: number;
    y: number;
    hp: number;
  }> {
    return [...w.entities.values()]
      .map((e) => ({
        kind: e.kind,
        team: e.team,
        x: Math.round(e.pos.x),
        y: Math.round(e.pos.y),
        hp: e.hp,
      }))
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
        if (a.team !== b.team) return a.team < b.team ? -1 : 1;
        if (a.x !== b.x) return a.x - b.x;
        return a.y - b.y;
      });
  }

  it('two identical worlds produce identical entity snapshots after N ticks', async () => {
    // Use the actual production runTick pipeline so we exercise everything.
    const { runTick } = await import('../simulate');
    function buildScene(): { w: World; ai: ScriptedAI } {
      const w = seedTier3World();
      const ai = new ScriptedAI('enemy', w, { tier: 3 });
      return { w, ai };
    }
    const a = buildScene();
    const b = buildScene();

    // Drive both worlds with the same loop. We bypass the Game struct entirely
    // and call the mutating stages by hand (mirrors loop.ts ordering).
    const fakeGame = (w: World): Parameters<typeof runTick>[0] =>
      // runTick only reads .world from Game, so we can fake the rest.
      ({ world: w } as unknown as Parameters<typeof runTick>[0]);
    const TICKS = 1200; // 60s at 20Hz — enough to exercise build + production
    for (let t = 0; t < TICKS; t++) {
      runPlayers(a.w, [a.ai], 1 / 20);
      runTick(fakeGame(a.w));
      a.w.tickCount++;
      runPlayers(b.w, [b.ai], 1 / 20);
      runTick(fakeGame(b.w));
      b.w.tickCount++;
    }
    expect(snapshotEntities(a.w)).toEqual(snapshotEntities(b.w));
  });
});
