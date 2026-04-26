import { beforeEach, describe, expect, it } from 'vitest';
import { CELL } from '../../types';
import { spawnBuilding, spawnUnit } from '../entities';
import { cellToPx, createWorld } from '../world';
import { combatSystem } from './combat';
import { resetRepathTimers } from './movement';
import {
  HOLD_LINE_K_CELLS,
  MAX_CHASE_CELLS,
  RECOVERY_HP_PCT,
  RETREAT_HP_PCT,
  tacticalSystem,
} from './tactical';

const DT = 1 / 20;

beforeEach(() => {
  resetRepathTimers();
});

describe('tactical: retreat at low HP', () => {
  it('marine below RETREAT_HP_PCT and not actively firing → switches to retreating + move-to-CC command', () => {
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'player', 5, 5);
    const m = spawnUnit(w, 'marine', 'player', cellToPx(40, 40));
    // Set HP below threshold (60 * 0.3 = 18; use 15 to be safely under).
    m.hp = 15;
    expect(m.hp / m.hpMax).toBeLessThan(RETREAT_HP_PCT);

    tacticalSystem(w);

    expect(m.tacticalState?.phase).toBe('retreating');
    expect(m.command?.type).toBe('move');
    if (m.command?.type !== 'move') throw new Error('expected move command');
    expect(m.command.target.x).toBe(cc.pos.x);
    expect(m.command.target.y).toBe(cc.pos.y);
  });

  it('does not retreat if attackEffectMs > 0 (mid-shot)', () => {
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 5, 5);
    const m = spawnUnit(w, 'marine', 'player', cellToPx(40, 40));
    m.hp = 15;
    m.attackEffectMs = 100; // Just fired this tick.

    tacticalSystem(w);

    expect(m.tacticalState?.phase).toBeUndefined();
    expect(m.command).toBeNull();
  });

  it('does not retreat if no own-team CC exists', () => {
    const w = createWorld();
    // Note: NO CC spawned. Game-over scenario.
    const m = spawnUnit(w, 'marine', 'player', cellToPx(40, 40));
    m.hp = 15;

    tacticalSystem(w);

    expect(m.tacticalState?.phase).toBeUndefined();
    expect(m.command).toBeNull();
  });

  it('cancels existing attack command on retreat', () => {
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 5, 5);
    const m = spawnUnit(w, 'marine', 'player', cellToPx(40, 40));
    const enemy = spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(41, 40));
    m.command = { type: 'attack', targetId: enemy.id };
    m.hp = 15;

    tacticalSystem(w);

    expect(m.command?.type).toBe('move');
    expect(m.tacticalState?.phase).toBe('retreating');
  });

  it('healthy unit does not retreat', () => {
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 5, 5);
    const m = spawnUnit(w, 'marine', 'player', cellToPx(40, 40));
    // Default HP = 60 (full).
    tacticalSystem(w);
    expect(m.tacticalState?.phase).toBeUndefined();
    expect(m.command).toBeNull();
  });

  it('retreating unit recovers above RECOVERY_HP_PCT → state cleared, command cleared', () => {
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 5, 5);
    const m = spawnUnit(w, 'marine', 'player', cellToPx(40, 40));
    m.hp = 15;
    tacticalSystem(w);
    expect(m.tacticalState?.phase).toBe('retreating');

    // Healed back above 60%.
    m.hp = m.hpMax * (RECOVERY_HP_PCT + 0.05);
    tacticalSystem(w);

    expect(m.tacticalState).toBeUndefined();
    expect(m.command).toBeNull();
  });

  it('retreat + recovery does not oscillate (HP between thresholds keeps state)', () => {
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 5, 5);
    const m = spawnUnit(w, 'marine', 'player', cellToPx(40, 40));
    m.hp = 15;
    tacticalSystem(w);
    expect(m.tacticalState?.phase).toBe('retreating');

    // Raise HP into the hysteresis band — above retreat threshold but below recovery.
    m.hp = m.hpMax * 0.45;
    tacticalSystem(w);

    expect(m.tacticalState?.phase).toBe('retreating');
    expect(m.command?.type).toBe('move');
  });
});

