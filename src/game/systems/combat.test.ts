import { describe, expect, it } from 'vitest';
import { spawnUnit, UNIT_DEFS } from '../entities';
import { cellToPx, createWorld } from '../world';
import { combatSystem } from './combat';

const DT = 1 / 20;

describe('combat system', () => {
  it('marine in range damages and kills enemy', () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    const e = spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(11, 10));
    expect(e.hp).toBe(UNIT_DEFS.enemyDummy.hp);

    // Run 30 sec — marine DPS 6 → kills 100 HP in ~17s
    const ticks = Math.floor(30 / DT);
    for (let i = 0; i < ticks; i++) {
      combatSystem(w, DT);
      if (e.dead) break;
    }
    expect(e.dead).toBe(true);
    expect(e.hp).toBeLessThanOrEqual(0);
    expect(m.attackTargetId).toBeDefined();
  });

  it('attack respects cooldown', () => {
    const w = createWorld();
    spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    const e = spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(11, 10));
    const def = UNIT_DEFS.marine;
    // After exactly attackInterval seconds, expect 1 hit
    let hits = 0;
    let prev = e.hp;
    const ticks = Math.floor((def.attackInterval ?? 1) / DT);
    for (let i = 0; i < ticks; i++) {
      combatSystem(w, DT);
      if (e.hp < prev) {
        hits++;
        prev = e.hp;
      }
    }
    // First tick fires immediately (cooldown starts at 0)
    expect(hits).toBeGreaterThanOrEqual(1);
    expect(hits).toBeLessThanOrEqual(2);
  });

  it('out of range: no damage', () => {
    const w = createWorld();
    spawnUnit(w, 'marine', 'player', cellToPx(0, 0));
    const e = spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(60, 60));
    const before = e.hp;
    for (let i = 0; i < 100; i++) combatSystem(w, DT);
    expect(e.hp).toBe(before);
  });
});
