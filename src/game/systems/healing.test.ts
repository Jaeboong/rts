import { beforeEach, describe, expect, it } from 'vitest';
import { UNIT_DEFS } from '../balance';
import { spawnUnit } from '../entities';
import { cellToPx, createWorld } from '../world';
import { combatSystem } from './combat';
import { runHealingSystem } from './healing';
import { resetRepathTimers } from './movement';

const DT = 1 / 20;

beforeEach(() => {
  resetRepathTimers();
});

describe('medic spawn fields', () => {
  it('spawnUnit medic initializes heal AI fields', () => {
    const w = createWorld();
    const m = spawnUnit(w, 'medic', 'player', cellToPx(10, 10));
    expect(m.kind).toBe('medic');
    expect(m.healSubState).toBe('idle');
    expect(m.healTargetId).toBeNull();
    expect(m.healTimer).toBe(0);
    expect(m.healRate).toBe(UNIT_DEFS.medic.healRate);
    expect(m.healRange).toBe(UNIT_DEFS.medic.healRange);
    expect(m.sightRange).toBe(UNIT_DEFS.medic.sightRange);
    expect(m.attackRange).toBeUndefined();
    expect(m.attackDamage).toBeUndefined();
    expect(m.facing).toBe(0);
  });
});

describe('healing system: idle', () => {
  it('no marines in world → medic stays idle', () => {
    const w = createWorld();
    const med = spawnUnit(w, 'medic', 'player', cellToPx(10, 10));
    runHealingSystem(w, DT);
    expect(med.healSubState).toBe('idle');
    expect(med.healTargetId).toBeNull();
    expect(med.path).toBeNull();
  });
});

describe('healing system: following', () => {
  it('healthy marine in world → medic follows it (state=following)', () => {
    const w = createWorld();
    const med = spawnUnit(w, 'medic', 'player', cellToPx(10, 10));
    spawnUnit(w, 'marine', 'player', cellToPx(20, 10));
    runHealingSystem(w, DT);
    expect(med.healSubState).toBe('following');
    expect(med.healTargetId).toBeNull();
    expect(med.path).not.toBeNull();
    expect((med.path ?? []).length).toBeGreaterThan(0);
  });

  it('marine inside leashMin → medic does not request a path', () => {
    const w = createWorld();
    // Marine 1 cell from medic (CELL pixels) — inside leashMin (=2*CELL).
    const med = spawnUnit(w, 'medic', 'player', cellToPx(10, 10));
    spawnUnit(w, 'marine', 'player', cellToPx(11, 10));
    runHealingSystem(w, DT);
    expect(med.healSubState).toBe('following');
    expect(med.path).toBeNull();
  });
});

describe('healing system: heal trigger', () => {
  it('wounded marine in sightRange → medic switches to healing', () => {
    const w = createWorld();
    const med = spawnUnit(w, 'medic', 'player', cellToPx(10, 10));
    const mar = spawnUnit(w, 'marine', 'player', cellToPx(13, 10));
    mar.hp -= 20;
    runHealingSystem(w, DT);
    expect(med.healSubState).toBe('healing');
    expect(med.healTargetId).toBe(mar.id);
  });

  it('wounded marine outside sightRange → medic does not heal', () => {
    const w = createWorld();
    // Medic sightRange = 15*CELL → 30 cells away is well outside.
    const med = spawnUnit(w, 'medic', 'player', cellToPx(10, 10));
    const mar = spawnUnit(w, 'marine', 'player', cellToPx(40, 10));
    mar.hp -= 20;
    runHealingSystem(w, DT);
    expect(med.healSubState).not.toBe('healing');
    expect(med.healTargetId).toBeNull();
  });
});

describe('healing system: heal tick (in healRange)', () => {
  it('after 1 second of dt, marine.hp += healRate', () => {
    const w = createWorld();
    // Medic healRange = 1.5 * CELL → ~24px. Place marine at 1 cell distance (=16px).
    const med = spawnUnit(w, 'medic', 'player', cellToPx(10, 10));
    const mar = spawnUnit(w, 'marine', 'player', cellToPx(11, 10));
    mar.hp = 30;
    const before = mar.hp;

    // Advance 1 full second of healing (20 ticks × DT = 1s).
    for (let i = 0; i < 20; i++) runHealingSystem(w, DT);

    expect(med.healSubState).toBe('healing');
    expect(mar.hp).toBe(before + (UNIT_DEFS.medic.healRate ?? 0));
  });

  it('marine.hp clamped to hpMax when ticking heals it past full', () => {
    const w = createWorld();
    spawnUnit(w, 'medic', 'player', cellToPx(10, 10));
    const mar = spawnUnit(w, 'marine', 'player', cellToPx(11, 10));
    mar.hp = mar.hpMax - 1;

    // 1 second tick adds 2 → would overshoot by 1 without clamp.
    for (let i = 0; i < 20; i++) runHealingSystem(w, DT);

    expect(mar.hp).toBe(mar.hpMax);
  });

  it('continuous heal until full → medic returns to following', () => {
    const w = createWorld();
    const med = spawnUnit(w, 'medic', 'player', cellToPx(10, 10));
    const mar = spawnUnit(w, 'marine', 'player', cellToPx(11, 10));
    mar.hp = 50;

    // Heal back from 50 → 60 takes 10 hp / 2 hp-per-sec = 5 sec. Run a bit longer.
    for (let i = 0; i < 20 * 7; i++) runHealingSystem(w, DT);

    expect(mar.hp).toBe(mar.hpMax);
    expect(med.healSubState).toBe('following');
    expect(med.healTargetId).toBeNull();
  });
});

