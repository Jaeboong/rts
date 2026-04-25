import { describe, expect, it } from 'vitest';
import { westernFrontPreset } from './presets/western-front';
import type { TileKind } from './types';

const SEED = 42;
const W = 128;
const H = 128;

function isWater(t: TileKind): boolean {
  return t.startsWith('water-');
}

function isGrass(t: TileKind): boolean {
  return t.startsWith('grass-');
}

describe('westernFrontPreset', () => {
  it('exposes name + dimensions', () => {
    expect(westernFrontPreset.name).toBe('Western Front');
    expect(westernFrontPreset.width).toBe(W);
    expect(westernFrontPreset.height).toBe(H);
  });

  it('generate(42) is deterministic across calls', () => {
    const a = westernFrontPreset.generate(SEED);
    const b = westernFrontPreset.generate(SEED);
    expect(a.tiles).toEqual(b.tiles);
    expect(a.spawns).toEqual(b.spawns);
  });

  it('generate(42) produces tiles array of length GRID_W*GRID_H (128*128 = 16384)', () => {
    const { tiles } = westernFrontPreset.generate(SEED);
    expect(tiles).toHaveLength(W * H);
  });

  it('contains exactly 1 player CommandCenter and 1 enemy CommandCenter', () => {
    const { spawns } = westernFrontPreset.generate(SEED);
    const playerCc = spawns.filter(
      (s) => s.kind === 'commandCenter' && s.team === 'player',
    );
    const enemyCc = spawns.filter(
      (s) => s.kind === 'commandCenter' && s.team === 'enemy',
    );
    expect(playerCc).toHaveLength(1);
    expect(enemyCc).toHaveLength(1);
  });

  it('contains 17-25 mineral nodes (4-5 per base × 5 bases)', () => {
    const { spawns } = westernFrontPreset.generate(SEED);
    const minerals = spawns.filter((s) => s.kind === 'mineralNode');
    expect(minerals.length).toBeGreaterThanOrEqual(17);
    expect(minerals.length).toBeLessThanOrEqual(25);
  });

  it('contains exactly 5 gas geysers (1 per base — 2 mains + 3 multis)', () => {
    const { spawns } = westernFrontPreset.generate(SEED);
    const geysers = spawns.filter((s) => s.kind === 'gasGeyser');
    expect(geysers).toHaveLength(5);
  });

  it('player and enemy CCs are at least 60 cells apart (Manhattan)', () => {
    const { spawns } = westernFrontPreset.generate(SEED);
    const p = spawns.find((s) => s.kind === 'commandCenter' && s.team === 'player');
    const e = spawns.find((s) => s.kind === 'commandCenter' && s.team === 'enemy');
    expect(p).toBeDefined();
    expect(e).toBeDefined();
    if (!p || !e) return;
    const dist = Math.abs(p.cellX - e.cellX) + Math.abs(p.cellY - e.cellY);
    expect(dist).toBeGreaterThanOrEqual(60);
  });

  it('has more than 50 water cells (river was carved)', () => {
    const { tiles } = westernFrontPreset.generate(SEED);
    const water = tiles.filter(isWater).length;
    expect(water).toBeGreaterThan(50);
  });

  it('has more than 1500 grass cells (grass dominates)', () => {
    const { tiles } = westernFrontPreset.generate(SEED);
    const grass = tiles.filter(isGrass).length;
    expect(grass).toBeGreaterThan(1500);
  });

  it('contains 4 player workers spawned next to player main CC', () => {
    const { spawns } = westernFrontPreset.generate(SEED);
    const workers = spawns.filter((s) => s.kind === 'worker' && s.team === 'player');
    expect(workers).toHaveLength(4);
  });

  it('contains 2-3 enemy dummies near enemy main', () => {
    const { spawns } = westernFrontPreset.generate(SEED);
    const dummies = spawns.filter((s) => s.kind === 'enemyDummy');
    expect(dummies.length).toBeGreaterThanOrEqual(2);
    expect(dummies.length).toBeLessThanOrEqual(3);
  });

  it('no spawn placed on a water cell', () => {
    const { tiles, spawns } = westernFrontPreset.generate(SEED);
    for (const s of spawns) {
      const idx = s.cellY * W + s.cellX;
      const t = tiles[idx];
      expect(isWater(t)).toBe(false);
    }
  });

  it('player CC center is reachable from enemy CC center via walkable tiles (BFS)', () => {
    const { tiles, spawns } = westernFrontPreset.generate(SEED);
    const p = spawns.find((s) => s.kind === 'commandCenter' && s.team === 'player');
    const e = spawns.find((s) => s.kind === 'commandCenter' && s.team === 'enemy');
    if (!p || !e) throw new Error('Missing CC spawn');

    const visited = new Uint8Array(W * H);
    // Use CC center cells (footprint is 20×20).
    const start = (p.cellY + 10) * W + (p.cellX + 10);
    const goal = (e.cellY + 10) * W + (e.cellX + 10);
    const q: number[] = [start];
    visited[start] = 1;
    let found = false;
    while (q.length > 0) {
      const cur = q.shift();
      if (cur === undefined) break;
      if (cur === goal) {
        found = true;
        break;
      }
      const cx = cur % W;
      const cy = Math.floor(cur / W);
      const ns: ReadonlyArray<readonly [number, number]> = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      for (const [dx, dy] of ns) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (visited[ni]) continue;
        if (isWater(tiles[ni])) continue;
        visited[ni] = 1;
        q.push(ni);
      }
    }
    expect(found).toBe(true);
  });

  it('no two spawn footprints overlap (CC=20×20, mineral/gas=5×5)', () => {
    const { spawns } = westernFrontPreset.generate(SEED);
    function size(kind: string): number {
      if (kind === 'commandCenter') return 20;
      if (kind === 'mineralNode' || kind === 'gasGeyser') return 5;
      return 1;
    }
    for (let i = 0; i < spawns.length; i++) {
      for (let j = i + 1; j < spawns.length; j++) {
        const a = spawns[i];
        const b = spawns[j];
        const aw = size(a.kind);
        const bw = size(b.kind);
        const overlap =
          a.cellX < b.cellX + bw &&
          a.cellX + aw > b.cellX &&
          a.cellY < b.cellY + bw &&
          a.cellY + aw > b.cellY;
        expect(overlap).toBe(false);
      }
    }
  });

  it('different seeds produce different results', () => {
    const a = westernFrontPreset.generate(42);
    const b = westernFrontPreset.generate(7);
    expect(a.tiles).not.toEqual(b.tiles);
  });
});
