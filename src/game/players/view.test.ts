import { describe, expect, it } from 'vitest';
import { CELL, GRID_H, GRID_W } from '../../types';
import { spawnBuilding, spawnGasGeyser, spawnMineralNode, spawnUnit } from '../entities';
import { cellToPx, createWorld } from '../world';
import { buildView } from './view';

describe('buildView', () => {
  it('returns empty arrays + zero tick on a fresh world', () => {
    const w = createWorld();
    const view = buildView(w, 'player');
    expect(view.tick).toBe(0);
    expect(view.myEntities).toEqual([]);
    expect(view.visibleEnemies).toEqual([]);
    expect(view.visibleResources).toEqual([]);
    expect(view.resources.minerals).toBe(500);
    expect(view.resources.gas).toBe(200);
    expect(view.mapInfo).toEqual({ w: GRID_W, h: GRID_H, cellPx: CELL });
  });

  it('partitions entities by team relative to the requesting player', () => {
    const w = createWorld();
    const playerWorker = spawnUnit(w, 'worker', 'player', cellToPx(5, 5));
    const enemyDummy = spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(40, 40));
    const node = spawnMineralNode(w, 10, 10, 1500);

    const view = buildView(w, 'player');
    expect(view.myEntities.map((e) => e.id)).toEqual([playerWorker.id]);
    expect(view.visibleEnemies.map((e) => e.id)).toEqual([enemyDummy.id]);
    expect(view.visibleResources.map((e) => e.id)).toEqual([node.id]);
  });

  it('reverses partition for enemy team', () => {
    const w = createWorld();
    const playerWorker = spawnUnit(w, 'worker', 'player', cellToPx(5, 5));
    const enemyDummy = spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(40, 40));

    const view = buildView(w, 'enemy');
    expect(view.myEntities.map((e) => e.id)).toEqual([enemyDummy.id]);
    expect(view.visibleEnemies.map((e) => e.id)).toEqual([playerWorker.id]);
  });

  it('classifies gas geysers as resources, not enemies', () => {
    const w = createWorld();
    const geyser = spawnGasGeyser(w, 50, 50);
    const view = buildView(w, 'player');
    expect(view.visibleResources.map((e) => e.id)).toEqual([geyser.id]);
    expect(view.visibleEnemies).toEqual([]);
  });

  it('skips dead entities', () => {
    const w = createWorld();
    const u = spawnUnit(w, 'worker', 'player', cellToPx(5, 5));
    u.dead = true;
    const view = buildView(w, 'player');
    expect(view.myEntities).toEqual([]);
  });

  it('includes underConstruction flag and cell coords for buildings', () => {
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 10, 10, false);
    const view = buildView(w, 'player');
    expect(view.myEntities).toHaveLength(1);
    expect(view.myEntities[0].underConstruction).toBe(true);
    expect(view.myEntities[0].cellX).toBe(10);
    expect(view.myEntities[0].cellY).toBe(10);
  });

  it('snapshot: stable shape across deterministic world setup', () => {
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const node = spawnMineralNode(w, 30, 12, 1500);
    spawnUnit(w, 'worker', 'player', cellToPx(34, 12));
    spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(60, 60));

    const view = buildView(w, 'player');
    expect({
      tick: view.tick,
      mapInfo: view.mapInfo,
      myKinds: view.myEntities.map((e) => e.kind).sort(),
      enemyKinds: view.visibleEnemies.map((e) => e.kind).sort(),
      resourceKinds: view.visibleResources.map((e) => e.kind).sort(),
      mineralIdMatches: view.visibleResources.some((e) => e.id === node.id),
      resources: view.resources,
    }).toMatchInlineSnapshot(`
      {
        "enemyKinds": [
          "enemyDummy",
        ],
        "mapInfo": {
          "cellPx": 16,
          "h": 128,
          "w": 128,
        },
        "mineralIdMatches": true,
        "myKinds": [
          "commandCenter",
          "worker",
        ],
        "resourceKinds": [
          "mineralNode",
        ],
        "resources": {
          "gas": 200,
          "minerals": 500,
        },
        "tick": 0,
      }
    `);
  });

  it('does not leak internal sim state (path, attackCooldown) into ViewEntity', () => {
    const w = createWorld();
    const u = spawnUnit(w, 'marine', 'player', cellToPx(5, 5));
    u.path = [{ x: 100, y: 100 }];
    u.attackCooldown = 0.5;
    const view = buildView(w, 'player');
    const ve = view.myEntities[0];
    expect(ve).not.toHaveProperty('path');
    expect(ve).not.toHaveProperty('attackCooldown');
    expect(ve).not.toHaveProperty('repathTimer');
  });
});