describe('tactical: chase leash', () => {
  it('auto-engaging unit anchors engagementOrigin on first tick of chase', () => {
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 5, 5);
    const m = spawnUnit(w, 'marine', 'player', cellToPx(40, 40));
    const enemy = spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(41, 40));
    // Pretend combat already auto-acquired the enemy.
    m.attackTargetId = enemy.id;

    tacticalSystem(w);

    expect(m.tacticalState?.engagementOrigin).toBeTruthy();
    expect(m.tacticalState?.engagementOrigin?.x).toBe(m.pos.x);
    expect(m.tacticalState?.engagementOrigin?.y).toBe(m.pos.y);
  });

  it('chasing past MAX_CHASE_CELLS with target out of attackRange → returning state + move-to-origin', () => {
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 5, 5);
    const m = spawnUnit(w, 'marine', 'player', cellToPx(40, 40));
    const enemy = spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(60, 40));
    m.attackTargetId = enemy.id;

    // First tick: anchor origin.
    tacticalSystem(w);
    const origin = m.tacticalState?.engagementOrigin;
    if (!origin) throw new Error('expected origin');

    // Move marine well past leash. MAX_CHASE_CELLS=8 → 128px. Move it 200px.
    m.pos = { x: origin.x + 200, y: origin.y };
    // Enemy stays out of attackRange (10*CELL = 160px) — at (60*CELL=960, 40*CELL=640),
    // marine at (origin.x+200, origin.y). Original origin around cellToPx(40,40)=
    // (640+8, 640+8) = (648, 648). Marine now at (848, 648). Enemy at (960+8, 648).
    // dist = ~120px ≈ 7.5 cells, < attackRange 10 cells → in range. Need farther enemy.
    enemy.pos = { x: cellToPx(80, 40).x, y: cellToPx(80, 40).y };

    tacticalSystem(w);

    expect(m.tacticalState?.phase).toBe('returning');
    expect(m.command?.type).toBe('move');
    if (m.command?.type !== 'move') throw new Error('expected move');
    expect(m.command.target.x).toBe(origin.x);
    expect(m.command.target.y).toBe(origin.y);
  });

  it('returning unit clears state when within ORIGIN_REACH_PX of origin', () => {
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 5, 5);
    const m = spawnUnit(w, 'marine', 'player', cellToPx(40, 40));
    m.tacticalState = {
      phase: 'returning',
      engagementOrigin: { x: m.pos.x, y: m.pos.y },
    };
    m.command = { type: 'move', target: { x: m.pos.x, y: m.pos.y } };

    tacticalSystem(w);

    expect(m.tacticalState).toBeUndefined();
    expect(m.command).toBeNull();
  });

  it('explicit attack command bypasses chase leash (user intent wins)', () => {
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 5, 5);
    const m = spawnUnit(w, 'marine', 'player', cellToPx(40, 40));
    const enemy = spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(80, 40));
    m.attackTargetId = enemy.id;
    m.command = { type: 'attack', targetId: enemy.id };
    m.tacticalState = {
      engagementOrigin: { x: m.pos.x, y: m.pos.y },
    };
    // Move marine far past leash.
    m.pos = { x: m.pos.x + 500, y: m.pos.y };

    tacticalSystem(w);

    // Explicit attack is preserved — no 'returning' override.
    expect(m.tacticalState?.phase).not.toBe('returning');
    expect(m.command?.type).toBe('attack');
  });

  it('losing target clears engagementOrigin (next engagement re-anchors)', () => {
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 5, 5);
    const m = spawnUnit(w, 'marine', 'player', cellToPx(40, 40));
    m.tacticalState = {
      engagementOrigin: { x: 100, y: 100 },
    };
    m.attackTargetId = null;

    tacticalSystem(w);

    expect(m.tacticalState?.engagementOrigin).toBeUndefined();
  });

  it('chasing past leash but target IN attackRange → keeps fighting (no return)', () => {
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 5, 5);
    const m = spawnUnit(w, 'marine', 'player', cellToPx(40, 40));
    const enemy = spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(50, 40));
    m.attackTargetId = enemy.id;

    tacticalSystem(w);
    const origin = m.tacticalState?.engagementOrigin;
    if (!origin) throw new Error('expected origin');

    // Move both — marine past leash, but enemy stays adjacent (within attackRange).
    m.pos = { x: origin.x + 200, y: origin.y };
    enemy.pos = { x: m.pos.x + CELL, y: m.pos.y };

    tacticalSystem(w);

    expect(m.tacticalState?.phase).not.toBe('returning');
  });
});

