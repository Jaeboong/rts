import { CELL, type BuildingKind, type UnitKind } from '../types';

// Buildings ----------------------------------------------------------------

export interface BuildingDef {
  hp: number;
  w: number;
  h: number;
  buildSeconds: number;
  cost: number;
  gasCost?: number;
  attackRange?: number;
  attackDamage?: number;
  attackInterval?: number;
  sightRange?: number;
}

export const BUILDING_DEFS: Record<BuildingKind, BuildingDef> = {
  commandCenter: { hp: 1500, w: 15, h: 15, buildSeconds: 0, cost: 0 },
  barracks: { hp: 1000, w: 7, h: 14, buildSeconds: 20, cost: 150 },
  turret: {
    hp: 200,
    w: 5,
    h: 5,
    buildSeconds: 15,
    cost: 100,
    attackRange: 12 * CELL,
    attackDamage: 8,
    attackInterval: 1,
    sightRange: 18 * CELL,
  },
  // Refinery footprint matches the 5×5 geyser exactly — TL aligned, cells overlap.
  refinery: { hp: 800, w: 5, h: 5, buildSeconds: 15, cost: 100 },
  factory: { hp: 1200, w: 10, h: 9, buildSeconds: 25, cost: 400, gasCost: 200 },
  // Supply depot footprint matches the 5×5 mineralNode exactly — TL aligned, cells overlap.
  // Free (cost 0) — gating is structural, not resource-based: must have a node to build on.
  supplyDepot: { hp: 600, w: 5, h: 5, buildSeconds: 10, cost: 0 },
};

// Units --------------------------------------------------------------------

export interface UnitDef {
  hp: number;
  speed: number;
  radius: number;
  attackRange?: number;
  attackDamage?: number;
  attackInterval?: number;
  sightRange?: number;
  healRate?: number;
  healRange?: number;
}

export const UNIT_DEFS: Record<UnitKind, UnitDef> = {
  worker: { hp: 40, speed: 80, radius: 7 },
  marine: {
    hp: 60,
    speed: 70,
    radius: 10,
    attackRange: 10 * CELL,
    attackDamage: 6,
    attackInterval: 1,
    sightRange: 15 * CELL,
  },
  tank: {
    hp: 200,
    speed: 50,
    radius: 14,
    attackRange: 14 * CELL,
    attackDamage: 12,
    attackInterval: 1,
    sightRange: 21 * CELL,
  },
  'tank-light': {
    hp: 100,
    speed: 70,
    radius: 12,
    attackRange: 8 * CELL,
    attackDamage: 7,
    attackInterval: 1,
    sightRange: 12 * CELL,
  },
  medic: {
    hp: 60,
    speed: 70,
    radius: 12,
    sightRange: 15 * CELL,
    healRate: 2,
    healRange: 1.5 * CELL,
  },
  enemyDummy: { hp: 100, speed: 0, radius: 12 },
};

// Production mapping (which building produces which unit) ------------------

export interface ProductionDef {
  cost: number;
  gasCost?: number;
  seconds: number;
  producer: BuildingKind;
}

export const UNIT_PRODUCTION: Partial<Record<UnitKind, ProductionDef>> = {
  worker: { cost: 50, seconds: 12, producer: 'commandCenter' },
  marine: { cost: 50, seconds: 15, producer: 'barracks' },
  medic: { cost: 50, gasCost: 25, seconds: 12, producer: 'barracks' },
  tank: { cost: 250, gasCost: 100, seconds: 30, producer: 'factory' },
  'tank-light': { cost: 120, gasCost: 30, seconds: 18, producer: 'factory' },
};

// Derived from UNIT_PRODUCTION so non-production buildings (refinery, turret) stay false
// without hardcoding — adding a new producible unit kind only updates UNIT_PRODUCTION.
export function canBuildingProduceUnits(kind: BuildingKind): boolean {
  for (const def of Object.values(UNIT_PRODUCTION)) {
    if (def && def.producer === kind) return true;
  }
  return false;
}

// Worker gather cycle ------------------------------------------------------

export const WORKER_CARRY_CAP = 5;
export const MINING_SECONDS = 1.5;
export const DEPOSIT_SECONDS = 0.2;
// Bounded re-search radius (cells) when a worker's targeted mineral depletes mid-cycle.
export const WORKER_AUTO_REPATH_RADIUS = 8;
