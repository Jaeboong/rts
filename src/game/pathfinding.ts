import { CELL, GRID_H, GRID_W, type Vec2 } from '../types';
import { cellIndex, inBounds, isCellBlocked, isTileBlocked, type World } from './world';

export interface PathReq {
  fromCell: { x: number; y: number };
  toCell: { x: number; y: number };
}

const NEIGHBORS: Array<[number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

// Module-scope pooled buffers for A*. JS is single-threaded and findPath does
// not recurse / yield mid-call, so reuse is safe. Lazy-allocate on first use
// AND on grid-size change (Phase 46 quadruples GRID_W*GRID_H, and tests can
// also call findPath before any actual ticks). 256² grid → ~1MB per call
// without pooling; reuse drops that to a fixed 1MB resident.
//
// Generation-counter reset: rather than .fill()-ing all four buffers on each
// call (~262k writes at 256²), we stamp a u32 `generation` per visited cell.
// A cell's gScore/fScore/cameFrom/visited are only valid when
// gens[i] === currentGen; otherwise they're treated as Infinity / -1 / 0.
// Fresh `Uint32Array` is zero-initialized, so any non-zero `currentGen` makes
// every cell read as "stale" without an explicit clear. Overflow at 2^32
// generations is years of solid play; ignore.
let poolGScore: Float32Array | null = null;
let poolFScore: Float32Array | null = null;
let poolCameFrom: Int32Array | null = null;
let poolVisited: Uint8Array | null = null;
let poolGens: Uint32Array | null = null;
let currentGen = 0;

function ensureBuffers(total: number): {
  gScore: Float32Array;
  fScore: Float32Array;
  cameFrom: Int32Array;
  visited: Uint8Array;
  gens: Uint32Array;
} {
  if (!poolGScore || poolGScore.length !== total) {
    poolGScore = new Float32Array(total);
    poolFScore = new Float32Array(total);
    poolCameFrom = new Int32Array(total);
    poolVisited = new Uint8Array(total);
    poolGens = new Uint32Array(total);
    // currentGen is intentionally NOT reset on realloc: a fresh gens array is
    // all 0, and currentGen will be ≥ 1 after the first findPath call below
    // (or already >0 here on re-alloc), so every cell reads as stale anyway.
  }
  return {
    gScore: poolGScore,
    fScore: poolFScore!,
    cameFrom: poolCameFrom!,
    visited: poolVisited!,
    gens: poolGens!,
  };
}

/**
 * A* on the grid. Returns waypoints in pixel coords (cell centers), excluding
 * the start cell and including the goal. Returns null if no path.
 *
 * `ignoreId`: an entity id whose occupancy is treated as walkable (so a unit
 * trying to reach a building that is itself the destination, or assist a
 * construction site, is not blocked by that target).
 */
export function findPath(
  world: World,
  fromCellX: number,
  fromCellY: number,
  toCellX: number,
  toCellY: number,
  ignoreId: number = -1,
): Vec2[] | null {
  if (!inBounds(toCellX, toCellY)) return null;

  if (fromCellX === toCellX && fromCellY === toCellY) return [];

  const total = GRID_W * GRID_H;
  const buffers = ensureBuffers(total);
  const { gScore, fScore, cameFrom, visited, gens } = buffers;
  // Bump generation instead of .fill()-ing all 4 buffers (~262k writes at
  // 256²). Any cell where gens[i] !== gen is implicitly "fresh" — its stored
  // gScore/fScore/cameFrom/visited values are stale and must be ignored.
  currentGen++;
  const gen = currentGen;

  const startIdx = cellIndex(fromCellX, fromCellY);
  const goalIdx = cellIndex(toCellX, toCellY);

  gens[startIdx] = gen;
  gScore[startIdx] = 0;
  fScore[startIdx] = heuristic(fromCellX, fromCellY, toCellX, toCellY);
  visited[startIdx] = 0;
  cameFrom[startIdx] = -1;

  const open = new BinaryHeap();
  open.push(startIdx, fScore[startIdx]);

  while (open.size() > 0) {
    const current = open.pop();
    if (current === goalIdx) {
      return reconstruct(cameFrom, gens, gen, current, fromCellX, fromCellY);
    }
    // visited bit only meaningful when stamped this generation; otherwise
    // treat as unvisited (stale value from a prior search).
    if (gens[current] === gen && visited[current]) continue;
    gens[current] = gen;
    visited[current] = 1;

    const cx = current % GRID_W;
    const cy = Math.floor(current / GRID_W);
    const currentG = gScore[current];

    for (const [dx, dy, w] of NEIGHBORS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inBounds(nx, ny)) continue;
      const nIdx = cellIndex(nx, ny);
      // Tile-level blockers (water, walls/hills) are absolute — no goal-cell
      // exception. Otherwise units could be commanded into water by clicking
      // there since the goal cell would bypass the block check.
      if (isTileBlocked(world, nx, ny)) continue;
      const occ = world.occupancy[nIdx];
      // Occupancy blockers (buildings, minerals) get the goal/ignore exception
      // so attacks can target a building's cell directly.
      if (occ !== -1 && occ !== ignoreId && nIdx !== goalIdx) continue;
      // Diagonal: don't cut corners.
      if (dx !== 0 && dy !== 0) {
        if (
          isCellBlocked(world, cx + dx, cy) ||
          isCellBlocked(world, cx, cy + dy)
        ) {
          continue;
        }
      }
      const tentative = currentG + w;
      // Existing gScore[nIdx] only valid if stamped this gen; otherwise treat
      // as Infinity so the first visit always writes through.
      const existingG =
        gens[nIdx] === gen ? gScore[nIdx] : Number.POSITIVE_INFINITY;
      if (tentative < existingG) {
        // Stamp gen + clear stale visited bit so this neighbor is poppable
        // even if it carried visited=1 from a prior search.
        gens[nIdx] = gen;
        visited[nIdx] = 0;
        cameFrom[nIdx] = current;
        gScore[nIdx] = tentative;
        const f = tentative + heuristic(nx, ny, toCellX, toCellY);
        fScore[nIdx] = f;
        open.push(nIdx, f);
      }
    }
  }
  return null;
}

