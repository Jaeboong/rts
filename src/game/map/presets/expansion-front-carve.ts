// Procedural carving helpers for the Expansion Front preset (Phase 46).
// Mirrors western-front-carve.ts in shape but with W=H=256 and adds
// carveChokepoint — used to wall off natural / third entrances.
//
// WHY duplicate vs. parameterize: western-front-carve.ts hardcodes W/H as
// module-level constants consumed by every helper (idx, inBounds, splatWater,
// reachable). Threading a size argument through every helper would expand the
// API surface in another active phase's territory; duplication keeps both
// presets independently mutable.

import type { TileKind } from '../types';

export const W = 256;
export const H = 256;

// Seed-driven xorshift32 — small, fast, deterministic, no dependency. Wrapped
// in a closure so each generator call gets isolated state.
export interface Rng {
  next(): number;
  range(n: number): number;
  pick<T>(arr: readonly T[]): T;
  jitter(span: number): number;
}

export function makeRng(seed: number): Rng {
  let s = seed >>> 0;
  if (s === 0) s = 0x9e3779b9;
  function next(): number {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return s >>> 0;
  }
  return {
    next,
    range: (n) => next() % n,
    pick: (arr) => {
      const a = arr as readonly unknown[];
      return a[next() % a.length] as never;
    },
    jitter: (span) => (next() % (2 * span + 1)) - span,
  };
}

export const GRASS_KINDS = ['grass-1', 'grass-2', 'grass-3', 'grass-4', 'grass-5'] as const;
export const DIRT_KINDS = ['dirt-1', 'dirt-2', 'dirt-3', 'dirt-4', 'dirt-5'] as const;
export const WALL_KINDS = ['wall-1', 'wall-2', 'wall-3', 'wall-4', 'wall-5'] as const;
export const PROP_KINDS = [
  'prop-rocks',
  'prop-bush',
  'prop-tree',
  'prop-fire',
  'prop-well',
] as const;
export const WATER_KINDS = ['water-1', 'water-2', 'water-3', 'water-4'] as const;

export const CC_SIZE = 20;
export const RESOURCE_SIZE = 5;

export function inBounds(cx: number, cy: number): boolean {
  return cx >= 0 && cy >= 0 && cx < W && cy < H;
}

export function idx(cx: number, cy: number): number {
  return cy * W + cx;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function isWater(t: TileKind): boolean {
  return t === 'water-1' || t === 'water-2' || t === 'water-3' || t === 'water-4';
}

export function isWall(t: TileKind): boolean {
  return (
    t === 'wall-1' || t === 'wall-2' || t === 'wall-3' || t === 'wall-4' || t === 'wall-5'
  );
}

export function isBlocking(t: TileKind): boolean {
  return isWater(t) || isWall(t);
}

export interface CellPoint { cx: number; cy: number; }

// --- Step A: tile baseline ---------------------------------------------------

export function fillGrass(tiles: TileKind[], rng: Rng): void {
  for (let i = 0; i < W * H; i++) tiles[i] = rng.pick(GRASS_KINDS);
}

// --- Step B: water carving ---------------------------------------------------

// Diagonal NW->SE river. With W=256 we run twice as many steps as the
// western-front version (which used 220 steps for 128²) — same per-cell
// density. Splatting (vs. line-drawing) gives the river an organic,
// variable-width shape.
export function carveRiver(tiles: TileKind[], rng: Rng): void {
  let x = 8 + rng.jitter(4);
  let y = 8 + rng.jitter(4);
  let dx = 1;
  let dy = 1;
  const maxSteps = 440;

  for (let step = 0; step < maxSteps && inBounds(x, y); step++) {
    const radius = 1 + (rng.range(3) === 0 ? 1 : 0);
    splatWater(tiles, x, y, radius, rng);

    if (rng.range(35) === 0) {
      splatWater(tiles, x + rng.jitter(4), y + rng.jitter(4), 2, rng);
    }

    if (rng.range(15) === 0) {
      dx = x < W * 0.7 ? 1 : 0;
      dy = y < H * 0.7 ? 1 : 0;
    }
    if (rng.range(3) === 0) dx = clamp(dx + (rng.range(2) === 0 ? -1 : 1), -1, 1);
    if (rng.range(3) === 0) dy = clamp(dy + (rng.range(2) === 0 ? -1 : 1), -1, 1);
    if (dx === 0 && dy === 0) dx = 1;
    x += dx;
    y += dy;
  }
}

function splatWater(tiles: TileKind[], cx: number, cy: number, radius: number, rng: Rng): void {
  const r2 = radius * radius;
  for (let oy = -radius; oy <= radius; oy++) {
    for (let ox = -radius; ox <= radius; ox++) {
      if (ox * ox + oy * oy > r2) continue;
      const nx = cx + ox;
      const ny = cy + oy;
      if (!inBounds(nx, ny)) continue;
      tiles[idx(nx, ny)] = rng.pick(WATER_KINDS);
    }
  }
}

// --- Step C: roads (Bresenham + jitter) -------------------------------------

export function carveRoad(tiles: TileKind[], from: CellPoint, to: CellPoint, rng: Rng): void {
  let x0 = from.cx;
  let y0 = from.cy;
  const x1 = to.cx;
  const y1 = to.cy;
  const dxa = Math.abs(x1 - x0);
  const dya = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dxa - dya;
  let stepCount = 0;
  let jx = 0;
  let jy = 0;
  while (true) {
    const w = 1 + rng.range(2);
    paintDirtDisk(tiles, x0 + jx, y0 + jy, w, rng);

    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dya) {
      err -= dya;
      x0 += sx;
    }
    if (e2 < dxa) {
      err += dxa;
      y0 += sy;
    }

    if (++stepCount % 6 === 0) {
      jx = clamp(jx + rng.jitter(1), -3, 3);
      jy = clamp(jy + rng.jitter(1), -3, 3);
    }
  }
}

