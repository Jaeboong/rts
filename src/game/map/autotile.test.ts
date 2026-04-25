import { describe, expect, it } from 'vitest';
import {
  computeEdgeMask,
  pickAutotile,
  tileKindBaseClass,
} from './autotile';
import {
  BIT_E,
  BIT_N,
  BIT_S,
  BIT_W,
  TILE_SLOTS_BY_ID,
} from './tile-sheet';
import type { TileKind } from './types';

// 5x5 grid helper — fills with `fill` then overrides per-coord overrides.
function makeGrid(
  fill: TileKind,
  overrides: ReadonlyArray<{ x: number; y: number; k: TileKind }> = [],
  w = 5,
  h = 5,
): { tiles: TileKind[]; w: number; h: number } {
  const tiles: TileKind[] = new Array(w * h).fill(fill);
  for (const o of overrides) tiles[o.y * w + o.x] = o.k;
  return { tiles, w, h };
}

describe('tileKindBaseClass', () => {
  it('classifies water-* as water', () => {
    expect(tileKindBaseClass('water-1')).toBe('water');
    expect(tileKindBaseClass('water-4')).toBe('water');
  });
  it('classifies wall-* as wall', () => {
    expect(tileKindBaseClass('wall-3')).toBe('wall');
  });
  it('classifies dirt-* as dirt', () => {
    expect(tileKindBaseClass('dirt-1')).toBe('dirt');
  });
  it('classifies grass-* as grass', () => {
    expect(tileKindBaseClass('grass-1')).toBe('grass');
  });
  it('classifies prop-* as grass (props overlay grass terrain)', () => {
    expect(tileKindBaseClass('prop-tree')).toBe('grass');
    expect(tileKindBaseClass('prop-rocks')).toBe('grass');
  });
});

describe('computeEdgeMask', () => {
  it('returns 0 when all neighbours are same class', () => {
    const g = makeGrid('grass-1');
    expect(computeEdgeMask(g.tiles, 2, 2, g.w, g.h)).toBe(0);
  });

  it('sets N bit when neighbour above is water', () => {
    const g = makeGrid('grass-1', [{ x: 2, y: 1, k: 'water-1' }]);
    expect(computeEdgeMask(g.tiles, 2, 2, g.w, g.h)).toBe(BIT_N);
  });

  it('sets E bit when neighbour right is water', () => {
    const g = makeGrid('grass-1', [{ x: 3, y: 2, k: 'water-1' }]);
    expect(computeEdgeMask(g.tiles, 2, 2, g.w, g.h)).toBe(BIT_E);
  });

  it('sets S bit when neighbour below is water', () => {
    const g = makeGrid('grass-1', [{ x: 2, y: 3, k: 'water-1' }]);
    expect(computeEdgeMask(g.tiles, 2, 2, g.w, g.h)).toBe(BIT_S);
  });

  it('sets W bit when neighbour left is water', () => {
    const g = makeGrid('grass-1', [{ x: 1, y: 2, k: 'water-1' }]);
    expect(computeEdgeMask(g.tiles, 2, 2, g.w, g.h)).toBe(BIT_W);
  });

  it('combines bits for two-side adjacency (S+W)', () => {
    const g = makeGrid('grass-1', [
      { x: 2, y: 3, k: 'water-1' },
      { x: 1, y: 2, k: 'water-1' },
    ]);
    expect(computeEdgeMask(g.tiles, 2, 2, g.w, g.h)).toBe(BIT_S | BIT_W);
  });

  it('returns 0 for water-centre cells (water never carries edges)', () => {
    const g = makeGrid('water-1');
    expect(computeEdgeMask(g.tiles, 2, 2, g.w, g.h)).toBe(0);
  });

  it('returns 0 for wall-centre cells (wall not in autotile system)', () => {
    const g = makeGrid('wall-1');
    expect(computeEdgeMask(g.tiles, 2, 2, g.w, g.h)).toBe(0);
  });

  it('treats out-of-bounds as same class — no edges along map borders', () => {
    const g = makeGrid('grass-1');
    // Top-left corner: only E and S neighbours are in-bounds (and same class)
    expect(computeEdgeMask(g.tiles, 0, 0, g.w, g.h)).toBe(0);
    // Bottom-right corner
    expect(computeEdgeMask(g.tiles, 4, 4, g.w, g.h)).toBe(0);
  });

  it('does not flag dirt neighbours of grass centre as edges', () => {
    // dirt and grass are both LAND classes; only water triggers the edge bit.
    const g = makeGrid('grass-1', [{ x: 2, y: 1, k: 'dirt-1' }]);
    expect(computeEdgeMask(g.tiles, 2, 2, g.w, g.h)).toBe(0);
  });
});

