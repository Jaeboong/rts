import { CELL, type Entity, type EntityId } from '../../types';
import type { World } from '../world';

// Bucket size in pixels. 4×CELL = 64px chosen as a balance:
//   - Small enough that high-density combat (50+ units in a brawl) splits into
//     a few buckets rather than one mega-bucket that defeats the point of indexing.
//   - Large enough that buildings (≤5 cells = 80px wide) overlap only ~2-4
//     buckets, keeping insert cost low. CC at 5×5 cells overlaps ~4 buckets.
//   - Marine sightRange = 15*CELL = 240px, so a sight query touches ~5×5=25
//     buckets. Fewer than 1/4 of expected entities → ~10× narrowing vs full scan.
export const BUCKET_PX = 4 * CELL;

// Storage: bucketKey → array of entity ids. Map keys are integer-encoded as
// `bucketY * STRIDE + bucketX` so we don't pay string-hash cost per insert.
// STRIDE must exceed any plausible bucket-x; world is GRID_W * CELL = 2048px
// today and Phase 46 quadruples to 4096px → 64 buckets. STRIDE 4096 fits both.
const STRIDE = 4096;

export interface SpatialGrid {
  // Cleared and rebuilt each tick; never persists beyond one rebuild cycle.
  buckets: Map<number, EntityId[]>;
  // Empty hint so consumers can detect "never built" / "freshly cleared" state
  // without iterating buckets. True between createSpatialGrid() and the first
  // rebuildSpatialGrid() call, AND any time clearSpatialGrid() runs.
  empty: boolean;
}

export function createSpatialGrid(): SpatialGrid {
  return { buckets: new Map(), empty: true };
}

function bucketKey(bx: number, by: number): number {
  return by * STRIDE + bx;
}

function pxToBucket(px: number): number {
  return Math.floor(px / BUCKET_PX);
}

function clearSpatialGrid(grid: SpatialGrid): void {
  grid.buckets.clear();
  grid.empty = true;
}

function insertIntoBuckets(
  grid: SpatialGrid,
  id: EntityId,
  left: number,
  top: number,
  right: number,
  bottom: number,
): void {
  // Inclusive bucket range covering the entity's AABB. A 1-cell unit at
  // bucket-edge can straddle 2 buckets along x or y; broad-phase must include
  // both, otherwise a marine 1px on the wrong side of the boundary is invisible.
  const bx0 = pxToBucket(left);
  const by0 = pxToBucket(top);
  const bx1 = pxToBucket(right);
  const by1 = pxToBucket(bottom);
  for (let by = by0; by <= by1; by++) {
    for (let bx = bx0; bx <= bx1; bx++) {
      const key = bucketKey(bx, by);
      let arr = grid.buckets.get(key);
      if (!arr) {
        arr = [];
        grid.buckets.set(key, arr);
      }
      arr.push(id);
    }
  }
}

// Compute entity AABB in pixels. Buildings/resources have explicit cell
// footprint; units use pos ± radius. Mirrors combat.ts entityRect() shape so
// the broad-phase is consistent with the narrow-phase distance check.
function entityAabb(e: Entity): { left: number; top: number; right: number; bottom: number } {
  if (
    e.cellX !== undefined &&
    e.cellY !== undefined &&
    e.sizeW !== undefined &&
    e.sizeH !== undefined
  ) {
    return {
      left: e.cellX * CELL,
      top: e.cellY * CELL,
      right: (e.cellX + e.sizeW) * CELL,
      bottom: (e.cellY + e.sizeH) * CELL,
    };
  }
  const r = e.radius ?? 0;
  return {
    left: e.pos.x - r,
    top: e.pos.y - r,
    right: e.pos.x + r,
    bottom: e.pos.y + r,
  };
}

export function rebuildSpatialGrid(world: World): void {
  const grid = world.spatialGrid;
  clearSpatialGrid(grid);
  for (const e of world.entities.values()) {
    if (e.dead) continue;
    const aabb = entityAabb(e);
    insertIntoBuckets(grid, e.id, aabb.left, aabb.top, aabb.right, aabb.bottom);
  }
  grid.empty = world.entities.size === 0;
}

// Lazy entry-point for read-only queries (hasHostileInAttackRange) called many
// times per tick from driveCommands. We can't afford a full rebuild per call,
// so we trust the grid is fresh unless it's empty (never built / fresh clear).
// Mutating systems (combatSystem, runCollisionSystem) rebuild unconditionally
// on entry instead.
export function ensureSpatialGrid(world: World): void {
  if (world.spatialGrid.empty && world.entities.size > 0) {
    rebuildSpatialGrid(world);
  }
}

// Broad-phase circle query: returns ids of entities in any bucket overlapping
// the (cx,cy,radius) circle. Caller MUST do its own narrow-phase distance
// check — bucket overlap means "possibly close", not "actually within radius".
//
// The output array may contain duplicates: an entity inserted into multiple
// buckets (a building) shows up once per bucket the query touches. Caller is
// expected to dedupe (e.g., track seen ids in a Set) OR tolerate harmless
// double-checks (combat's narrow-phase check is idempotent on dist & best-id).
export function queryRadius(
  grid: SpatialGrid,
  cx: number,
  cy: number,
  radius: number,
  out: EntityId[],
): void {
  out.length = 0;
  // Clamp lookup to the AABB of the circle, then visit buckets that AABB
  // overlaps. Cheaper than per-bucket circle-vs-rect check; over-fetch is
  // bounded (the circle's AABB is ≤ 4× its area).
  const bx0 = pxToBucket(cx - radius);
  const by0 = pxToBucket(cy - radius);
  const bx1 = pxToBucket(cx + radius);
  const by1 = pxToBucket(cy + radius);
  for (let by = by0; by <= by1; by++) {
    for (let bx = bx0; bx <= bx1; bx++) {
      const key = bucketKey(bx, by);
      const arr = grid.buckets.get(key);
      if (!arr) continue;
      for (const id of arr) out.push(id);
    }
  }
}

