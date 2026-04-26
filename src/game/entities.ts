import { CELL, type BuildingKind, type Entity, type Team, type UnitKind, type Vec2 } from '../types';
import { BUILDING_DEFS, UNIT_DEFS } from './balance';
import { addEntity, cellToPx, type World } from './world';

export function spawnUnit(
  world: World,
  kind: UnitKind,
  team: Team,
  pos: Vec2,
): Entity {
  const def = UNIT_DEFS[kind];
  const ent: Omit<Entity, 'id'> = {
    kind,
    team,
    pos: { ...pos },
    hp: def.hp,
    hpMax: def.hp,
    speed: def.speed,
    radius: def.radius,
    command: null,
    path: null,
    attackTargetId: null,
  };
  if (def.attackRange !== undefined) {
    ent.attackCooldown = 0;
    ent.attackRange = def.attackRange;
    ent.attackDamage = def.attackDamage;
    ent.attackInterval = def.attackInterval;
  }
  if (def.sightRange !== undefined) {
    ent.sightRange = def.sightRange;
  }
  if (kind === 'worker') {
    ent.carrying = 0;
  }
  if (kind === 'medic') {
    ent.healRate = def.healRate;
    ent.healRange = def.healRange;
    ent.healSubState = 'idle';
    ent.healTargetId = null;
    ent.healTimer = 0;
  }
  // enemyDummy is static — no facing. Worker/marine/tank/tank-light/medic rotate visually.
  if (
    kind === 'worker' ||
    kind === 'marine' ||
    kind === 'tank' ||
    kind === 'tank-light' ||
    kind === 'medic'
  ) {
    ent.facing = 0;
  }
  return addEntity(world, ent);
}

export function spawnBuilding(
  world: World,
  kind: BuildingKind,
  team: Team,
  cellX: number,
  cellY: number,
  completed = true,
): Entity {
  const def = BUILDING_DEFS[kind];
  const center: Vec2 = {
    x: (cellX + def.w / 2) * CELL,
    y: (cellY + def.h / 2) * CELL,
  };
  const ent: Omit<Entity, 'id'> = {
    kind,
    team,
    pos: center,
    hp: completed ? def.hp : 1,
    hpMax: def.hp,
    cellX,
    cellY,
    sizeW: def.w,
    sizeH: def.h,
    underConstruction: !completed,
    buildTotalSeconds: def.buildSeconds,
    buildProgress: completed ? def.buildSeconds : 0,
    productionQueue: [],
    rallyPoint: null,
  };
  if (def.attackRange !== undefined) {
    ent.attackCooldown = 0;
    ent.attackRange = def.attackRange;
    ent.attackDamage = def.attackDamage;
    ent.attackInterval = def.attackInterval;
  }
  if (def.sightRange !== undefined) {
    ent.sightRange = def.sightRange;
  }
  if (kind === 'refinery') {
    ent.gasAccumulator = 0;
    ent.geyserId = null;
  }
  if (kind === 'supplyDepot') {
    ent.mineralNodeId = null;
  }
  return addEntity(world, ent);
}

export function spawnMineralNode(
  world: World,
  cellX: number,
  cellY: number,
  remaining = 15000,
): Entity {
  return addEntity(world, {
    kind: 'mineralNode',
    team: 'neutral',
    pos: cellToPx(cellX, cellY),
    hp: 1,
    hpMax: 1,
    cellX,
    cellY,
    sizeW: 5,
    sizeH: 5,
    remaining,
    depotId: null,
  });
}

export function spawnGasGeyser(
  world: World,
  cellX: number,
  cellY: number,
): Entity {
  return addEntity(world, {
    kind: 'gasGeyser',
    team: 'neutral',
    pos: cellToPx(cellX, cellY),
    hp: 1,
    hpMax: 1,
    cellX,
    cellY,
    sizeW: 5,
    sizeH: 5,
    refineryId: null,
  });
}
