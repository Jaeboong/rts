import { CELL, GRID_W, type BuildingKind, type Command, type Entity, type UnitKind, type Vec2 } from '../types';
import type { UIAction } from '../render/ui';
import {
  BUILDING_DEFS,
  canBuildingProduceUnits,
  UNIT_PRODUCTION,
  type ProductionDef,
} from './balance';
import { displaceUnitsFromFootprint } from './displacement';
import { spawnBuilding } from './entities';
import type { Game } from './loop';
import { pickEntityAt } from './selection';
import { cellToPx, inBounds, isCellBlocked, pxToCell, type World } from './world';

const CLAMP_SEARCH_RADIUS = 10;

export type ExtendedUIAction =
  | UIAction
  | { type: 'confirmPlacement'; x: number; y: number };

export function issueRightClick(
  game: Game,
  wx: number,
  wy: number,
  shift: boolean,
): void {
  const { world } = game;
  const target = pickEntityAt(world, wx, wy);

  for (const id of world.selection) {
    const e = world.entities.get(id);
    if (!e || e.team !== 'player') continue;

    if (isUnit(e)) {
      const cmd = chooseUnitCommand(world, e, target, wx, wy, shift);
      e.command = cmd;
      e.path = null;
      e.attackTargetId = null;
      // User-issued command overrides the tank attack-anim root, so a fresh
      // move beats the in-progress fire window.
      e.attackEffectMs = 0;
    } else if (isBuilding(e) && canBuildingProduceUnits(e.kind)) {
      e.rallyPoint = { x: wx, y: wy };
    }
  }
}

export function issueAttackModeClick(
  game: Game,
  wx: number,
  wy: number,
): void {
  const { world } = game;
  const target = pickEntityAt(world, wx, wy);
  const cmd = chooseAttackModeCommand(world, target, wx, wy);

  for (const id of world.selection) {
    const e = world.entities.get(id);
    if (!e || e.team !== 'player') continue;
    if (!isUnit(e)) continue;
    e.command = cmd;
    e.path = null;
    e.attackTargetId = null;
    e.attackEffectMs = 0;
  }
}

export function chooseAttackModeCommand(
  world: World,
  target: Entity | null,
  wx: number,
  wy: number,
): Command {
  if (target && isHostileTarget(target)) {
    return { type: 'attack', targetId: target.id };
  }
  return { type: 'attackMove', target: clampMoveTargetToWalkable(world, { x: wx, y: wy }) };
}

export function tryEnterAttackMode(world: World): boolean {
  if (world.placement) return false;
  if (world.selection.size === 0) return false;
  world.attackMode = true;
  return true;
}

export function exitAttackMode(world: World): void {
  world.attackMode = false;
}

function isHostileTarget(target: Entity): boolean {
  if (target.kind === 'mineralNode' || target.kind === 'gasGeyser') return false;
  return target.team === 'enemy';
}

export function issueUIAction(game: Game, action: ExtendedUIAction): void {
  const { world } = game;
  switch (action.type) {
    case 'produce': {
      const def = UNIT_PRODUCTION[action.unit];
      if (!def) return;
      const target = firstSelectedProducer(world, def);
      if (!target) return;
      enqueueProductionOn(world, target, action.unit);
      return;
    }
    case 'beginPlace': {
      world.placement = { team: 'player', buildingKind: action.building };
      world.attackMode = false;
      return;
    }
    case 'cancelPlacement': {
      world.placement = null;
      return;
    }
    case 'confirmPlacement': {
      if (!world.placement) return;
      const kind = world.placement.buildingKind;
      const def = BUILDING_DEFS[kind];
      const clickCellX = Math.floor(action.x / CELL);
      const clickCellY = Math.floor(action.y / CELL);

      let cellX: number;
      let cellY: number;
      let claimedGeyser: Entity | null = null;
      if (kind === 'refinery') {
        const geyser = unclaimedGeyserAt(world, clickCellX, clickCellY);
        if (!geyser) return;
        // Refinery 5×5 footprint snaps onto the geyser's 5×5 footprint exactly.
        cellX = geyser.cellX!;
        cellY = geyser.cellY!;
        if (!canPlaceRefinery(world, cellX, cellY, geyser.id)) return;
        claimedGeyser = geyser;
      } else {
        cellX = clickCellX - Math.floor(def.w / 2);
        cellY = clickCellY - Math.floor(def.h / 2);
        if (!canPlace(world, cellX, cellY, def.w, def.h)) return;
      }

      if (world.resources.player < def.cost) return;
      const gasCost = def.gasCost ?? 0;
      if (gasCost > 0 && world.gas < gasCost) return;
      const worker = firstSelectedWorker(world);
      if (!worker) return;
      world.resources.player -= def.cost;
      if (gasCost > 0) world.gas -= gasCost;
      const site = spawnBuilding(world, kind, 'player', cellX, cellY, false);
      if (claimedGeyser) claimedGeyser.refineryId = site.id;
      // Displace before assigning worker.command so a worker inside the footprint
      // is teleported out, then immediately given its build command.
      displaceUnitsFromFootprint(world, cellX, cellY, def.w, def.h);
      worker.command = { type: 'build', buildingId: site.id };
      worker.path = null;
      worker.attackTargetId = null;
      world.placement = null;
      return;
    }
  }
}

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

