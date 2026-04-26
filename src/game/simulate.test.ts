import { describe, expect, it } from 'vitest';

import {
  spawnBuilding,
  spawnGasGeyser,
  spawnMineralNode,
  spawnUnit,
} from './entities';
import { runTick } from './simulate';
import { cellIndex, cellToPx, createWorld } from './world';
import { TICK_DT } from './loop';
import type { Game } from './loop';
import { combatSystem } from './systems/combat';

function makeGame(world: ReturnType<typeof createWorld>): Game {
  return {
    ctx: null as never,
    canvas: null as never,
    world,
    camera: null as never,
    input: null as never,
    hud: null as never,
    speedFactor: 1,
    paused: false,
    atlas: null,
    tileAtlas: null,
    players: [],
  };
}

describe('driveCommands attackMove engagement', () => {
  it('marine with hostile in attackRange does not creep forward each tick', () => {
    const w = createWorld();
    // 8 cells apart: well inside marine attackRange (10*CELL) but far outside
    // collision (sum radii ≈ 22px), so any movement is from the bug, not physics.
    const m = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(18, 10));
    m.command = { type: 'attackMove', target: cellToPx(50, 10) };
    const startX = m.pos.x;

    const game = makeGame(w);
    for (let i = 0; i < 20; i++) runTick(game);

    expect(m.pos.x).toBe(startX);
    expect(m.path).toBeNull();
  });

  it('marine with no hostile in range walks toward attackMove target normally', () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    m.command = { type: 'attackMove', target: cellToPx(50, 10) };
    const startX = m.pos.x;

    const game = makeGame(w);
    for (let i = 0; i < 20; i++) runTick(game);

    expect(m.pos.x).toBeGreaterThan(startX);
  });

  it('combat-only sanity: in-range hostile does take damage tick after tick', () => {
    const w = createWorld();
    spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    const e = spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(11, 10));
    const startHp = e.hp;
    for (let i = 0; i < 5; i++) combatSystem(w, TICK_DT);
    expect(e.hp).toBeLessThan(startHp);
  });
});

describe('cleanupDead releases stamped resources', () => {
  it('supplyDepot dies → underlying mineralNode is re-exposed (depotId null), still occupied, still alive', () => {
    const w = createWorld();
    const node = spawnMineralNode(w, 35, 40, 1500);
    const depot = spawnBuilding(w, 'supplyDepot', 'player', 35, 40);
    node.depotId = depot.id;
    depot.mineralNodeId = node.id;

    // Kill the depot.
    depot.hp = 0;

    runTick(makeGame(w));

    // Depot removed, node survives.
    expect(w.entities.has(depot.id)).toBe(false);
    expect(w.entities.has(node.id)).toBe(true);
    expect(node.depotId).toBeNull();
    // Footprint cells re-stamped to the node id (not -1).
    expect(w.occupancy[cellIndex(node.cellX!, node.cellY!)]).toBe(node.id);
    expect(w.occupancy[cellIndex(node.cellX! + 4, node.cellY! + 4)]).toBe(node.id);
  });

  it('refinery dies → underlying gasGeyser is re-exposed (refineryId null), still occupied', () => {
    const w = createWorld();
    const geyser = spawnGasGeyser(w, 35, 40);
    const refinery = spawnBuilding(w, 'refinery', 'player', 35, 40);
    geyser.refineryId = refinery.id;
    refinery.geyserId = geyser.id;

    refinery.hp = 0;

    runTick(makeGame(w));

    expect(w.entities.has(refinery.id)).toBe(false);
    expect(w.entities.has(geyser.id)).toBe(true);
    expect(geyser.refineryId).toBeNull();
    expect(w.occupancy[cellIndex(geyser.cellX!, geyser.cellY!)]).toBe(geyser.id);
    expect(w.occupancy[cellIndex(geyser.cellX! + 4, geyser.cellY! + 4)]).toBe(geyser.id);
  });

  it('plain building (barracks) death does not touch any mineral/geyser back-pointer', () => {
    const w = createWorld();
    const node = spawnMineralNode(w, 50, 50, 1500);
    const depot = spawnBuilding(w, 'supplyDepot', 'player', 50, 50);
    node.depotId = depot.id;
    depot.mineralNodeId = node.id;
    const brk = spawnBuilding(w, 'barracks', 'player', 70, 70);

    brk.hp = 0;

    runTick(makeGame(w));

    expect(w.entities.has(brk.id)).toBe(false);
    // Adjacent depot/node still claimed.
    expect(node.depotId).toBe(depot.id);
  });
});
