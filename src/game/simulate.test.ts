import { describe, expect, it } from 'vitest';

import { spawnUnit } from './entities';
import { runTick } from './simulate';
import { cellToPx, createWorld } from './world';
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
