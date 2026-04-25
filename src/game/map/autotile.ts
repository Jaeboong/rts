// Autotile algorithm — pure function. Given a tile grid + cell coords, returns
// the slot id (e.g. 'c0r1') that should render at that cell.
//
// Rules:
//  1. Water cells always pick a base water variant (water never carries edges —
//     edges are LAND-centered, and a water-on-water edge is meaningless).
//  2. Wall cells render as the c3r0/c7r0 'walled-pit' base — the sheet's row 3
//     barrier art is for connected ridges we don't generate, so map preset
//     wall scatter falls back to row 0 stone-rim variants.
//  3. Land cells (dirt/grass) compute a 4-bit cardinal mask of which N/E/S/W
//     neighbours are water. Mask 0 picks a base variant; non-zero masks look up
//     a (centerClass, mask) edge tile in TILE_SLOTS. If no exact mask is
//     supported by the sheet, fall back to the supported mask with the highest
//     bitwise-AND popcount; ties broken by lowest mask value. As a last resort,
//     fall back to the base.
//  4. Map-edge boundaries: out-of-bounds neighbours are treated as the SAME
//     class as the centre (so the world edge doesn't trigger spurious water
//     edges along land borders).

import {
  BIT_E,
  BIT_N,
  BIT_S,
  BIT_W,
  TILE_SLOTS,
  type TerrainBaseClass,
  type TileSlot,
} from './tile-sheet';
import type { TileKind } from './types';

export function tileKindBaseClass(kind: TileKind): TerrainBaseClass {
  if (kind.startsWith('water-')) return 'water';
  if (kind.startsWith('wall-')) return 'wall';
  if (kind.startsWith('dirt-')) return 'dirt';
  // grass-* and prop-* both render on grass terrain — props are overlay markers
  // drawn on top of the grass base by the renderer (see tile-render.ts).
  return 'grass';
}

// Cell-deterministic 32-bit hash → variant pick. Two large primes avoid the
// patterning a naïve `(cx + cy) % n` produces.
function cellHash(cx: number, cy: number): number {
  return ((cx * 73856093) ^ (cy * 19349663)) >>> 0;
}

// Pre-bin slots by (baseClass, edgeMask) so pickAutotile is O(1) per lookup.
interface SlotBin {
  // Slots with this exact (class, mask) — variant pool.
  exact: TileSlot[];
}

type Bins = Map<string, SlotBin>;

function binKey(cls: TerrainBaseClass, mask: number): string {
  return `${cls}:${mask}`;
}

function buildBins(slots: readonly TileSlot[]): Bins {
  const bins: Bins = new Map();
  for (const s of slots) {
    const key = binKey(s.baseClass, s.edgeMask);
    let bin = bins.get(key);
    if (!bin) {
      bin = { exact: [] };
      bins.set(key, bin);
    }
    bin.exact.push(s);
  }
  return bins;
}

const BINS: Bins = buildBins(TILE_SLOTS);

// Supported edge masks per (class, mask). Computed lazily once for fallback.
function buildSupportedMasks(slots: readonly TileSlot[]): Map<TerrainBaseClass, number[]> {
  const out = new Map<TerrainBaseClass, number[]>();
  for (const s of slots) {
    if (s.edgeMask === 0) continue;
    const arr = out.get(s.baseClass);
    if (arr) {
      if (!arr.includes(s.edgeMask)) arr.push(s.edgeMask);
    } else {
      out.set(s.baseClass, [s.edgeMask]);
    }
  }
  for (const arr of out.values()) arr.sort((a, b) => a - b);
  return out;
}

const SUPPORTED_MASKS: Map<TerrainBaseClass, number[]> = buildSupportedMasks(TILE_SLOTS);

function popcount4(n: number): number {
  return ((n >> 0) & 1) + ((n >> 1) & 1) + ((n >> 2) & 1) + ((n >> 3) & 1);
}

