import { GRID_W, type Entity } from '../types';
import { BUILDING_DEFS } from './balance';
import { inBounds, type World } from './world';

/**
 * Returns an unclaimed geyser whose 5×5 footprint covers (cx, cy), or null.
 */
export function unclaimedGeyserAt(
  world: World,
  cx: number,
  cy: number,
): Entity | null {
  for (const e of world.entities.values()) {
    if (e.kind !== 'gasGeyser') continue;
    if (e.refineryId !== null && e.refineryId !== undefined) continue;
    if (e.cellX === undefined || e.cellY === undefined) continue;
    if (
      cx >= e.cellX &&
      cx < e.cellX + (e.sizeW ?? 0) &&
      cy >= e.cellY &&
      cy < e.cellY + (e.sizeH ?? 0)
    ) {
      return e;
    }
  }
  return null;
}

/**
 * Refinery valid: every cell of its 5×5 footprint (TL aligned with the geyser)
 * is either the geyser itself or unblocked.
 */
export function canPlaceRefinery(
  world: World,
  cellX: number,
  cellY: number,
  geyserId: number,
): boolean {
  const def = BUILDING_DEFS.refinery;
  for (let y = cellY; y < cellY + def.h; y++) {
    for (let x = cellX; x < cellX + def.w; x++) {
      if (!inBounds(x, y)) return false;
      const occ = world.occupancy[y * GRID_W + x];
      if (occ === -1) continue;
      if (occ === geyserId) continue;
      return false;
    }
  }
  return true;
}

/**
 * Returns an unclaimed mineralNode whose 5×5 footprint covers (cx, cy), or null.
 */
export function unclaimedMineralNodeAt(
  world: World,
  cx: number,
  cy: number,
): Entity | null {
  for (const e of world.entities.values()) {
    if (e.kind !== 'mineralNode') continue;
    if (e.depotId !== null && e.depotId !== undefined) continue;
    if (e.cellX === undefined || e.cellY === undefined) continue;
    if (
      cx >= e.cellX &&
      cx < e.cellX + (e.sizeW ?? 0) &&
      cy >= e.cellY &&
      cy < e.cellY + (e.sizeH ?? 0)
    ) {
      return e;
    }
  }
  return null;
}

/**
 * SupplyDepot valid: every cell of its 5×5 footprint (TL aligned with the node)
 * is either the mineralNode itself or unblocked. Mirrors canPlaceRefinery.
 */
export function canPlaceSupplyDepot(
  world: World,
  cellX: number,
  cellY: number,
  mineralNodeId: number,
): boolean {
  const def = BUILDING_DEFS.supplyDepot;
  for (let y = cellY; y < cellY + def.h; y++) {
    for (let x = cellX; x < cellX + def.w; x++) {
      if (!inBounds(x, y)) return false;
      const occ = world.occupancy[y * GRID_W + x];
      if (occ === -1) continue;
      if (occ === mineralNodeId) continue;
      return false;
    }
  }
  return true;
}