describe('pickAutotile — water + wall short-circuits', () => {
  it('water cell picks a water base slot', () => {
    const g = makeGrid('water-1');
    const id = pickAutotile(g.tiles, 2, 2, g.w, g.h);
    const slot = TILE_SLOTS_BY_ID[id];
    expect(slot).toBeDefined();
    expect(slot.baseClass).toBe('water');
    expect(slot.edgeMask).toBe(0);
  });

  it('wall cell picks a wall base slot (row-0 walled-pit fallback)', () => {
    const g = makeGrid('wall-1');
    const id = pickAutotile(g.tiles, 1, 1, g.w, g.h);
    const slot = TILE_SLOTS_BY_ID[id];
    expect(slot).toBeDefined();
    expect(slot.baseClass).toBe('wall');
    expect(slot.edgeMask).toBe(0);
  });
});

describe('pickAutotile — land base (mask = 0)', () => {
  it('grass cell with all-grass neighbours picks a grass base slot', () => {
    const g = makeGrid('grass-1');
    const id = pickAutotile(g.tiles, 2, 2, g.w, g.h);
    const slot = TILE_SLOTS_BY_ID[id];
    expect(slot.baseClass).toBe('grass');
    expect(slot.edgeMask).toBe(0);
  });

  it('dirt cell with all-dirt neighbours picks a dirt base slot', () => {
    const g = makeGrid('dirt-1');
    const id = pickAutotile(g.tiles, 2, 2, g.w, g.h);
    expect(TILE_SLOTS_BY_ID[id].baseClass).toBe('dirt');
    expect(TILE_SLOTS_BY_ID[id].edgeMask).toBe(0);
  });

  it('grass cell with dirt neighbours (still both land) picks a grass base, not an edge', () => {
    const g = makeGrid('grass-1', [
      { x: 2, y: 1, k: 'dirt-1' },
      { x: 2, y: 3, k: 'dirt-1' },
    ]);
    const id = pickAutotile(g.tiles, 2, 2, g.w, g.h);
    expect(TILE_SLOTS_BY_ID[id].edgeMask).toBe(0);
  });
});

describe('pickAutotile — single-edge masks', () => {
  const cases = [
    { name: 'water N', dx: 0, dy: -1, mask: BIT_N },
    { name: 'water E', dx: 1, dy: 0, mask: BIT_E },
    { name: 'water S', dx: 0, dy: 1, mask: BIT_S },
    { name: 'water W', dx: -1, dy: 0, mask: BIT_W },
  ] as const;

  for (const c of cases) {
    it(`grass centre with ${c.name} → grass slot with that exact edge mask`, () => {
      const g = makeGrid('grass-1', [{ x: 2 + c.dx, y: 2 + c.dy, k: 'water-1' }]);
      const id = pickAutotile(g.tiles, 2, 2, g.w, g.h);
      const slot = TILE_SLOTS_BY_ID[id];
      expect(slot.baseClass).toBe('grass');
      expect(slot.edgeMask).toBe(c.mask);
    });

    it(`dirt centre with ${c.name} → dirt slot with that exact edge mask`, () => {
      const g = makeGrid('dirt-1', [{ x: 2 + c.dx, y: 2 + c.dy, k: 'water-1' }]);
      const id = pickAutotile(g.tiles, 2, 2, g.w, g.h);
      const slot = TILE_SLOTS_BY_ID[id];
      expect(slot.baseClass).toBe('dirt');
      expect(slot.edgeMask).toBe(c.mask);
    });
  }
});

describe('pickAutotile — concave-corner masks', () => {
  const corners = [
    { name: 'NE', a: { dx: 0, dy: -1 }, b: { dx: 1, dy: 0 }, mask: BIT_N | BIT_E },
    { name: 'NW', a: { dx: 0, dy: -1 }, b: { dx: -1, dy: 0 }, mask: BIT_N | BIT_W },
    { name: 'SE', a: { dx: 0, dy: 1 }, b: { dx: 1, dy: 0 }, mask: BIT_S | BIT_E },
    { name: 'SW', a: { dx: 0, dy: 1 }, b: { dx: -1, dy: 0 }, mask: BIT_S | BIT_W },
  ] as const;

  for (const c of corners) {
    it(`grass centre with water on ${c.name} → matching corner slot`, () => {
      const g = makeGrid('grass-1', [
        { x: 2 + c.a.dx, y: 2 + c.a.dy, k: 'water-1' },
        { x: 2 + c.b.dx, y: 2 + c.b.dy, k: 'water-1' },
      ]);
      const id = pickAutotile(g.tiles, 2, 2, g.w, g.h);
      const slot = TILE_SLOTS_BY_ID[id];
      expect(slot.baseClass).toBe('grass');
      expect(slot.edgeMask).toBe(c.mask);
    });
  }
});