// Pick the best supported mask for an unsupported request. Score = popcount of
// (request AND candidate); higher wins. Ties → lowest candidate value (stable).
function nearestSupportedMask(
  cls: TerrainBaseClass,
  requested: number,
): number | null {
  const supported = SUPPORTED_MASKS.get(cls);
  if (!supported || supported.length === 0) return null;
  let best = -1;
  let bestScore = -1;
  for (const m of supported) {
    const score = popcount4(requested & m);
    if (score > bestScore || (score === bestScore && (best === -1 || m < best))) {
      best = m;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}

// Pure neighbour-class fetch. Out-of-bounds → same class as centre (so world
// borders don't trigger spurious edge tiles along land edges).
function neighbourClass(
  tiles: readonly TileKind[],
  cx: number,
  cy: number,
  width: number,
  height: number,
  centerClass: TerrainBaseClass,
): TerrainBaseClass {
  if (cx < 0 || cy < 0 || cx >= width || cy >= height) return centerClass;
  return tileKindBaseClass(tiles[cy * width + cx]);
}

export function computeEdgeMask(
  tiles: readonly TileKind[],
  cellX: number,
  cellY: number,
  width: number,
  height: number,
): number {
  const center = tileKindBaseClass(tiles[cellY * width + cellX]);
  // Only land tiles compute edges — water and wall short-circuit before entering
  // this function in pickAutotile, but guard here too for direct callers/tests.
  if (center !== 'dirt' && center !== 'grass') return 0;

  const n = neighbourClass(tiles, cellX, cellY - 1, width, height, center);
  const e = neighbourClass(tiles, cellX + 1, cellY, width, height, center);
  const s = neighbourClass(tiles, cellX, cellY + 1, width, height, center);
  const w = neighbourClass(tiles, cellX - 1, cellY, width, height, center);

  let mask = 0;
  if (n === 'water') mask |= BIT_N;
  if (e === 'water') mask |= BIT_E;
  if (s === 'water') mask |= BIT_S;
  if (w === 'water') mask |= BIT_W;
  return mask;
}

function pickFromBin(bin: SlotBin, hash: number): TileSlot {
  const slot = bin.exact[hash % bin.exact.length];
  // exact is built non-empty at bin creation (see buildBins).
  return slot;
}

export function pickAutotile(
  tiles: readonly TileKind[],
  cellX: number,
  cellY: number,
  width: number,
  height: number,
): string {
  const idx = cellY * width + cellX;
  const center = tileKindBaseClass(tiles[idx]);
  const hash = cellHash(cellX, cellY);

  // Water + wall short-circuit to a base variant — never carry edges (wall is
  // intentional scope cut, see tile-sheet.ts comment on row 3).
  if (center === 'water' || center === 'wall') {
    const bin = BINS.get(binKey(center, 0));
    if (!bin) {
      // No base variant exists for this class — should never happen with the
      // current sheet, but the loop type-checker doesn't know that.
      return TILE_SLOTS[0].id;
    }
    return pickFromBin(bin, hash).id;
  }

  // Land — compute mask, look up exact, fall back to nearest, then to base.
  const mask = computeEdgeMask(tiles, cellX, cellY, width, height);
  if (mask === 0) {
    const bin = BINS.get(binKey(center, 0));
    if (!bin) return TILE_SLOTS[0].id;
    return pickFromBin(bin, hash).id;
  }
  const exactBin = BINS.get(binKey(center, mask));
  if (exactBin) return pickFromBin(exactBin, hash).id;
  const nearest = nearestSupportedMask(center, mask);
  if (nearest !== null) {
    const bin = BINS.get(binKey(center, nearest));
    if (bin) return pickFromBin(bin, hash).id;
  }
  // Final fallback — base of centre class.
  const baseBin = BINS.get(binKey(center, 0));
  if (baseBin) return pickFromBin(baseBin, hash).id;
  return TILE_SLOTS[0].id;
}
