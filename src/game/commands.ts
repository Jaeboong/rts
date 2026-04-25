import { CELL, type Command, type Entity } from '../types';
import type { UIAction } from '../render/ui';
import {
  BUILDING_DEFS,
  UNIT_PRODUCTION,
  spawnBuilding,
  type ProductionDef,
} from './entities';
import type { Game } from './loop';
import { pickEntityAt } from './selection';
import { isCellBlocked, type World } from './world';

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
      const cmd = chooseUnitCommand(e, target, wx, wy, shift);
      e.command = cmd;
      e.path = null;
      e.attackTargetId = null;
    } else if (isBuilding(e)) {
      e.rallyPoint = { x: wx, y: wy };
    }
  }
}

export function issueUIAction(game: Game, action: ExtendedUIAction): void {
  const { world } = game;
  switch (action.type) {
    case 'produce': {
      const def = UNIT_PRODUCTION[action.unit];
      if (!def) return;
      const target = firstSelectedProducer(world, def);
      if (!target) return;
      if (world.resources.player < def.cost) return;
      world.resources.player -= def.cost;
      target.productionQueue!.push({
        produces: action.unit,
        totalSeconds: def.seconds,
        remainingSeconds: def.seconds,
      });
      return;
    }
    case 'beginPlace': {
      world.placement = { team: 'player', buildingKind: action.building };
      return;
    }
    case 'cancelPlacement': {
      world.placement = null;
      return;
    }
    case 'confirmPlacement': {
      if (!world.placement) return;
      const def = BUILDING_DEFS[world.placement.buildingKind];
      const cellX = Math.floor(action.x / CELL) - Math.floor(def.w / 2);
      const cellY = Math.floor(action.y / CELL) - Math.floor(def.h / 2);
      if (!canPlace(world, cellX, cellY, def.w, def.h)) return;
      if (world.resources.player < def.cost) return;
      const worker = firstSelectedWorker(world);
      if (!worker) return;
      world.resources.player -= def.cost;
      const site = spawnBuilding(
        world,
        world.placement.buildingKind,
        'player',
        cellX,
        cellY,
        false,
      );
      worker.command = { type: 'build', buildingId: site.id };
      worker.path = null;
      worker.attackTargetId = null;
      world.placement = null;
      return;
    }
  }
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

function firstSelectedWorker(world: World): Entity | null {
  for (const id of world.selection) {
    const e = world.entities.get(id);
    if (!e) continue;
    if (e.kind === 'worker' && e.team === 'player') return e;
  }
  return null;
}

function chooseUnitCommand(
  unit: Entity,
  target: Entity | null,
  wx: number,
  wy: number,
  shift: boolean,
): Command {
  if (target) {
    if (target.team !== unit.team && target.team !== 'neutral') {
      if (unit.attackRange === undefined) {
        return { type: 'move', target: { x: target.pos.x, y: target.pos.y } };
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
    return { type: 'attackMove', target: { x: wx, y: wy } };
  }
  return { type: 'move', target: { x: wx, y: wy } };
}

function isUnit(e: Entity): boolean {
  return e.kind === 'worker' || e.kind === 'marine' || e.kind === 'enemyDummy';
}

function isBuilding(e: Entity): boolean {
  return (
    e.kind === 'commandCenter' || e.kind === 'barracks' || e.kind === 'turret'
  );
}