describe('healing system: target loss', () => {
  it('target dies mid-heal → medic returns to following', () => {
    const w = createWorld();
    const med = spawnUnit(w, 'medic', 'player', cellToPx(10, 10));
    const mar = spawnUnit(w, 'marine', 'player', cellToPx(11, 10));
    mar.hp = 30;
    // First tick: latch onto wounded marine.
    runHealingSystem(w, DT);
    expect(med.healSubState).toBe('healing');

    // Second marine needed so "follow" remains available after death.
    spawnUnit(w, 'marine', 'player', cellToPx(20, 10));
    mar.dead = true;
    mar.hp = 0;

    runHealingSystem(w, DT);
    expect(med.healSubState).toBe('following');
    expect(med.healTargetId).toBeNull();
  });

  it('target leaves sightRange → medic returns to following', () => {
    const w = createWorld();
    const med = spawnUnit(w, 'medic', 'player', cellToPx(10, 10));
    const mar = spawnUnit(w, 'marine', 'player', cellToPx(11, 10));
    mar.hp = 30;
    runHealingSystem(w, DT);
    expect(med.healSubState).toBe('healing');

    // Move marine far outside sightRange (15*CELL = ~240px). 60 cells = ~960px.
    mar.pos = { ...cellToPx(70, 10) };
    runHealingSystem(w, DT);
    // Marine still healthy except hp=30 — but out of sightRange → medic drops target.
    expect(med.healSubState).not.toBe('healing');
  });
});

describe('healing system: target priority', () => {
  it('multiple wounded marines → medic targets the closest', () => {
    const w = createWorld();
    const med = spawnUnit(w, 'medic', 'player', cellToPx(10, 10));
    const near = spawnUnit(w, 'marine', 'player', cellToPx(13, 10));
    const far = spawnUnit(w, 'marine', 'player', cellToPx(20, 10));
    near.hp = 40;
    far.hp = 30;
    runHealingSystem(w, DT);
    expect(med.healSubState).toBe('healing');
    expect(med.healTargetId).toBe(near.id);
  });

  it('healthy marines + wounded ally → medic heals wounded, not random healthy', () => {
    const w = createWorld();
    const med = spawnUnit(w, 'medic', 'player', cellToPx(10, 10));
    const healthy = spawnUnit(w, 'marine', 'player', cellToPx(11, 10));
    const wounded = spawnUnit(w, 'marine', 'player', cellToPx(14, 10));
    wounded.hp = 30;
    runHealingSystem(w, DT);
    expect(med.healSubState).toBe('healing');
    expect(med.healTargetId).toBe(wounded.id);
    expect(med.healTargetId).not.toBe(healthy.id);
  });
});

describe('healing system: combat exclusion', () => {
  it('combatSystem ignores medic (no attackRange) — medic stays unscathed pacifist', () => {
    const w = createWorld();
    const med = spawnUnit(w, 'medic', 'player', cellToPx(10, 10));
    spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(11, 10));
    combatSystem(w, DT);
    expect(med.attackTargetId).toBeNull();
    expect(med.attackRange).toBeUndefined();
    expect(med.path).toBeNull();
  });
});

describe('healing system: enemy team isolation', () => {
  it('medic only follows / heals same-team marines', () => {
    const w = createWorld();
    const med = spawnUnit(w, 'medic', 'player', cellToPx(10, 10));
    // Enemy marine wounded right next to medic — medic should NOT heal it.
    const enemyMar = spawnUnit(w, 'marine', 'enemy', cellToPx(11, 10));
    enemyMar.hp = 20;
    runHealingSystem(w, DT);
    expect(med.healSubState).toBe('idle');
    expect(med.healTargetId).toBeNull();
  });
});

describe('healing system: path clearing on heal arrival', () => {
  it('medic in healRange clears path so it stops moving', () => {
    const w = createWorld();
    const med = spawnUnit(w, 'medic', 'player', cellToPx(10, 10));
    const mar = spawnUnit(w, 'marine', 'player', cellToPx(11, 10));
    mar.hp = 30;
    // Pre-seed a fake path the medic was using.
    med.path = [{ x: 999, y: 999 }];
    runHealingSystem(w, DT);
    expect(med.path).toBeNull();
  });
});

describe('healing system: tracks distance to wounded outside healRange', () => {
  it('wounded marine in sight but outside healRange → medic requests path toward it', () => {
    const w = createWorld();
    const med = spawnUnit(w, 'medic', 'player', cellToPx(10, 10));
    const mar = spawnUnit(w, 'marine', 'player', cellToPx(15, 10));
    mar.hp = 30;
    runHealingSystem(w, DT);
    expect(med.healSubState).toBe('healing');
    expect(med.path).not.toBeNull();
    expect((med.path ?? []).length).toBeGreaterThan(0);
  });
});

describe('healing system: heal timer accumulation', () => {
  it('partial second elapsed: no heal yet, timer accumulates', () => {
    const w = createWorld();
    const med = spawnUnit(w, 'medic', 'player', cellToPx(10, 10));
    const mar = spawnUnit(w, 'marine', 'player', cellToPx(11, 10));
    mar.hp = 30;
    const before = mar.hp;

    // Run only 0.5s worth of ticks → no heal tick yet.
    for (let i = 0; i < 10; i++) runHealingSystem(w, DT);

    expect(mar.hp).toBe(before);
    expect((med.healTimer ?? 0)).toBeGreaterThan(0);
    expect((med.healTimer ?? 0)).toBeLessThan(1);
  });
});
