import { describe, expect, it } from 'vitest';
import { spawnUnit } from '../entities';
import { cellToPx, createWorld } from '../world';
import { movementSystem } from './movement';

const DT = 1 / 20;

describe('movement facing', () => {
  it('worker walking east sets facing ≈ 0', () => {
    const w = createWorld();
    const u = spawnUnit(w, 'worker', 'player', cellToPx(10, 10));
    // Path entirely east of current pos.
    u.path = [{ x: u.pos.x + 100, y: u.pos.y }];
    movementSystem(w, DT);
    expect(u.facing).toBeDefined();
    expect(u.facing!).toBeCloseTo(0, 5);
  });

  it('marine walking south sets facing ≈ +π/2 (canvas y-down convention)', () => {
    const w = createWorld();
    const u = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    u.path = [{ x: u.pos.x, y: u.pos.y + 100 }];
    movementSystem(w, DT);
    expect(u.facing).toBeCloseTo(Math.PI / 2, 5);
  });

  it('tank walking north sets facing ≈ -π/2', () => {
    const w = createWorld();
    const u = spawnUnit(w, 'tank', 'player', cellToPx(20, 20));
    u.path = [{ x: u.pos.x, y: u.pos.y - 100 }];
    movementSystem(w, DT);
    expect(u.facing).toBeCloseTo(-Math.PI / 2, 5);
  });

  it('worker walking west sets facing ≈ π', () => {
    const w = createWorld();
    const u = spawnUnit(w, 'worker', 'player', cellToPx(20, 20));
    u.path = [{ x: u.pos.x - 100, y: u.pos.y }];
    movementSystem(w, DT);
    // atan2(0, -1) = π
    expect(Math.abs(u.facing!)).toBeCloseTo(Math.PI, 5);
  });

  it('enemyDummy has no facing (static, no rotation)', () => {
    const w = createWorld();
    const e = spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(10, 10));
    expect(e.facing).toBeUndefined();
  });

  it('idle unit (no path) keeps facing unchanged', () => {
    const w = createWorld();
    const u = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    u.facing = Math.PI / 4;
    movementSystem(w, DT);
    expect(u.facing).toBeCloseTo(Math.PI / 4, 9);
  });
});
