import { describe, expect, it } from 'vitest';

import { CELL } from '../../types';

import {
  averagePos,
  selectWaveMembers,
  selectWaveTarget,
  shouldDispatchWave,
} from './strategy';
import type { GameView, ViewEntity } from './types';

function makeMarine(id: number, x: number, y: number, hp = 60): ViewEntity {
  return {
    id,
    kind: 'marine',
    team: 'enemy',
    pos: { x, y },
    hp,
    maxHp: 60,
  };
}

function makeView(opts: {
  tick?: number;
  myEntities?: readonly ViewEntity[];
  visibleEnemies?: readonly ViewEntity[];
} = {}): GameView {
  return {
    tick: opts.tick ?? 0,
    resources: { minerals: 0, gas: 0 },
    myEntities: opts.myEntities ?? [],
    visibleEnemies: opts.visibleEnemies ?? [],
    visibleResources: [],
    mapInfo: { w: 128, h: 128, cellPx: CELL },
  };
}

describe('strategy.shouldDispatchWave', () => {
  it('returns false before cooldown elapses', () => {
    const v = makeView({
      tick: 100,
      myEntities: [
        makeMarine(1, 0, 0),
        makeMarine(2, 0, 0),
        makeMarine(3, 0, 0),
        makeMarine(4, 0, 0),
      ],
    });
    expect(shouldDispatchWave(v, 50, 100, 4)).toBe(false);
  });

  it('returns true once cooldown elapses and members suffice', () => {
    const v = makeView({
      tick: 200,
      myEntities: [
        makeMarine(1, 0, 0),
        makeMarine(2, 0, 0),
        makeMarine(3, 0, 0),
        makeMarine(4, 0, 0),
      ],
    });
    expect(shouldDispatchWave(v, 50, 100, 4)).toBe(true);
  });

  it('returns false if marines below threshold', () => {
    const v = makeView({
      tick: 1000,
      myEntities: [makeMarine(1, 0, 0), makeMarine(2, 0, 0)],
    });
    expect(shouldDispatchWave(v, 0, 100, 4)).toBe(false);
  });

  it('counts -Infinity sentinel as "never dispatched"', () => {
    const v = makeView({
      tick: 0,
      myEntities: [
        makeMarine(1, 0, 0),
        makeMarine(2, 0, 0),
        makeMarine(3, 0, 0),
        makeMarine(4, 0, 0),
      ],
    });
    expect(shouldDispatchWave(v, Number.NEGATIVE_INFINITY, 100, 4)).toBe(true);
  });
});

describe('strategy.selectWaveMembers', () => {
  it('returns lowest-id marines deterministically (insertion order irrelevant)', () => {
    const v = makeView({
      myEntities: [
        makeMarine(50, 0, 0),
        makeMarine(10, 0, 0),
        makeMarine(30, 0, 0),
        makeMarine(20, 0, 0),
        makeMarine(40, 0, 0),
      ],
    });
    expect(selectWaveMembers(v, 3)).toEqual([10, 20, 30]);
  });

  it('skips dead marines (hp <= 0)', () => {
    const v = makeView({
      myEntities: [makeMarine(1, 0, 0, 0), makeMarine(2, 0, 0), makeMarine(3, 0, 0)],
    });
    expect(selectWaveMembers(v, 4)).toEqual([2, 3]);
  });

  it('only counts marines (not workers / other kinds)', () => {
    const v = makeView({
      myEntities: [
        { id: 1, kind: 'worker', team: 'enemy', pos: { x: 0, y: 0 }, hp: 40, maxHp: 40 },
        makeMarine(2, 0, 0),
      ],
    });
    expect(selectWaveMembers(v, 5)).toEqual([2]);
  });
});

describe('strategy.selectWaveTarget', () => {
  it('prefers buildings over units', () => {
    const v = makeView({
      visibleEnemies: [
        { id: 1, kind: 'marine', team: 'player', pos: { x: 100, y: 100 }, hp: 60, maxHp: 60 },
        { id: 2, kind: 'commandCenter', team: 'player', pos: { x: 1000, y: 1000 }, hp: 1500, maxHp: 1500 },
      ],
    });
    expect(selectWaveTarget(v, { x: 0, y: 0 })).toEqual({ x: 1000, y: 1000 });
  });

  it('returns null when no enemies visible', () => {
    expect(selectWaveTarget(makeView(), { x: 0, y: 0 })).toBeNull();
  });

  it('picks the nearest building (tie-breaks by id)', () => {
    const v = makeView({
      visibleEnemies: [
        { id: 5, kind: 'commandCenter', team: 'player', pos: { x: 100, y: 0 }, hp: 1500, maxHp: 1500 },
        { id: 3, kind: 'commandCenter', team: 'player', pos: { x: 100, y: 0 }, hp: 1500, maxHp: 1500 },
      ],
    });
    expect(selectWaveTarget(v, { x: 0, y: 0 })).toEqual({ x: 100, y: 0 });
  });

  it('falls back to units when no buildings visible', () => {
    const v = makeView({
      visibleEnemies: [
        { id: 1, kind: 'marine', team: 'player', pos: { x: 50, y: 50 }, hp: 60, maxHp: 60 },
      ],
    });
    expect(selectWaveTarget(v, { x: 0, y: 0 })).toEqual({ x: 50, y: 50 });
  });
});

describe('strategy.averagePos', () => {
  it('returns null on empty input', () => {
    expect(averagePos([])).toBeNull();
  });

  it('computes mean position', () => {
    const r = averagePos([
      makeMarine(1, 0, 0),
      makeMarine(2, 100, 200),
    ]);
    expect(r).toEqual({ x: 50, y: 100 });
  });
});
