import { describe, expect, it } from 'vitest';
import { CELL } from '../types';
import { findPath } from './pathfinding';
import { createWorld, setOccupancy } from './world';

describe('A* pathfinding', () => {
  it('returns empty path when start === goal', () => {
    const w = createWorld();
    expect(findPath(w, 5, 5, 5, 5)).toEqual([]);
  });

  it('finds a straight path on empty grid', () => {
    const w = createWorld();
    const path = findPath(w, 0, 0, 5, 0);
    expect(path).not.toBeNull();
    expect(path!.length).toBe(5);
    // Last waypoint must be center of (5,0)
    const last = path![path!.length - 1];
    expect(last.x).toBe(5 * CELL + CELL / 2);
    expect(last.y).toBe(0 * CELL + CELL / 2);
  });

  it('routes around an obstacle', () => {
    const w = createWorld();
    // Wall: cells (2, 0..4)
    for (let y = 0; y < 5; y++) {
      setOccupancy(w, 2, y, 1, 1, 999);
    }
    const path = findPath(w, 0, 0, 4, 0);
    expect(path).not.toBeNull();
    // No waypoint may sit on a blocked cell
    for (const wp of path!) {
      const cx = Math.floor(wp.x / CELL);
      const cy = Math.floor(wp.y / CELL);
      expect(cx === 2 && cy >= 0 && cy < 5).toBe(false);
    }
    // Final waypoint reaches goal
    const last = path![path!.length - 1];
    expect(Math.floor(last.x / CELL)).toBe(4);
    expect(Math.floor(last.y / CELL)).toBe(0);
  });

  it('returns null when goal is unreachable', () => {
    const w = createWorld();
    // Surround goal with walls
    setOccupancy(w, 4, 5, 1, 1, 1);
    setOccupancy(w, 6, 5, 1, 1, 1);
    setOccupancy(w, 5, 4, 1, 1, 1);
    setOccupancy(w, 5, 6, 1, 1, 1);
    setOccupancy(w, 4, 4, 1, 1, 1);
    setOccupancy(w, 6, 6, 1, 1, 1);
    setOccupancy(w, 4, 6, 1, 1, 1);
    setOccupancy(w, 6, 4, 1, 1, 1);
    const path = findPath(w, 0, 0, 5, 5);
    expect(path).toBeNull();
  });

  it('can reach a blocked goal when ignoreId matches', () => {
    const w = createWorld();
    setOccupancy(w, 5, 5, 1, 1, 42);
    const blocked = findPath(w, 0, 0, 5, 5);
    expect(blocked).not.toBeNull(); // goal cell allowed even if blocked
    const ignored = findPath(w, 0, 0, 5, 5, 42);
    expect(ignored).not.toBeNull();
  });
});
