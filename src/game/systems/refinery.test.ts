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
    const before = w.gas;
    // 1s = 20 ticks @ 20Hz, 5 gas/sec → +5 gas
    for (let i = 0; i < 20; i++) runRefinerySystem(w, DT);
    expect(w.gas).toBe(before + 5);
  });

  it('multiple completed refineries accumulate (2 → +10/sec)', () => {
    const w = createWorld();
    spawnBuilding(w, 'refinery', 'player', 30, 30);
    spawnBuilding(w, 'refinery', 'player', 40, 40);
    const before = w.gas;
    for (let i = 0; i < 20; i++) runRefinerySystem(w, DT);
    expect(w.gas).toBe(before + 10);
  });

  it('under-construction refinery does NOT produce', () => {
    const w = createWorld();
    spawnBuilding(w, 'refinery', 'player', 30, 30, false);
    const before = w.gas;
    for (let i = 0; i < 60; i++) runRefinerySystem(w, DT);
    expect(w.gas).toBe(before);
  });

  it('refinery on enemy team does NOT produce gas (player-only resource)', () => {
    const w = createWorld();
    spawnBuilding(w, 'refinery', 'enemy', 30, 30);
    const before = w.gas;
    for (let i = 0; i < 40; i++) runRefinerySystem(w, DT);
    expect(w.gas).toBe(before);
  });

  it('after 2 seconds → +10 gas (rate is sustained)', () => {
    const w = createWorld();
    spawnBuilding(w, 'refinery', 'player', 30, 30);
    const before = w.gas;
    for (let i = 0; i < 40; i++) runRefinerySystem(w, DT);
    expect(w.gas).toBe(before + 10);
  });
});