export function canPlace(
  world: World,
  cellX: number,
  cellY: number,
  w: number,
  h: number,
): boolean {
  for (let y = cellY; y < cellY + h; y++) {
    for (let x = cellX; x < cellX + w; x++) {
      if (isCellBlocked(world, x, y)) return false;
    }
  }
  return true;
}

function firstSelectedProducer(world: World, def: ProductionDef): Entity | null {
  for (const id of world.selection) {
    const e = world.entities.get(id);
    if (!e) continue;
    if (e.kind === def.producer && e.team === 'player' && !e.underConstruction) {
      return e;
    }
  }
  return null;
}

export function firstSelectedWorker(world: World): Entity | null {
  for (const id of world.selection) {
    const e = world.entities.get(id);
    if (!e) continue;
    if (e.kind === 'worker' && e.team === 'player') return e;
  }
  return null;
}

/**
 * Queues one unit on the given producer if resources allow. Returns whether queued.
 * Shared by button-click (single-target) and hotkey (multi-target) paths.
 */
export function enqueueProductionOn(
  world: World,
  producer: Entity,
  unit: UnitKind,
): boolean {
  const def = UNIT_PRODUCTION[unit];
  if (!def) return false;
  if (producer.kind !== def.producer) return false;
  if (producer.team !== 'player') return false;
  if (producer.underConstruction) return false;
  if (world.resources.player < def.cost) return false;
  const gasCost = def.gasCost ?? 0;
  if (gasCost > 0 && world.gas < gasCost) return false;
  world.resources.player -= def.cost;
  if (gasCost > 0) world.gas -= gasCost;
  producer.productionQueue!.push({
    produces: unit,
    totalSeconds: def.seconds,
    remainingSeconds: def.seconds,
  });
  return true;
}

/**
 * Hotkey path: queues `unit` on every selected matching producer (player team, completed).
 * Resource gating is per-target via enqueueProductionOn — once funds run out the rest no-op.
 */
export function enqueueProductionOnAllSelected(world: World, unit: UnitKind): void {
  const def = UNIT_PRODUCTION[unit];
  if (!def) return;
  for (const id of world.selection) {
    const e = world.entities.get(id);
    if (!e) continue;
    if (e.kind !== def.producer) continue;
    if (e.team !== 'player') continue;
    if (e.underConstruction) continue;
    enqueueProductionOn(world, e, unit);
  }
}

/**
 * Hotkey path: enter placement mode only if a player Worker is selected.
 * Mirrors the UI's button-visibility gate used by the click path.
 */
export function beginPlacementForWorker(world: World, building: BuildingKind): boolean {
  if (!firstSelectedWorker(world)) return false;
  world.placement = { team: 'player', buildingKind: building };
  world.attackMode = false;
  return true;
}

export function selectionHasAnyUnit(world: World): boolean {
  for (const id of world.selection) {
    const e = world.entities.get(id);
    if (!e) continue;
    if (e.team !== 'player') continue;
    if (isUnit(e)) return true;
  }
  return false;
}

/**
 * Wipes all in-progress activity on a unit (command, path, gather sub-state, attack target).
 * Mineral payload (`carrying`) is preserved — Stop shouldn't dump resources.
 */
export function stopUnit(unit: Entity): void {
  unit.command = null;
  unit.path = null;
  unit.pathTargetCell = null;
  unit.attackTargetId = null;
  unit.gatherSubState = undefined;
  unit.gatherTimer = 0;
  unit.gatherNodeId = null;
  unit.gatherHomeId = null;
}