describe('tactical: hold line during attackMove', () => {
  it('attackMove unit far from group centroid + chasing solo target → drops attackTargetId', () => {
    const w = createWorld();
    // Spawn 4 marines clumped together and 1 stragler chasing solo.
    for (let i = 0; i < 4; i++) {
      const m = spawnUnit(w, 'marine', 'player', cellToPx(20 + i, 20));
      m.command = { type: 'attackMove', target: cellToPx(50, 20) };
    }
    const straggler = spawnUnit(w, 'marine', 'player', cellToPx(45, 20));
    straggler.command = { type: 'attackMove', target: cellToPx(50, 20) };
    const enemy = spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(60, 20));
    straggler.attackTargetId = enemy.id;

    tacticalSystem(w);

    // Centroid is around cell 21 (4 marines @ 20,21,22,23 + straggler @ 45 ≈ avg 26).
    // Straggler at cell 45 is > 12 cells from centroid AND target enemy is out of attackRange.
    expect(straggler.attackTargetId).toBeNull();
  });

  it('attackMove unit within HOLD_LINE_K_CELLS of centroid keeps its target', () => {
    const w = createWorld();
    // All 5 marines clumped — none beyond leash.
    const marines = [];
    for (let i = 0; i < 5; i++) {
      const m = spawnUnit(w, 'marine', 'player', cellToPx(20 + i, 20));
      m.command = { type: 'attackMove', target: cellToPx(50, 20) };
      marines.push(m);
    }
    const enemy = spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(60, 20));
    marines[0].attackTargetId = enemy.id;

    tacticalSystem(w);

    expect(marines[0].attackTargetId).toBe(enemy.id);
  });

  it('hold line does not apply to a single attackMove unit (no group → no centroid)', () => {
    const w = createWorld();
    const solo = spawnUnit(w, 'marine', 'player', cellToPx(20, 20));
    solo.command = { type: 'attackMove', target: cellToPx(50, 20) };
    const enemy = spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(60, 20));
    solo.attackTargetId = enemy.id;
    // Move the solo marine far so any centroid (if computed) would be far away.
    solo.pos = cellToPx(80, 20);

    tacticalSystem(w);

    // No-op: single unit has no formation to hold.
    expect(solo.attackTargetId).toBe(enemy.id);
  });
});

describe('tactical: integration with combat', () => {
  it('retreat command lets combatSystem still fire at adjacent hostile (move command does not block fire)', () => {
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 5, 5);
    const m = spawnUnit(w, 'marine', 'player', cellToPx(40, 40));
    const enemy = spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(41, 40));
    m.hp = 15;
    const startHp = enemy.hp;

    tacticalSystem(w);
    expect(m.tacticalState?.phase).toBe('retreating');
    combatSystem(w, DT);

    // Move command leaves combat free to auto-acquire and fire.
    expect(enemy.hp).toBeLessThan(startHp);
  });

  it('constants are sane (sanity check)', () => {
    expect(RETREAT_HP_PCT).toBeGreaterThan(0);
    expect(RETREAT_HP_PCT).toBeLessThan(RECOVERY_HP_PCT);
    expect(RECOVERY_HP_PCT).toBeLessThan(1);
    expect(MAX_CHASE_CELLS).toBeGreaterThan(0);
    expect(HOLD_LINE_K_CELLS).toBeGreaterThan(0);
  });
});
