import { describe, expect, it } from 'vitest';
import { spawnBuilding, spawnMineralNode, spawnUnit } from '../entities';
import { cellToPx, createWorld } from '../world';
import { runPlayers } from './runner';
import { ScriptedAI } from './scripted-ai';
import { buildView } from './view';

function seedNodeWithDepot(world: ReturnType<typeof createWorld>, cx: number, cy: number, team: 'player' | 'enemy' = 'enemy') {
  const node = spawnMineralNode(world, cx, cy, 1500);
  const depot = spawnBuilding(world, 'supplyDepot', team, cx, cy);
  node.depotId = depot.id;
  depot.mineralNodeId = node.id;
  return { node, depot };
}

describe('ScriptedAI Tier 1', () => {
  it('issues a gather command to each idle owned worker on first tick', () => {
    const w = createWorld();
    const { node } = seedNodeWithDepot(w, 30, 30);
    const w1 = spawnUnit(w, 'worker', 'enemy', cellToPx(20, 20));
    const w2 = spawnUnit(w, 'worker', 'enemy', cellToPx(22, 20));

    const ai = new ScriptedAI('enemy', w, { tier: 1 });
    const cmds = ai.tick(buildView(w, 'enemy'), 1 / 20);
    expect(cmds).toHaveLength(2);
    expect(cmds[0]).toEqual({ type: 'gather', unitIds: [w1.id], nodeId: node.id });
    expect(cmds[1]).toEqual({ type: 'gather', unitIds: [w2.id], nodeId: node.id });
  });

  it('does not re-issue gather to a worker already gathering (idempotent)', () => {
    const w = createWorld();
    const { node } = seedNodeWithDepot(w, 30, 30);
    const wkr = spawnUnit(w, 'worker', 'enemy', cellToPx(20, 20));
    wkr.command = { type: 'gather', nodeId: node.id };

    const ai = new ScriptedAI('enemy', w, { tier: 1 });
    expect(ai.tick(buildView(w, 'enemy'), 1 / 20)).toEqual([]);
  });

  it('skips workers of other teams', () => {
    const w = createWorld();
    seedNodeWithDepot(w, 30, 30, 'enemy');
    spawnUnit(w, 'worker', 'player', cellToPx(20, 20));
    const ai = new ScriptedAI('enemy', w, { tier: 1 });
    expect(ai.tick(buildView(w, 'enemy'), 1 / 20)).toEqual([]);
  });

  it('emits no commands when no depot-claimed node exists (raw mineralNodes only)', () => {
    const w = createWorld();
    spawnMineralNode(w, 30, 30, 1500); // no depot
    spawnUnit(w, 'worker', 'enemy', cellToPx(20, 20));
    const ai = new ScriptedAI('enemy', w, { tier: 1 });
    expect(ai.tick(buildView(w, 'enemy'), 1 / 20)).toEqual([]);
  });

  it('picks the nearer of two depot-claimed nodes', () => {
    const w = createWorld();
    const { node: near } = seedNodeWithDepot(w, 25, 20);
    seedNodeWithDepot(w, 90, 90);
    const wkr = spawnUnit(w, 'worker', 'enemy', cellToPx(20, 20));
    const ai = new ScriptedAI('enemy', w, { tier: 1 });
    const cmds = ai.tick(buildView(w, 'enemy'), 1 / 20);
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toEqual({ type: 'gather', unitIds: [wkr.id], nodeId: near.id });
  });

  it('end-to-end: runPlayers makes an enemy worker actually start gathering', () => {
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'enemy', 10, 10);
    const { node } = seedNodeWithDepot(w, 36, 12);
    const wkr = spawnUnit(w, 'worker', 'enemy', cellToPx(34, 12));
    const ai = new ScriptedAI('enemy', w, { tier: 1 });

    runPlayers(w, [ai], 1 / 20);
    expect(wkr.command).toEqual({ type: 'gather', nodeId: node.id });
  });

  it('is deterministic across runs (no Math.random)', () => {
    const buildScene = () => {
      const w = createWorld();
      seedNodeWithDepot(w, 30, 30);
      spawnUnit(w, 'worker', 'enemy', cellToPx(20, 20));
      spawnUnit(w, 'worker', 'enemy', cellToPx(22, 20));
      return w;
    };
    const a = buildScene();
    const b = buildScene();
    const cmdsA = new ScriptedAI('enemy', a, { tier: 1 }).tick(buildView(a, 'enemy'), 1 / 20);
    const cmdsB = new ScriptedAI('enemy', b, { tier: 1 }).tick(buildView(b, 'enemy'), 1 / 20);
    expect(cmdsA).toEqual(cmdsB);
  });
});