function heuristic(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return Math.SQRT2 * Math.min(dx, dy) + Math.abs(dx - dy);
}

function reconstruct(
  cameFrom: Int32Array,
  gens: Uint32Array,
  gen: number,
  goal: number,
  fromCellX: number,
  fromCellY: number,
): Vec2[] {
  const path: Vec2[] = [];
  let cur = goal;
  while (cur !== -1) {
    const cx = cur % GRID_W;
    const cy = Math.floor(cur / GRID_W);
    if (cx === fromCellX && cy === fromCellY) break;
    path.push({ x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2 });
    // cameFrom[cur] only valid if stamped this gen; defensive — the search
    // only follows back-pointers it just wrote, so this should always hold.
    if (gens[cur] !== gen) break;
    cur = cameFrom[cur];
  }
  path.reverse();
  return path;
}

class BinaryHeap {
  private heap: number[] = [];
  private prio: number[] = [];

  size(): number {
    return this.heap.length;
  }

  push(value: number, priority: number): void {
    this.heap.push(value);
    this.prio.push(priority);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): number {
    const top = this.heap[0];
    const last = this.heap.pop()!;
    const lastP = this.prio.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.prio[0] = lastP;
      this.sinkDown(0);
    }
    return top;
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prio[i] < this.prio[parent]) {
        this.swap(i, parent);
        i = parent;
      } else break;
    }
  }

  private sinkDown(i: number): void {
    const n = this.heap.length;
    while (true) {
      const l = i * 2 + 1;
      const r = i * 2 + 2;
      let best = i;
      if (l < n && this.prio[l] < this.prio[best]) best = l;
      if (r < n && this.prio[r] < this.prio[best]) best = r;
      if (best === i) break;
      this.swap(i, best);
      i = best;
    }
  }

  private swap(a: number, b: number): void {
    const v = this.heap[a];
    const p = this.prio[a];
    this.heap[a] = this.heap[b];
    this.prio[a] = this.prio[b];
    this.heap[b] = v;
    this.prio[b] = p;
  }
}
