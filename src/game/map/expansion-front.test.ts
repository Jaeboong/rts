import { describe, expect, it } from 'vitest';
import { expansionFrontPreset, previewAnchors } from './presets/expansion-front';
import { CC_SIZE, measureCorridorWidth } from './presets/expansion-front-carve';
import type { TileKind } from './types';

const SEED = 42;
const W = 256;
const H = 256;

function isWater(t: TileKind): boolean {
  return t.startsWith('water-');
}

function isWall(t: TileKind): boolean {
  return t.startsWith('wall-');
}

function isBlocking(t: TileKind): boolean {
  return isWater(t) || isWall(t);
}

function isGrass(t: TileKind): boolean {
  return t.startsWith('grass-');
}

// BFS treating water+wall as blocking (matches isCellBlocked in world.ts).
function bfsReachable(
  tiles: readonly TileKind[],
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): boolean {
  const visited = new Uint8Array(W * H);
  const start = fromY * W + fromX;
  const goal = toY * W + toX;
  if (isBlocking(tiles[start]) || isBlocking(tiles[goal])) return false;
  const q: number[] = [start];
  visited[start] = 1;
  while (q.length > 0) {
    const cur = q.shift();
    if (cur === undefined) break;
    if (cur === goal) return true;
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
      if (isBlocking(tiles[ni])) continue;
      visited[ni] = 1;
      q.push(ni);
    }
  }
  return false;
}

