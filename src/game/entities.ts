import { CELL, type BuildingKind, type Entity, type Team, type UnitKind, type Vec2 } from '../types';
import { addEntity, cellToPx, type World } from './world';

export interface UnitDef {
  hp: number;
  speed: number;
  radius: number;
  attackRange?: number;
  attackDamage?: number;
  attackInterval?: number;
}

export const UNIT_DEFS: Record<UnitKind, UnitDef> = {
  worker: { hp: 40, speed: 80, radius: 10 },
  marine: {
    hp: 60,
    speed: 70,
    radius: 10,
    attackRange: 5 * CELL,
    attackDamage: 6,
    attackInterval: 1,
  },
  enemyDummy: { hp: 100, speed: 0, radius: 12 },
};

export interface BuildingDef {
  hp: number;
  w: number;
  h: number;
  buildSeconds: number;
  cost: number;
  attackRange?: number;
  attackDamage?: number;
  attackInterval?: number;
}

export const BUILDING_DEFS: Record<BuildingKind, BuildingDef> = {
  commandCenter: { hp: 1500, w: 4, h: 4, buildSeconds: 0, cost: 0 },
  barracks: { hp: 1000, w: 3, h: 3, buildSeconds: 20, cost: 150 },
  turret: {
    hp: 200,
    w: 2,
    h: 2,
    buildSeconds: 15,
    cost: 100,
    attackRange: 6 * CELL,
    attackDamage: 8,
    attackInterval: 1,
  },
};

export interface ProductionDef {
  cost: number;
  seconds: number;
  producer: BuildingKind;
}

export const UNIT_PRODUCTION: Partial<Record<UnitKind, ProductionDef>> = {
  worker: { cost: 50, seconds: 12, producer: 'commandCenter' },
  marine: { cost: 50, seconds: 15, producer: 'barracks' },
};

export const WORKER_CARRY_CAP = 5;
export const MINING_SECONDS = 1.5;
export const DEPOSIT_SECONDS = 0.2;

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
  if (kind === 'worker') {
    ent.carrying = 0;
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
  return addEntity(world, ent);
}

export function spawnMineralNode(
  world: World,
  cellX: number,
  cellY: number,
  remaining = 1500,
): Entity {
  return addEntity(world, {
    kind: 'mineralNode',
    team: 'neutral',
    pos: cellToPx(cellX, cellY),
    hp: 1,
    hpMax: 1,
    cellX,
    cellY,
    sizeW: 1,
    sizeH: 1,
    remaining,
  });
}
