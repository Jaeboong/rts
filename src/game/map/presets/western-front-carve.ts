// Procedural carving helpers for the Western Front preset. Pure mutators on the
// flat tile array — separated from western-front.ts to keep that file under the
// 500-line cap. WHY-only comments throughout.

import type { TileKind } from '../types';

export const W = 128;
export const H = 128;

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

export interface CellPoint { cx: number; cy: number; }

// --- Step A: tile baseline ---------------------------------------------------

export function fillGrass(tiles: TileKind[], rng: Rng): void {
  for (let i = 0; i < W * H; i++) tiles[i] = rng.pick(GRASS_KINDS);
}

// --- Step B: water carving ---------------------------------------------------

// Random sinuous path NW->SE: jitter direction at each step, splat tiles in a
// disk of variable radius. Splatting (vs. line-drawing) gives the river an
// organic, variable-width shape.
export function carveRiver(tiles: TileKind[], rng: Rng): void {
  let x = 5 + rng.jitter(3);
  let y = 5 + rng.jitter(3);
  let dx = 1;
  let dy = 1;
  const maxSteps = 220; // enough to traverse the diagonal with kinks

  for (let step = 0; step < maxSteps && inBounds(x, y); step++) {
    const radius = 1 + (rng.range(3) === 0 ? 1 : 0);
    splatWater(tiles, x, y, radius, rng);

    // Occasionally branch a small lake.
    if (rng.range(35) === 0) {
      splatWater(tiles, x + rng.jitter(4), y + rng.jitter(4), 2, rng);
    }

    // Occasionally rebias toward the diagonal so the river doesn't drift off.
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

// --- Step C: roads (Bresenham + jitter; overwrites tiles incl. water = bridge) -

export function carveRoad(tiles: TileKind[], from: CellPoint, to: CellPoint, rng: Rng): void {
  // Width-2..3 path with ±1-cell jitter every few steps. Keeps Bresenham's
  // straight feel but adds organic deviation.
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

// --- Step D: walls (decorative scatter near each base) -----------------------

export function scatterWalls(
  tiles: TileKind[],
  anchor: { cellX: number; cellY: number },
  rng: Rng,
): void {
  const count = 5 + rng.range(4); // 5..8
  const ax = anchor.cellX + Math.floor(CC_SIZE / 2);
  const ay = anchor.cellY + Math.floor(CC_SIZE / 2);
  for (let i = 0; i < count; i++) {
    const angle = (rng.next() / 0xffffffff) * Math.PI * 2;
    const dist = 6 + rng.range(5); // 6..10
    const wx = clamp(Math.round(ax + Math.cos(angle) * dist), 0, W - 1);
    const wy = clamp(Math.round(ay + Math.sin(angle) * dist), 0, H - 1);
    if (isWater(tiles[idx(wx, wy)])) continue;
    tiles[idx(wx, wy)] = rng.pick(WALL_KINDS);
  }
}

// --- Step E: props -----------------------------------------------------------

export function scatterProps(
  tiles: TileKind[],
  anchors: ReadonlyArray<{ cellX: number; cellY: number }>,
  rng: Rng,
): void {
  // 1% global density.
  const totalCells = W * H;
  const globalCount = Math.floor(totalCells * 0.01);
  for (let i = 0; i < globalCount; i++) {
    const x = rng.range(W);
    const y = rng.range(H);
    if (isWater(tiles[idx(x, y)])) continue;
    tiles[idx(x, y)] = rng.pick(PROP_KINDS);
  }
  for (const a of anchors) {
    const ax = a.cellX + Math.floor(CC_SIZE / 2);
    const ay = a.cellY + Math.floor(CC_SIZE / 2);
    const localCount = 18 + rng.range(8); // 18..25
    for (let i = 0; i < localCount; i++) {
      const dx = rng.jitter(8);
      const dy = rng.jitter(8);
      const x = clamp(ax + dx, 0, W - 1);
      const y = clamp(ay + dy, 0, H - 1);
      if (isWater(tiles[idx(x, y)])) continue;
      tiles[idx(x, y)] = rng.pick(PROP_KINDS);
    }
  }
}

// --- BFS reachability -------------------------------------------------------

export function reachable(tiles: TileKind[], from: CellPoint, to: CellPoint): boolean {
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
      if (isWater(tiles[ni])) continue;
      visited[ni] = 1;
      q.push(ni);
    }
  }
  return false;
}