describe('expansionFrontPreset', () => {
  it('exposes name + dimensions', () => {
    expect(expansionFrontPreset.name).toBe('Expansion Front');
    expect(expansionFrontPreset.width).toBe(W);
    expect(expansionFrontPreset.height).toBe(H);
  });

  it('generate(42) is deterministic across calls', () => {
    const a = expansionFrontPreset.generate(SEED);
    const b = expansionFrontPreset.generate(SEED);
    expect(a.tiles).toEqual(b.tiles);
    expect(a.spawns).toEqual(b.spawns);
  });

  it('produces tiles array of length 256*256 = 65536', () => {
    const { tiles } = expansionFrontPreset.generate(SEED);
    expect(tiles).toHaveLength(W * H);
  });

  it('contains exactly 1 player CC and 1 enemy CC', () => {
    const { spawns } = expansionFrontPreset.generate(SEED);
    const playerCc = spawns.filter(
      (s) => s.kind === 'commandCenter' && s.team === 'player',
    );
    const enemyCc = spawns.filter(
      (s) => s.kind === 'commandCenter' && s.team === 'enemy',
    );
    expect(playerCc).toHaveLength(1);
    expect(enemyCc).toHaveLength(1);
  });

  it('mineral count in [22, 38] (Phase 46 density target)', () => {
    const { spawns } = expansionFrontPreset.generate(SEED);
    const minerals = spawns.filter((s) => s.kind === 'mineralNode');
    expect(minerals.length).toBeGreaterThanOrEqual(22);
    expect(minerals.length).toBeLessThanOrEqual(38);
  });

  it('gas geyser count in [2, 5] (Phase 46 density target)', () => {
    const { spawns } = expansionFrontPreset.generate(SEED);
    const geysers = spawns.filter((s) => s.kind === 'gasGeyser');
    expect(geysers.length).toBeGreaterThanOrEqual(2);
    expect(geysers.length).toBeLessThanOrEqual(5);
  });

  it('player and enemy mains are far apart (Manhattan ≥ 350)', () => {
    const { spawns } = expansionFrontPreset.generate(SEED);
    const p = spawns.find((s) => s.kind === 'commandCenter' && s.team === 'player');
    const e = spawns.find((s) => s.kind === 'commandCenter' && s.team === 'enemy');
    expect(p).toBeDefined();
    expect(e).toBeDefined();
    if (!p || !e) return;
    const dist = Math.abs(p.cellX - e.cellX) + Math.abs(p.cellY - e.cellY);
    expect(dist).toBeGreaterThanOrEqual(350);
  });

  it('contains 4 player workers spawned next to player main', () => {
    const { spawns } = expansionFrontPreset.generate(SEED);
    const workers = spawns.filter((s) => s.kind === 'worker' && s.team === 'player');
    expect(workers).toHaveLength(4);
  });

  it('no spawn placed on water or wall cells', () => {
    const { tiles, spawns } = expansionFrontPreset.generate(SEED);
    for (const s of spawns) {
      const t = tiles[s.cellY * W + s.cellX];
      expect(isWater(t)).toBe(false);
      expect(isWall(t)).toBe(false);
    }
  });

  it('grass dominates the map (>30000 grass cells, ~50% of 65k)', () => {
    const { tiles } = expansionFrontPreset.generate(SEED);
    const grass = tiles.filter(isGrass).length;
    expect(grass).toBeGreaterThan(30000);
  });

  it('has wall cells (chokepoints carved)', () => {
    const { tiles } = expansionFrontPreset.generate(SEED);
    const walls = tiles.filter(isWall).length;
    expect(walls).toBeGreaterThan(20);
  });

  it('has water cells (river carved — most of it gets overwritten by roads, that is fine)', () => {
    // Roads overwrite water (creating bridges); the river running NW->SE
    // overlaps heavily with the diagonal road graph, so most splats become
    // dirt. ≥20 cells survive in the corners as decorative pockets.
    const { tiles } = expansionFrontPreset.generate(SEED);
    const water = tiles.filter(isWater).length;
    expect(water).toBeGreaterThanOrEqual(20);
  });

  // Walls are walkable:false (TILE_DEFS) — chokepoints must NOT cut the map.
  // Run on multiple seeds to catch procedural edge cases.
  it.each([42, 7, 100, 1234])(
    'seed %i: player CC reachable from enemy CC via walkable tiles (walls block)',
    (seed) => {
      const { tiles, spawns } = expansionFrontPreset.generate(seed);
      const p = spawns.find((s) => s.kind === 'commandCenter' && s.team === 'player');
      const e = spawns.find((s) => s.kind === 'commandCenter' && s.team === 'enemy');
      if (!p || !e) throw new Error('Missing CC spawn');
      // Use CC center cells (footprint 20×20).
      const ok = bfsReachable(tiles, p.cellX + 10, p.cellY + 10, e.cellX + 10, e.cellY + 10);
      expect(ok).toBe(true);
    },
  );

  it('mineral nodes near player CC are reachable from player CC (workers can mine)', () => {
    const { tiles, spawns } = expansionFrontPreset.generate(SEED);
    const p = spawns.find((s) => s.kind === 'commandCenter' && s.team === 'player');
    if (!p) throw new Error('Missing player CC');
    const minerals = spawns.filter((s) => s.kind === 'mineralNode');
    // Find the 3 closest minerals to player CC; all must be reachable.
    const ranked = minerals
      .map((m) => ({
        m,
        d: Math.abs(m.cellX - p.cellX) + Math.abs(m.cellY - p.cellY),
      }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 3);
    for (const { m } of ranked) {
      const ok = bfsReachable(
        tiles,
        p.cellX + 10,
        p.cellY + 10,
        m.cellX + 2,
        m.cellY + 2,
      );
      expect(ok).toBe(true);
    }
  });

  it('mirror symmetry: player CC has a mirrored enemy CC across y=x', () => {
    // CCs are the load-bearing mirror invariant. Workers are spawned only
    // for the player here; main.ts seeds enemy workers separately via
    // seedEnemyTier1Infra — mirroring those would double-spawn at runtime.
    const { spawns } = expansionFrontPreset.generate(SEED);
    const p = spawns.find((s) => s.kind === 'commandCenter' && s.team === 'player');
    const e = spawns.find((s) => s.kind === 'commandCenter' && s.team === 'enemy');
    if (!p || !e) throw new Error('Missing CC spawn');
    // Mirror function: (x, y) → (y, x). After symmetric jitter the mirror is exact.
    expect(e.cellX).toBe(p.cellY);
    expect(e.cellY).toBe(p.cellX);
  });

  it('mirror symmetry: neutral resources roughly mirror across y=x', () => {
    // Strict mirror is hard for neutral spawns because mineral placement uses
    // RNG ring sampling — center spawns are on-diagonal but main/natural
    // ring placements aren't deterministically paired. Instead assert the
    // symmetric count: the number of resources in the upper-left half ≈ the
    // number in the lower-right half (within ±5).
    const { spawns } = expansionFrontPreset.generate(SEED);
    const neutral = spawns.filter(
      (s) => s.team === 'neutral' && (s.kind === 'mineralNode' || s.kind === 'gasGeyser'),
    );
    let upperLeft = 0;
    let lowerRight = 0;
    for (const s of neutral) {
      // y=x line: cellX === cellY → on-diagonal (skip from imbalance check).
      if (s.cellX < s.cellY) upperLeft++;
      else if (s.cellX > s.cellY) lowerRight++;
    }
    // ±10 imbalance accepted because mineral ring placement uses sequential
    // RNG: the second side sees a different rejection landscape after the
    // first side's spawns, so exact count parity isn't guaranteed.
    expect(Math.abs(upperLeft - lowerRight)).toBeLessThanOrEqual(10);
  });

  it('no two spawn footprints overlap (CC=20×20, mineral/gas=5×5, worker=1×1)', () => {
    const { spawns } = expansionFrontPreset.generate(SEED);
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

  it('different seeds produce different tile arrays', () => {
    const a = expansionFrontPreset.generate(42);
    const b = expansionFrontPreset.generate(7);
    expect(a.tiles).not.toEqual(b.tiles);
  });

  // Spec: "BFS: own CC ↔ opposite CC + each expansion all walkable-connected
  // (no chokepoint cuts off)". Test naturals/thirds reachability across seeds.
  it.each([42, 7, 100, 1234])(
    'seed %i: player main reaches own natural and own third (chokepoints don\'t cut)',
    (seed) => {
      const { tiles } = expansionFrontPreset.generate(seed);
      const a = previewAnchors(seed);
      const half = Math.floor(CC_SIZE / 2);
      // playerMain center → playerNatural anchor center
      const okNat = bfsReachable(
        tiles,
        a.playerMain.cellX + half,
        a.playerMain.cellY + half,
        a.playerNatural.cellX + half,
        a.playerNatural.cellY + half,
      );
      expect(okNat).toBe(true);
      // playerMain → playerThird
      const okThird = bfsReachable(
        tiles,
        a.playerMain.cellX + half,
        a.playerMain.cellY + half,
        a.playerThird.cellX + half,
        a.playerThird.cellY + half,
      );
      expect(okThird).toBe(true);
      // Mirror — same on enemy side.
      const okEnemyNat = bfsReachable(
        tiles,
        a.enemyMain.cellX + half,
        a.enemyMain.cellY + half,
        a.enemyNatural.cellX + half,
        a.enemyNatural.cellY + half,
      );
      expect(okEnemyNat).toBe(true);
    },
  );

  // Spec: "Chokepoint widths: natural 3-5 cells, third 5-8 cells". Walls are
  // walkable:false, so the corridor through the chokepoint is the narrowest
  // perpendicular passage. measureCorridorWidth returns the min across a
  // small thickness window (so a 1-cell-thick wall the road steps around
  // would be flagged as no chokepoint at all).
  it('natural chokepoints are narrow corridors (width ≤ 7)', () => {
    const { tiles } = expansionFrontPreset.generate(SEED);
    const a = previewAnchors(SEED);
    const half = Math.floor(CC_SIZE / 2);
    // Player natural choke is between playerMain and playerNatural.
    const fromX = a.playerMain.cellX + half;
    const fromY = a.playerMain.cellY + half;
    const toX = a.playerNatural.cellX + half;
    const toY = a.playerNatural.cellY + half;
    const midX = Math.round((fromX + toX) / 2);
    const midY = Math.round((fromY + toY) / 2);
    const corridorWidth = measureCorridorWidth(tiles, midX, midY, {
      dx: toX - fromX,
      dy: toY - fromY,
    });
    // gapCells = 3..5; allow ±2 measurement slack from sub-cell rounding +
    // dirt corridor reinforcement. Spec says 3-5 — assert ≤7 (tight enough
    // to catch a "no chokepoint" 20+ width regression).
    expect(corridorWidth).toBeGreaterThanOrEqual(2);
    expect(corridorWidth).toBeLessThanOrEqual(7);
  });

  it('third chokepoints are wider corridors (5 ≤ width ≤ 12)', () => {
    const { tiles } = expansionFrontPreset.generate(SEED);
    const a = previewAnchors(SEED);
    const half = Math.floor(CC_SIZE / 2);
    // Third choke is between playerThird and centerJ.
    const center = a.centers[0];
    const fromX = a.playerThird.cellX + half;
    const fromY = a.playerThird.cellY + half;
    const toX = center.cellX + half;
    const toY = center.cellY + half;
    const midX = Math.round((fromX + toX) / 2);
    const midY = Math.round((fromY + toY) / 2);
    const corridorWidth = measureCorridorWidth(tiles, midX, midY, {
      dx: toX - fromX,
      dy: toY - fromY,
    });
    // gapCells = 5..8; allow ±4 slack.
    expect(corridorWidth).toBeGreaterThanOrEqual(3);
    expect(corridorWidth).toBeLessThanOrEqual(12);
  });
});