function paintDirtDisk(tiles: TileKind[], cx: number, cy: number, radius: number, rng: Rng): void {
  const r2 = radius * radius;
  for (let oy = -radius; oy <= radius; oy++) {
    for (let ox = -radius; ox <= radius; ox++) {
      if (ox * ox + oy * oy > r2) continue;
      const nx = cx + ox;
      const ny = cy + oy;
      if (!inBounds(nx, ny)) continue;
      tiles[idx(nx, ny)] = rng.pick(DIRT_KINDS);
    }
  }
}

// --- Step D: chokepoints (wall barrier WITH a corridor gap) -----------------

// Lay down a perpendicular wall ridge across the line `from`→`to`, leaving a
// gap of `gapCells` cells of non-wall tile. WHY: walls are walkable:false
// (TILE_DEFS), so a continuous wall stripe would cut the map. The gap is the
// chokepoint corridor units must traverse.
//
// `from`/`to` define the corridor centerline (typically natural↔main entrance).
// We place the wall at the midpoint, perpendicular to the centerline, with
// total length `wallLength`. The middle `gapCells` of the wall remain dirt
// (cleared) so the road through the choke stays open.
//
// Wall thickness: `wallThickness` cells along the corridor direction. Single
// 1-cell-thick walls don't actually constrain movement when the road has been
// carved as a 2-3 cell wide swath — units would just step around. Default
// thickness 3 ensures the wall fully blocks any width-≤3 road.
export function carveChokepoint(
  tiles: TileKind[],
  from: CellPoint,
  to: CellPoint,
  gapCells: number,
  rng: Rng,
  wallLength: number = 14,
  wallThickness: number = 3,
): void {
  const midX = Math.round((from.cx + to.cx) / 2);
  const midY = Math.round((from.cy + to.cy) / 2);
  // Vector from→to is (dx,dy). Corridor direction = normalized (dx,dy).
  // Wall ridge runs perpendicular to corridor.
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  const len = Math.hypot(dx, dy) || 1;
  const cdx = dx / len; // corridor unit vector x
  const cdy = dy / len;
  const px = -cdy;      // perpendicular unit vector x
  const py = cdx;

  const half = Math.floor(wallLength / 2);
  const gapHalf = Math.floor(gapCells / 2);
  const thickHalf = Math.floor(wallThickness / 2);

  // Paint the wall ridge: at each `t` along the perpendicular, lay walls
  // `wallThickness` cells deep along the corridor direction. Skip the gap
  // band in the perpendicular dimension.
  for (let t = -half; t <= half; t++) {
    if (Math.abs(t) <= gapHalf) continue; // gap — handled below
    for (let k = -thickHalf; k <= thickHalf; k++) {
      const cx = clamp(Math.round(midX + px * t + cdx * k), 0, W - 1);
      const cy = clamp(Math.round(midY + py * t + cdy * k), 0, H - 1);
      const i = idx(cx, cy);
      // Don't overwrite water — river is already a barrier and walls-on-water look wrong.
      if (isWater(tiles[i])) continue;
      tiles[i] = rng.pick(WALL_KINDS);
    }
  }

  // Clear the gap region: any cell within gapHalf perpendicularly AND within
  // thickHalf along corridor must be non-wall non-water. Paint as dirt so
  // the corridor is visible.
  for (let t = -gapHalf; t <= gapHalf; t++) {
    for (let k = -thickHalf - 1; k <= thickHalf + 1; k++) {
      const cx = clamp(Math.round(midX + px * t + cdx * k), 0, W - 1);
      const cy = clamp(Math.round(midY + py * t + cdy * k), 0, H - 1);
      const i = idx(cx, cy);
      if (isWall(tiles[i])) tiles[i] = rng.pick(DIRT_KINDS);
    }
  }

  // Reinforce: paint a dirt disk through the gap so a stray prop or two doesn't
  // accidentally re-block the corridor.
  paintDirtDisk(tiles, midX, midY, Math.max(1, gapHalf), rng);
}

