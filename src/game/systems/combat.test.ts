import { beforeEach, describe, expect, it } from 'vitest';
import { CELL } from '../../types';
import { UNIT_DEFS } from '../balance';
import { spawnBuilding, spawnUnit } from '../entities';
import { cellToPx, createWorld } from '../world';
import { combatSystem } from './combat';
import { movementSystem, resetRepathTimers } from './movement';

const DT = 1 / 20;

// repathTimer is module-level shared state; isolate tests so prior chase requests
// don't suppress fresh shouldRepath() calls in the next scenario.
beforeEach(() => {
  resetRepathTimers();
});

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

describe('combat sight range + auto-approach', () => {
  it('marine sights enemy outside attackRange but inside sightRange and chases', () => {
    const w = createWorld();
    // Marine sightRange = 15*CELL, attackRange = 10*CELL → 12 cells is sighted-only
    const m = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    const e = spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(22, 10));
    expect(m.path).toBeNull();

    combatSystem(w, DT);

    expect(m.attackTargetId).toBe(e.id);
    expect(m.command).toBeNull();
    expect(m.path).toBeTruthy();
    expect((m.path ?? []).length).toBeGreaterThan(0);
  });

  it('marine ignores enemy outside sightRange', () => {
    const w = createWorld();
    // sightRange = 15*CELL → 30 cells away is well outside
    const m = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(40, 10));

    combatSystem(w, DT);

    expect(m.attackTargetId).toBeNull();
    expect(m.path).toBeNull();
  });

  it('marine fires after walking into attackRange', () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    const e = spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(22, 10));
    const startHp = e.hp;
    // Initial sight tick: builds path, no damage yet
    combatSystem(w, DT);
    expect(e.hp).toBe(startHp);
    // Teleport marine into attackRange (simulate walking)
    m.pos = { ...cellToPx(15, 10) };
    m.path = null;
    combatSystem(w, DT);
    expect(e.hp).toBeLessThan(startHp);
  });

  it('worker has no auto-attack capability', () => {
    const w = createWorld();
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(10, 10));
    spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(11, 10));

    combatSystem(w, DT);

    // Worker has no attackRange so combatSystem skips it entirely; attackTargetId
    // stays at the spawn-initialized null and no path is requested.
    expect(worker.attackTargetId).toBeNull();
    expect(worker.sightRange).toBeUndefined();
    expect(worker.path).toBeNull();
    expect(worker.command).toBeNull();
  });

  it('enemyDummy does not auto-attack player units', () => {
    const w = createWorld();
    const dummy = spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(10, 10));
    spawnUnit(w, 'marine', 'player', cellToPx(11, 10));

    combatSystem(w, DT);

    expect(dummy.attackTargetId).toBeNull();
    expect(dummy.sightRange).toBeUndefined();
    expect(dummy.path).toBeNull();
  });

  it('idle marine stops chasing if target leaves sightRange', () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    const e = spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(22, 10));
    combatSystem(w, DT);
    expect(m.attackTargetId).toBe(e.id);
    // Move enemy far outside sightRange
    e.pos = { ...cellToPx(60, 10) };
    combatSystem(w, DT);
    expect(m.attackTargetId).toBeNull();
    // No persistent command — stays idle once target gone
    expect(m.command).toBeNull();
  });
});

describe('combat pursuit drift repath', () => {
  it('repaths when target drifts > 1 cell on explicit attack command', () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    const e = spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(25, 10));
    m.command = { type: 'attack', targetId: e.id };

    // First tick: build initial path
    combatSystem(w, DT);
    const firstAim = m.pathTargetCell;
    expect(firstAim).toBeTruthy();
    if (!firstAim) throw new Error('expected pathTargetCell after first tick');

    // Drain shouldRepath throttle so a second request can fire
    for (let i = 0; i < 12; i++) movementSystem(w, DT);

    // Drift target several cells
    e.pos = { ...cellToPx(35, 10) };
    combatSystem(w, DT);

    expect(m.pathTargetCell).toBeTruthy();
    const secondAim = m.pathTargetCell;
    if (!secondAim) throw new Error('expected pathTargetCell after drift');
    // Aim shifted to follow the moved target
    expect(secondAim.x).not.toBe(firstAim.x);
    expect(m.attackTargetId).toBe(e.id);
  });

  it('stationary target: no repath churn', () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    const e = spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(25, 10));
    m.command = { type: 'attack', targetId: e.id };

    combatSystem(w, DT);
    const firstAim = m.pathTargetCell;
    expect(firstAim).toBeTruthy();
    if (!firstAim) throw new Error('expected pathTargetCell');
    const firstAimX = firstAim.x;
    const firstAimY = firstAim.y;

    // Tick movement (drains throttle) and combat several times
    for (let i = 0; i < 30; i++) {
      movementSystem(w, DT);
      combatSystem(w, DT);
    }

    // pathTargetCell either retained or path consumed — never re-aimed elsewhere
    if (m.pathTargetCell) {
      expect(m.pathTargetCell.x).toBe(firstAimX);
      expect(m.pathTargetCell.y).toBe(firstAimY);
    }
  });

  it('drift exactly 1 cell: no repath (threshold is strict > CELL)', () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    const e = spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(25, 10));
    m.command = { type: 'attack', targetId: e.id };

    combatSystem(w, DT);
    const firstAim = m.pathTargetCell;
    expect(firstAim).toBeTruthy();
    if (!firstAim) throw new Error('expected pathTargetCell');

    for (let i = 0; i < 12; i++) movementSystem(w, DT);

    // Shift target by exactly 1 cell — squared dist = CELL² which is NOT > CELL²
    e.pos = { x: e.pos.x + CELL, y: e.pos.y };
    combatSystem(w, DT);

    expect(m.pathTargetCell?.x).toBe(firstAim.x);
    expect(m.pathTargetCell?.y).toBe(firstAim.y);
  });

  it('attackMove: sighted enemy still triggers fire when in attackRange', () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    const e = spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(11, 10));
    m.command = { type: 'attackMove', target: cellToPx(50, 10) };
    const startHp = e.hp;

    combatSystem(w, DT);

    expect(e.hp).toBeLessThan(startHp);
    expect(m.path).toBeNull();
  });
});

describe('combat facing + attack effect', () => {
  it('marine firing east faces ≈ 0', () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(11, 10));
    combatSystem(w, DT);
    expect(m.facing).toBeCloseTo(0, 5);
  });

  it('marine firing north faces ≈ -π/2 (canvas y-down)', () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(10, 9));
    combatSystem(w, DT);
    expect(m.facing).toBeCloseTo(-Math.PI / 2, 5);
  });

  it('firing sets attackEffectMs > 0; subsequent ticks decay it', () => {
    const w = createWorld();
    spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(11, 10));
    const m = Array.from(w.entities.values()).find((x) => x.kind === 'marine');
    if (!m) throw new Error('marine missing');
    combatSystem(w, DT);
    expect(m.attackEffectMs).toBeGreaterThan(0);
    const before = m.attackEffectMs ?? 0;
    // No new fire in this tick (cooldown active); effect timer should decay.
    combatSystem(w, DT);
    expect(m.attackEffectMs ?? 0).toBeLessThan(before);
  });

  it('turret with no target keeps attackEffectMs at 0', () => {
    const w = createWorld();
    spawnBuilding(w, 'turret', 'player', 10, 10);
    combatSystem(w, DT);
    const t = Array.from(w.entities.values()).find((x) => x.kind === 'turret');
    expect(t?.attackEffectMs ?? 0).toBe(0);
  });
});
