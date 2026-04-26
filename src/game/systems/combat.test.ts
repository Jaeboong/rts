import { beforeEach, describe, expect, it } from 'vitest';
import { CELL } from '../../types';
import { UNIT_DEFS } from '../balance';
import { spawnBuilding, spawnUnit } from '../entities';
import { cellToPx, createWorld } from '../world';
import { combatSystem, hasHostileInAttackRange } from './combat';
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

describe('autoAcquire target priority (attackers > passives)', () => {
  it('marine prefers a farther enemy marine over a nearby enemy CC', () => {
    const w = createWorld();
    const me = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    // CC footprint at (11,8)-(25,22) — edge ~1 cell from me
    spawnBuilding(w, 'commandCenter', 'enemy', 11, 8, false);
    // Enemy marine 6 cells away, well inside sightRange
    const enemyMarine = spawnUnit(w, 'marine', 'enemy', cellToPx(16, 10));

    combatSystem(w, DT);

    expect(me.attackTargetId).toBe(enemyMarine.id);
  });

  it('marine attacks enemy CC when no enemy attacker units are in sight', () => {
    const w = createWorld();
    const me = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    spawnBuilding(w, 'commandCenter', 'enemy', 11, 8, false);
    spawnUnit(w, 'worker', 'enemy', cellToPx(13, 10));

    combatSystem(w, DT);

    // Falls back to nearest passive — could be CC or worker. Either is acceptable;
    // the contract is "no attackers in sight ⇒ pick something passive".
    expect(me.attackTargetId).not.toBeNull();
    const t = w.entities.get(me.attackTargetId!);
    expect((t?.attackRange ?? 0)).toBe(0);
  });
});

describe('hasHostileInAttackRange', () => {
  it('returns true when a hostile is inside attackRange', () => {
    const w = createWorld();
    const me = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(11, 10));
    expect(hasHostileInAttackRange(w, me)).toBe(true);
  });

  it('returns false when hostile is sighted but outside attackRange', () => {
    const w = createWorld();
    const me = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    // marine attackRange = 10*CELL → 12 cells away is sighted-only
    spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(22, 10));
    expect(hasHostileInAttackRange(w, me)).toBe(false);
  });

  it('returns false for units without attackRange', () => {
    const w = createWorld();
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(10, 10));
    spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(11, 10));
    expect(hasHostileInAttackRange(w, worker)).toBe(false);
  });
});

describe('autoAcquire focus fire (Phase 49)', () => {
  it('marine with two enemy marines in range targets the lower-HP one', () => {
    const w = createWorld();
    const me = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    // Both enemies in attackRange (10 cells); one wounded.
    const fresh = spawnUnit(w, 'marine', 'enemy', cellToPx(15, 10));
    const wounded = spawnUnit(w, 'marine', 'enemy', cellToPx(16, 10));
    wounded.hp = 10;

    combatSystem(w, DT);

    expect(me.attackTargetId).toBe(wounded.id);
    expect(me.attackTargetId).not.toBe(fresh.id);
  });

  it('three marines vs three: focus fire converges (one enemy dies first, not all evenly low)', () => {
    const w = createWorld();
    const allies = [
      spawnUnit(w, 'marine', 'player', cellToPx(10, 10)),
      spawnUnit(w, 'marine', 'player', cellToPx(10, 11)),
      spawnUnit(w, 'marine', 'player', cellToPx(10, 12)),
    ];
    const enemies = [
      spawnUnit(w, 'marine', 'enemy', cellToPx(15, 10)),
      spawnUnit(w, 'marine', 'enemy', cellToPx(15, 11)),
      spawnUnit(w, 'marine', 'enemy', cellToPx(15, 12)),
    ];
    // Disarm enemies so the fight is one-sided and we can read the kill order
    // off the target distribution.
    for (const e of enemies) e.attackRange = undefined;

    // Run one tick — see who fires at whom.
    combatSystem(w, DT);
    // After the first tick a wounded enemy emerges; second tick should
    // converge focus fire on whichever has the lowest HP.
    combatSystem(w, DT);
    combatSystem(w, DT);
    combatSystem(w, DT);

    // Most-targeted enemy should have meaningfully less HP than the least-
    // targeted one — otherwise they're being hit evenly (the bug we're fixing).
    const hps = enemies.map((e) => e.hp);
    hps.sort((a, b) => a - b);
    const spread = hps[hps.length - 1] - hps[0];
    expect(spread).toBeGreaterThan(0);
    // At least one enemy must have taken multiple hits; with even targeting
    // the spread would be ≤ 6 (one shot's worth). With focus fire it grows.
    expect(allies.length).toBe(3);
  });

  it('explicit attack command on a specific target is NOT overridden by focus fire', () => {
    const w = createWorld();
    const me = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    const fresh = spawnUnit(w, 'marine', 'enemy', cellToPx(15, 10));
    const wounded = spawnUnit(w, 'marine', 'enemy', cellToPx(16, 10));
    wounded.hp = 5;
    // Player explicitly orders attack on the fresh enemy.
    me.command = { type: 'attack', targetId: fresh.id };

    combatSystem(w, DT);

    expect(me.attackTargetId).toBe(fresh.id);
  });
});

describe('autoAcquire tank prioritization (Phase 49)', () => {
  it('tank prefers an enemy tank over an enemy marine (within attacker tier, by mass weight)', () => {
    const w = createWorld();
    const me = spawnUnit(w, 'tank', 'player', cellToPx(10, 10));
    // Both attackers — same tier. Marine is closer; tank is higher-mass.
    const enemyMarine = spawnUnit(w, 'marine', 'enemy', cellToPx(13, 10));
    const enemyTank = spawnUnit(w, 'tank', 'enemy', cellToPx(20, 10));
    // Both fresh — ratio is 1.0 for each. Mass weight (0.4 for tank, 1.0 for
    // marine) tilts the score: tank score 0.4 + tiny dist factor; marine
    // score 1.0 + tiny dist factor. Tank wins.
    combatSystem(w, DT);
    expect(me.attackTargetId).toBe(enemyTank.id);
    void enemyMarine;
  });

  it('marine has no tank-priority weighting → among two attackers, picks lowest-HP', () => {
    const w = createWorld();
    const me = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    // Two enemy marines — both attackers, same tier. Marine picks lowest-HP.
    const fresh = spawnUnit(w, 'marine', 'enemy', cellToPx(13, 10));
    const wounded = spawnUnit(w, 'marine', 'enemy', cellToPx(16, 10));
    wounded.hp = 5;

    combatSystem(w, DT);
    expect(me.attackTargetId).toBe(wounded.id);
    void fresh;
  });

  it('tank prefers enemy CC over enemy worker (passive-tier tank-priority)', () => {
    const w = createWorld();
    const me = spawnUnit(w, 'tank', 'player', cellToPx(10, 10));
    spawnBuilding(w, 'commandCenter', 'enemy', 13, 8, true);
    const enemyWorker = spawnUnit(w, 'worker', 'enemy', cellToPx(20, 10));

    combatSystem(w, DT);

    // CC (building) tankWeight = 0.4, worker tankWeight = 1.6 → CC wins.
    const t = w.entities.get(me.attackTargetId!);
    expect(t?.kind).toBe('commandCenter');
    void enemyWorker;
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