// Measure the actual chokepoint corridor width at a given midpoint. The
// function scans BOTH perpendicular to axisDir (the gap direction) AND along
// axisDir (the corridor direction) within a small window, returning the
// minimum perpendicular width found across the wall thickness. This captures
// the narrowest squeeze a unit must pass through.
//
// Returns: count of consecutive non-blocking cells along the perpendicular at
// the row that's most constrained by walls. Used by tests to assert
// chokepoint widths match the spec (natural 3-5, third 5-8).
export function measureCorridorWidth(
  tiles: readonly TileKind[],
  mx: number,
  my: number,
  axisDir: { dx: number; dy: number },
  scanThickness: number = 5,
  maxPerpScan: number = 30,
): number {
  const len = Math.hypot(axisDir.dx, axisDir.dy) || 1;
  const cdx = axisDir.dx / len;
  const cdy = axisDir.dy / len;
  const px = -cdy;
  const py = cdx;

  let minWidth = Infinity;
  // For each row along the corridor direction, count perpendicular non-blocking width.
  for (let k = -scanThickness; k <= scanThickness; k++) {
    let width = 0;
    // +perpendicular direction from row center
    for (let t = 0; t <= maxPerpScan; t++) {
      const cx = Math.round(mx + cdx * k + px * t);
      const cy = Math.round(my + cdy * k + py * t);
      if (!inBounds(cx, cy)) break;
      if (isBlocking(tiles[idx(cx, cy)])) break;
      width++;
    }
    // -perpendicular direction (skip t=0 to avoid double count)
    for (let t = 1; t <= maxPerpScan; t++) {
      const cx = Math.round(mx + cdx * k - px * t);
      const cy = Math.round(my + cdy * k - py * t);
      if (!inBounds(cx, cy)) break;
      if (isBlocking(tiles[idx(cx, cy)])) break;
      width++;
    }
    if (width < minWidth) minWidth = width;
  }
  return minWidth === Infinity ? 0 : minWidth;
}

// --- Step E: walls (decorative scatter near each base) -----------------------

export function scatterWalls(
  tiles: TileKind[],
  anchor: { cellX: number; cellY: number },
  rng: Rng,
): void {
  const count = 5 + rng.range(4);
  const ax = anchor.cellX + Math.floor(CC_SIZE / 2);
  const ay = anchor.cellY + Math.floor(CC_SIZE / 2);
  for (let i = 0; i < count; i++) {
    const angle = (rng.next() / 0xffffffff) * Math.PI * 2;
    const dist = 6 + rng.range(5);
    const wx = clamp(Math.round(ax + Math.cos(angle) * dist), 0, W - 1);
    const wy = clamp(Math.round(ay + Math.sin(angle) * dist), 0, H - 1);
    if (isWater(tiles[idx(wx, wy)])) continue;
    tiles[idx(wx, wy)] = rng.pick(WALL_KINDS);
  }
}

// --- Step F: props -----------------------------------------------------------

export function scatterProps(
  tiles: TileKind[],
  anchors: ReadonlyArray<{ cellX: number; cellY: number }>,
  rng: Rng,
): void {
  // 1% global density (same as western-front; cell count scales naturally).
  const totalCells = W * H;
  const globalCount = Math.floor(totalCells * 0.01);
  for (let i = 0; i < globalCount; i++) {
    const x = rng.range(W);
    const y = rng.range(H);
    if (isWater(tiles[idx(x, y)])) continue;
    if (isWall(tiles[idx(x, y)])) continue;
    tiles[idx(x, y)] = rng.pick(PROP_KINDS);
  }
  for (const a of anchors) {
    const ax = a.cellX + Math.floor(CC_SIZE / 2);
    const ay = a.cellY + Math.floor(CC_SIZE / 2);
    const localCount = 18 + rng.range(8);
    for (let i = 0; i < localCount; i++) {
      const dx = rng.jitter(8);
      const dy = rng.jitter(8);
      const x = clamp(ax + dx, 0, W - 1);
      const y = clamp(ay + dy, 0, H - 1);
      if (isWater(tiles[idx(x, y)])) continue;
      if (isWall(tiles[idx(x, y)])) continue;
      tiles[idx(x, y)] = rng.pick(PROP_KINDS);
    }
  }
}

// --- BFS reachability -------------------------------------------------------

// Treats both water AND wall as blocking — matches isCellBlocked semantics so
// the test's connectivity check mirrors actual unit movement.
export function reachable(
  tiles: readonly TileKind[],
  from: CellPoint,
  to: CellPoint,
): boolean {
  const visited = new Uint8Array(W * H);
  const q: number[] = [];
  q.push(idx(from.cx, from.cy));
  visited[idx(from.cx, from.cy)] = 1;
  const target = idx(to.cx, to.cy);
  while (q.length > 0) {
    const cur = q.shift();
    if (cur === undefined) break;
    if (cur === target) return true;
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
      if (!inBounds(nx, ny)) continue;
      const ni = idx(nx, ny);
      if (visited[ni]) continue;
      if (isBlocking(tiles[ni])) continue;
      visited[ni] = 1;
      q.push(ni);
    }
  }
  return false;
}
