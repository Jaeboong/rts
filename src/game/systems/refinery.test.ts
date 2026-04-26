import { describe, expect, it } from 'vitest';
import { spawnBuilding } from '../entities';
import { createWorld } from '../world';
import { runRefinerySystem } from './refinery';

const DT = 1 / 20;

describe('refinery system', () => {
  it('completed refinery produces 5 gas/sec', () => {
    const w = createWorld();
    const r = spawnBuilding(w, 'refinery', 'player', 30, 30);
    expect(r.underConstruction).toBe(false);
    const before = w.gas.player;
    // 1s = 20 ticks @ 20Hz, 5 gas/sec → +5 gas
    for (let i = 0; i < 20; i++) runRefinerySystem(w, DT);
    expect(w.gas.player).toBe(before + 5);
  });

  it('multiple completed refineries accumulate (2 → +10/sec)', () => {
    const w = createWorld();
    spawnBuilding(w, 'refinery', 'player', 30, 30);
    spawnBuilding(w, 'refinery', 'player', 40, 40);
    const before = w.gas.player;
    for (let i = 0; i < 20; i++) runRefinerySystem(w, DT);
    expect(w.gas.player).toBe(before + 10);
  });

  it('under-construction refinery does NOT produce', () => {
    const w = createWorld();
    spawnBuilding(w, 'refinery', 'player', 30, 30, false);
    const before = w.gas.player;
    for (let i = 0; i < 60; i++) runRefinerySystem(w, DT);
    expect(w.gas.player).toBe(before);
  });

  // Phase 43: enemy refineries now produce gas on the enemy pool — the gas
  // waiver was removed, so the AI must stand up a refinery to access tier-2.
  it('refinery on enemy team accumulates gas on the enemy pool', () => {
    const w = createWorld();
    spawnBuilding(w, 'refinery', 'enemy', 30, 30);
    const beforeEnemy = w.gas.enemy;
    const beforePlayer = w.gas.player;
    for (let i = 0; i < 40; i++) runRefinerySystem(w, DT);
    // 2 seconds at 5 gas/sec → +10 enemy gas, player pool untouched.
    expect(w.gas.enemy).toBe(beforeEnemy + 10);
    expect(w.gas.player).toBe(beforePlayer);
  });

  it('after 2 seconds → +10 gas (rate is sustained)', () => {
    const w = createWorld();
    spawnBuilding(w, 'refinery', 'player', 30, 30);
    const before = w.gas.player;
    for (let i = 0; i < 40; i++) runRefinerySystem(w, DT);
    expect(w.gas.player).toBe(before + 10);
  });
});
