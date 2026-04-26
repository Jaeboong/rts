import { describe, expect, it } from 'vitest';

import { spawnBuilding, spawnMineralNode, spawnUnit } from '../entities';
import { runTick } from '../simulate';
import { cellToPx, createWorld, type World } from '../world';

import { runPlayers } from './runner';
import { ScriptedAI } from './scripted-ai';

function seedTwoBaseWorld(): World {
  const w = createWorld();
  w.resources.player = 250;
  w.resources.enemy = 250;
  // Player base at TL.
  spawnBuilding(w, 'commandCenter', 'player', 8, 8);
  spawnMineralNode(w, 26, 8, 1500);
  spawnUnit(w, 'worker', 'player', cellToPx(24, 10));
  spawnUnit(w, 'worker', 'player', cellToPx(25, 10));
  // Enemy base at BR (reasonable separation on the default 128×128 grid).
  spawnBuilding(w, 'commandCenter', 'enemy', 100, 100);
  spawnMineralNode(w, 90, 100, 1500);
  spawnUnit(w, 'worker', 'enemy', cellToPx(96, 102));
  spawnUnit(w, 'worker', 'enemy', cellToPx(97, 102));
  return w;
}

describe('AI vs AI Tier 3 integration', () => {
  it('runs ~3000 ticks (~150s) without crash and both teams build infrastructure', () => {
    const w = seedTwoBaseWorld();
    const playerAI = new ScriptedAI('player', w, { tier: 3 });
    const enemyAI = new ScriptedAI('enemy', w, { tier: 3 });

    const fakeGame = { world: w } as unknown as Parameters<typeof runTick>[0];
    const TICKS = 3000; // 150s
    for (let t = 0; t < TICKS; t++) {
      runPlayers(w, [playerAI, enemyAI], 1 / 20);
      runTick(fakeGame);
      w.tickCount++;
    }

    // Both teams should have at least one supplyDepot OR barracks built or
    // in-progress (proves the build order is firing for both).
    function ownsAny(team: 'player' | 'enemy', kinds: string[]): boolean {
      for (const e of w.entities.values()) {
        if (e.team !== team) continue;
        if (kinds.includes(e.kind)) return true;
      }
      return false;
    }
    expect(ownsAny('player', ['supplyDepot', 'barracks'])).toBe(true);
    expect(ownsAny('enemy', ['supplyDepot', 'barracks'])).toBe(true);
  });

  it('60s budget: enemy completes a barracks within 1200 ticks', () => {
    const w = seedTwoBaseWorld();
    const enemyAI = new ScriptedAI('enemy', w, { tier: 3 });

    const fakeGame = { world: w } as unknown as Parameters<typeof runTick>[0];
    const TICKS = 1200;
    let barracksCompletedAt = -1;
    for (let t = 0; t < TICKS && barracksCompletedAt < 0; t++) {
      runPlayers(w, [enemyAI], 1 / 20);
      runTick(fakeGame);
      w.tickCount++;
      for (const e of w.entities.values()) {
        if (e.team === 'enemy' && e.kind === 'barracks' && !e.underConstruction) {
          barracksCompletedAt = t;
          break;
        }
      }
    }
    expect(barracksCompletedAt).toBeGreaterThan(0);
    expect(barracksCompletedAt).toBeLessThan(1200);
  });

  it('120s budget: enemy dispatches a marine wave (attackMove command on >=4 marines) within 2400 ticks', () => {
    const w = seedTwoBaseWorld();
    const enemyAI = new ScriptedAI('enemy', w, { tier: 3 });

    const fakeGame = { world: w } as unknown as Parameters<typeof runTick>[0];
    const TICKS = 2400;
    let waveDispatchedAt = -1;
    for (let t = 0; t < TICKS && waveDispatchedAt < 0; t++) {
      runPlayers(w, [enemyAI], 1 / 20);
      runTick(fakeGame);
      w.tickCount++;
      // Count enemy marines that are currently attackMove-ing.
      let attackingMarines = 0;
      for (const e of w.entities.values()) {
        if (e.team !== 'enemy' || e.kind !== 'marine') continue;
        if (e.command && e.command.type === 'attackMove') attackingMarines++;
      }
      if (attackingMarines >= 4) {
        waveDispatchedAt = t;
        break;
      }
    }
    expect(waveDispatchedAt).toBeGreaterThan(0);
    expect(waveDispatchedAt).toBeLessThan(2400);
  });
});
