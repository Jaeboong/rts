import {
  CELL,
  GRID_H,
  GRID_W,
  type BuildingKind,
  type Entity,
  type EntityId,
  type Team,
  type Vec2,
} from '../types';
import { TILE_DEFS } from './map/tiles';
import type { TileKind } from './map/types';
import { createSpatialGrid, type SpatialGrid } from './systems/spatial-grid';

export interface World {
  tickCount: number;
  entities: Map<EntityId, Entity>;
  nextId: number;
  resources: Record<Team, number>;
  gas: Record<Team, number>;
  occupancy: Int32Array;
  // Per-cell tile kind (length = GRID_W * GRID_H). Default 'grass-1' on creation;
  // map presets overwrite via applyMap() at scene load. Read by pathfinding.
  tiles: TileKind[];
  selection: Set<EntityId>;
  placement: { team: Team; buildingKind: BuildingKind } | null;
  attackMode: boolean;
  // Broad-phase spatial index — rebuilt on demand by combat/collision systems.
  // See systems/spatial-grid.ts for invariants on freshness vs lazy fill.
  spatialGrid: SpatialGrid;
}

export function createWorld(): World {
  const occ = new Int32Array(GRID_W * GRID_H);
  occ.fill(-1);
  const tiles: TileKind[] = new Array(GRID_W * GRID_H);
  // Walkable default — preserves existing test semantics where empty grids
  // route freely; presets overwrite at load time.
  for (let i = 0; i < tiles.length; i++) tiles[i] = 'grass-1';
  return {
    tickCount: 0,
    entities: new Map(),
    nextId: 1,
    resources: { player: 500, enemy: 0, neutral: 0 },
    // Per-team gas. Enemy starts at 0 by design — they MUST build a refinery
    // before producing tank/medic (Phase 43: removes the previous gas waiver).
    gas: { player: 200, enemy: 0, neutral: 0 },
    occupancy: occ,
    tiles,
    selection: new Set(),
    placement: null,
    attackMode: false,
    spatialGrid: createSpatialGrid(),
  };
}

// Pure read of tile walkability — water tiles report blocked, all others walkable.
export function isTileBlocked(world: World, cx: number, cy: number): boolean {
  return !TILE_DEFS[world.tiles[cellIndex(cx, cy)]].walkable;
}

export function cellIndex(cx: number, cy: number): number {
  return cy * GRID_W + cx;
}

export function inBounds(cx: number, cy: number): boolean {
  return cx >= 0 && cy >= 0 && cx < GRID_W && cy < GRID_H;
}

export function isCellBlocked(world: World, cx: number, cy: number): boolean {
  if (!inBounds(cx, cy)) return true;
  if (world.occupancy[cellIndex(cx, cy)] !== -1) return true;
  return isTileBlocked(world, cx, cy);
}

export function setOccupancy(
  world: World,
  cx: number,
  cy: number,
  w: number,
  h: number,
  id: EntityId,
): void {
  for (let y = cy; y < cy + h; y++) {
    for (let x = cx; x < cx + w; x++) {
      if (inBounds(x, y)) world.occupancy[cellIndex(x, y)] = id;
    }
  }
}

export function clearOccupancy(
  world: World,
  cx: number,
  cy: number,
  w: number,
  h: number,
): void {
  for (let y = cy; y < cy + h; y++) {
    for (let x = cx; x < cx + w; x++) {
      if (inBounds(x, y)) world.occupancy[cellIndex(x, y)] = -1;
    }
  }
}

export function pxToCell(p: Vec2): { x: number; y: number } {
  return { x: Math.floor(p.x / CELL), y: Math.floor(p.y / CELL) };
}

export function cellToPx(cx: number, cy: number): Vec2 {
  return { x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2 };
}

export function addEntity(world: World, e: Omit<Entity, 'id'>): Entity {
  const ent: Entity = { ...e, id: world.nextId++ };
  world.entities.set(ent.id, ent);
  if (
    ent.cellX !== undefined &&
    ent.cellY !== undefined &&
    ent.sizeW &&
    ent.sizeH
  ) {
    setOccupancy(world, ent.cellX, ent.cellY, ent.sizeW, ent.sizeH, ent.id);
  }
  return ent;
}

export function removeEntity(world: World, id: EntityId): void {
  const e = world.entities.get(id);
  if (!e) return;
  if (
    e.cellX !== undefined &&
    e.cellY !== undefined &&
    e.sizeW &&
    e.sizeH
  ) {
    clearOccupancy(world, e.cellX, e.cellY, e.sizeW, e.sizeH);
  }
  world.entities.delete(id);
  world.selection.delete(id);
}

export function findEntitiesByTeam(world: World, team: Team): Entity[] {
  const out: Entity[] = [];
  for (const e of world.entities.values()) if (e.team === team) out.push(e);
  return out;
}

// Phase 53: in-place reset to createWorld() defaults — used when the user picks
// a custom map in the AI-selector modal. Mutates rather than reallocating so
// existing references (game.world, window.__world) stay valid; tiles/entities
// get repainted by the caller right after.
export function resetWorld(world: World): void {
  world.tickCount = 0;
  world.entities.clear();
  world.nextId = 1;
  world.resources.player = 500;
  world.resources.enemy = 0;
  world.resources.neutral = 0;
  world.gas.player = 200;
  world.gas.enemy = 0;
  world.gas.neutral = 0;
  world.occupancy.fill(-1);
  for (let i = 0; i < world.tiles.length; i++) world.tiles[i] = 'grass-1';
  world.selection.clear();
  world.placement = null;
  world.attackMode = false;
  world.spatialGrid = createSpatialGrid();
}
