import { CELL, GRID_H, GRID_W, type Vec2 } from '../types';
import { cellIndex, inBounds, isCellBlocked, type World } from './world';

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
  const gScore = new Float32Array(total);
  const fScore = new Float32Array(total);
  const cameFrom = new Int32Array(total);
  const visited = new Uint8Array(total);
  gScore.fill(Infinity);
  fScore.fill(Infinity);
  cameFrom.fill(-1);

  const startIdx = cellIndex(fromCellX, fromCellY);
  const goalIdx = cellIndex(toCellX, toCellY);

  gScore[startIdx] = 0;
  fScore[startIdx] = heuristic(fromCellX, fromCellY, toCellX, toCellY);

  const open = new BinaryHeap();
  open.push(startIdx, fScore[startIdx]);

  while (open.size() > 0) {
    const current = open.pop();
    if (current === goalIdx) {
      return reconstruct(cameFrom, current, fromCellX, fromCellY);
    }
    if (visited[current]) continue;
    visited[current] = 1;

    const cx = current % GRID_W;
    const cy = Math.floor(current / GRID_W);

    for (const [dx, dy, w] of NEIGHBORS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inBounds(nx, ny)) continue;
      const nIdx = cellIndex(nx, ny);
      const blocked = isCellBlocked(world, nx, ny);
      if (blocked) {
        const occ = world.occupancy[nIdx];
        // Allow stepping into ignoreId's cell, or the goal cell even if blocked.
        if (occ !== ignoreId && nIdx !== goalIdx) continue;
      }
      // Diagonal: don't cut corners.
      if (dx !== 0 && dy !== 0) {
        if (
          isCellBlocked(world, cx + dx, cy) ||
          isCellBlocked(world, cx, cy + dy)
        ) {
          continue;
        }
      }
      const tentative = gScore[current] + w;
      if (tentative < gScore[nIdx]) {
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