describe('pickAutotile — fallback for unsupported masks', () => {
  // Sheet has 8 supported edge masks per land class. Masks that aren't in
  // {N,E,S,W,NE,NW,SE,SW} are unsupported; e.g. N+S (5), E+W (10), full (15).
  it('unsupported mask N+S falls back to a single-side mask present in sheet (N or S)', () => {
    const g = makeGrid('grass-1', [
      { x: 2, y: 1, k: 'water-1' },
      { x: 2, y: 3, k: 'water-1' },
    ]);
    const id = pickAutotile(g.tiles, 2, 2, g.w, g.h);
    const slot = TILE_SLOTS_BY_ID[id];
    expect(slot.baseClass).toBe('grass');
    // Best AND-popcount when requested = 5 (N+S) is 1 — both BIT_N (1) and BIT_S
    // (4) score 1; tie-break picks lowest mask value → BIT_N.
    expect(slot.edgeMask).toBe(BIT_N);
  });

  it('fully surrounded (mask 15) falls back to a corner mask (highest popcount of intersection)', () => {
    const g = makeGrid('grass-1', [
      { x: 2, y: 1, k: 'water-1' },
      { x: 2, y: 3, k: 'water-1' },
      { x: 1, y: 2, k: 'water-1' },
      { x: 3, y: 2, k: 'water-1' },
    ]);
    const id = pickAutotile(g.tiles, 2, 2, g.w, g.h);
    const slot = TILE_SLOTS_BY_ID[id];
    expect(slot.baseClass).toBe('grass');
    // mask 15 ANDed with each supported corner (3,5,9,12,...) yields 2 bits;
    // single edges yield 1. Tie-break → lowest of {3,5,6,9,10,12} = 3 (NE).
    expect(slot.edgeMask).toBe(BIT_N | BIT_E);
  });
});

describe('pickAutotile — determinism', () => {
  it('returns the same slot id for the same cell on repeated calls', () => {
    const g = makeGrid('grass-1');
    const a = pickAutotile(g.tiles, 2, 2, g.w, g.h);
    const b = pickAutotile(g.tiles, 2, 2, g.w, g.h);
    expect(a).toBe(b);
  });

  it('different cells with same neighbourhood pick across both grass base variants (cell-hashed)', () => {
    const g = makeGrid('grass-1', [], 8, 8);
    const ids = new Set<string>();
    for (let cy = 1; cy < 7; cy++) {
      for (let cx = 1; cx < 7; cx++) {
        ids.add(pickAutotile(g.tiles, cx, cy, g.w, g.h));
      }
    }
    // Both grass base slots (c1r0 and c5r0) should appear across 36 cells if
    // the cell hash actually distributes; <2 means the hash collapses to one
    // variant.
    expect(ids.size).toBeGreaterThanOrEqual(2);
    for (const id of ids) {
      expect(['c1r0', 'c5r0']).toContain(id);
    }
  });
});

// Slot-id assertions — guard against silent re-classification of column meanings
// in tile-sheet.ts. If a future edit swaps EDGE_BY_COL entries, these tests
// catch it; without them the mask-only tests would still pass.
describe('pickAutotile — concrete slot-id sanity', () => {
  it('grass centre with water W -> c2r2', () => {
    const g = makeGrid('grass-1', [{ x: 1, y: 2, k: 'water-1' }]);
    expect(pickAutotile(g.tiles, 2, 2, g.w, g.h)).toBe('c2r2');
  });

  it('grass centre with water E -> c3r2', () => {
    const g = makeGrid('grass-1', [{ x: 3, y: 2, k: 'water-1' }]);
    expect(pickAutotile(g.tiles, 2, 2, g.w, g.h)).toBe('c3r2');
  });

  it('dirt centre with water S+W -> c4r1', () => {
    const g = makeGrid('dirt-1', [
      { x: 2, y: 3, k: 'water-1' },
      { x: 1, y: 2, k: 'water-1' },
    ]);
    expect(pickAutotile(g.tiles, 2, 2, g.w, g.h)).toBe('c4r1');
  });

  it('grass centre with water N+E -> c7r2', () => {
    const g = makeGrid('grass-1', [
      { x: 2, y: 1, k: 'water-1' },
      { x: 3, y: 2, k: 'water-1' },
    ]);
    expect(pickAutotile(g.tiles, 2, 2, g.w, g.h)).toBe('c7r2');
  });
});

// Wall-cell pool — ensures only row-0 walled-pits are reachable, not row-3
// grass+dirt+stone barrier sprites. If a future edit lets row-3 leak into the
// wall bin, this catches it (via TILE_SLOTS shape).
describe('pickAutotile — wall pool excludes row-3 barrier art', () => {
  it('wall cell only ever picks c3r0 or c7r0 (row-0 walled-pits)', () => {
    const g = makeGrid('wall-1', [], 16, 16);
    const ids = new Set<string>();
    for (let cy = 1; cy < 15; cy++) {
      for (let cx = 1; cx < 15; cx++) {
        ids.add(pickAutotile(g.tiles, cx, cy, g.w, g.h));
      }
    }
    for (const id of ids) {
      expect(['c3r0', 'c7r0']).toContain(id);
    }
    // And both row-0 wall variants should actually be hit by the cell hash.
    expect(ids.size).toBeGreaterThanOrEqual(2);
  });
});