export function stopAllSelectedUnits(world: World): void {
  for (const id of world.selection) {
    const e = world.entities.get(id);
    if (!e) continue;
    if (e.team !== 'player') continue;
    if (!isUnit(e)) continue;
    stopUnit(e);
  }
}

/**
 * Pops one item from the END of the building's queue and refunds its cost
 * (SC convention). No-op if queue empty. Returns whether an item was canceled.
 */
export function cancelLastProduction(world: World, building: Entity): boolean {
  if (!building.productionQueue || building.productionQueue.length === 0) return false;
  const popped = building.productionQueue.pop();
  if (!popped) return false;
  const def = UNIT_PRODUCTION[popped.produces];
  if (def) {
    world.resources[building.team] += def.cost;
    if (building.team === 'player' && def.gasCost) world.gas += def.gasCost;
  }
  return true;
}

export function cancelLastProductionOnAllSelected(world: World): void {
  for (const id of world.selection) {
    const e = world.entities.get(id);
    if (!e) continue;
    if (e.team !== 'player') continue;
    if (!isBuilding(e)) continue;
    cancelLastProduction(world, e);
  }
}

export function chooseUnitCommand(
  world: World,
  unit: Entity,
  target: Entity | null,
  wx: number,
  wy: number,
  shift: boolean,
): Command {
  if (target) {
    if (target.team !== unit.team && target.team !== 'neutral') {
      if (unit.attackRange === undefined) {
        return {
          type: 'move',
          target: clampMoveTargetToWalkable(world, { x: target.pos.x, y: target.pos.y }),
        };
      }
      return { type: 'attack', targetId: target.id };
    }
    if (target.kind === 'mineralNode' && unit.kind === 'worker') {
      return { type: 'gather', nodeId: target.id };
    }
    if (
      isBuilding(target) &&
      target.team === unit.team &&
      target.underConstruction &&
      unit.kind === 'worker'
    ) {
      return { type: 'build', buildingId: target.id };
    }
  }
  if (shift && unit.attackRange !== undefined) {
    return { type: 'attackMove', target: clampMoveTargetToWalkable(world, { x: wx, y: wy }) };
  }
  return { type: 'move', target: clampMoveTargetToWalkable(world, { x: wx, y: wy }) };
}

/**
 * If the target world position falls in a blocked cell (mineral / building),
 * snap to the center of the nearest walkable cell within CLAMP_SEARCH_RADIUS
 * (Chebyshev rings, Euclidean tie-break). Walkable input is returned as-is.
 */
export function clampMoveTargetToWalkable(world: World, pos: Vec2): Vec2 {
  const cell = pxToCell(pos);
  if (inBounds(cell.x, cell.y) && !isCellBlocked(world, cell.x, cell.y)) {
    return pos;
  }
  for (let r = 1; r <= CLAMP_SEARCH_RADIUS; r++) {
    const ring = collectRing(cell.x, cell.y, r);
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const c of ring) {
      if (!inBounds(c.x, c.y)) continue;
      if (isCellBlocked(world, c.x, c.y)) continue;
      const center = cellToPx(c.x, c.y);
      const dx = center.x - pos.x;
      const dy = center.y - pos.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        best = c;
        bestD = d;
      }
    }
    if (best) return cellToPx(best.x, best.y);
  }
  return pos;
}

function collectRing(cx: number, cy: number, r: number): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let x = cx - r; x <= cx + r; x++) {
    out.push({ x, y: cy - r });
    out.push({ x, y: cy + r });
  }
  for (let y = cy - r + 1; y <= cy + r - 1; y++) {
    out.push({ x: cx - r, y });
    out.push({ x: cx + r, y });
  }
  return out;
}

function isUnit(e: Entity): boolean {
  return (
    e.kind === 'worker' ||
    e.kind === 'marine' ||
    e.kind === 'tank' ||
    e.kind === 'tank-light' ||
    e.kind === 'medic' ||
    e.kind === 'enemyDummy'
  );
}

function isBuilding(e: Entity): e is Entity & { kind: BuildingKind } {
  return (
    e.kind === 'commandCenter' ||
    e.kind === 'barracks' ||
    e.kind === 'turret' ||
    e.kind === 'refinery' ||
    e.kind === 'factory'
  );
}
