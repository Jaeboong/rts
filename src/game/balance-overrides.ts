import type { BuildingKind, UnitKind } from '../types';
import {
  BUILDING_DEFS,
  UNIT_DEFS,
  UNIT_PRODUCTION,
  type BuildingDef,
  type ProductionDef,
  type UnitDef,
} from './balance';
import { loadOverrides, type Overrides } from '../admin/storage';

// Whitelist of editable fields per def. Anything outside this list is ignored on apply,
// so a stale override for a removed field can't crash startup.
const UNIT_FIELDS: ReadonlyArray<keyof UnitDef> = [
  'hp',
  'speed',
  'radius',
  'attackRange',
  'attackDamage',
  'attackInterval',
];
const BUILDING_FIELDS: ReadonlyArray<keyof BuildingDef> = [
  'hp',
  'w',
  'h',
  'buildSeconds',
  'cost',
  'attackRange',
  'attackDamage',
  'attackInterval',
];
const PRODUCTION_FIELDS: ReadonlyArray<keyof ProductionDef> = ['cost', 'seconds', 'producer'];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isUnitKind(k: string): k is UnitKind {
  return k in UNIT_DEFS;
}

function isBuildingKind(k: string): k is BuildingKind {
  return k in BUILDING_DEFS;
}

function applyUnitOverrides(partials: Overrides['unitDefs']): void {
  if (!partials) return;
  for (const [kind, partial] of Object.entries(partials)) {
    if (!isUnitKind(kind)) continue;
    if (!isObject(partial)) continue;
    const dst = UNIT_DEFS[kind];
    for (const field of UNIT_FIELDS) {
      if (!(field in partial)) continue;
      const val = partial[field];
      if (typeof val !== 'number') continue;
      dst[field] = val;
    }
  }
}

function applyBuildingOverrides(partials: Overrides['buildingDefs']): void {
  if (!partials) return;
  for (const [kind, partial] of Object.entries(partials)) {
    if (!isBuildingKind(kind)) continue;
    if (!isObject(partial)) continue;
    const dst = BUILDING_DEFS[kind];
    for (const field of BUILDING_FIELDS) {
      if (!(field in partial)) continue;
      const val = partial[field];
      if (typeof val !== 'number') continue;
      dst[field] = val;
    }
  }
}

function applyProductionOverrides(partials: Overrides['unitProduction']): void {
  if (!partials) return;
  for (const [kind, partial] of Object.entries(partials)) {
    if (!isUnitKind(kind)) continue;
    const dst = UNIT_PRODUCTION[kind];
    if (!dst) continue;
    if (!isObject(partial)) continue;
    for (const field of PRODUCTION_FIELDS) {
      if (!(field in partial)) continue;
      const val = partial[field];
      if (field === 'producer') {
        if (typeof val === 'string' && isBuildingKind(val)) {
          dst.producer = val;
        }
        continue;
      }
      if (typeof val !== 'number') continue;
      dst[field] = val;
    }
  }
}

export function applyOverrides(overrides: Overrides): void {
  applyUnitOverrides(overrides.unitDefs);
  applyBuildingOverrides(overrides.buildingDefs);
  applyProductionOverrides(overrides.unitProduction);
}

export function applyOverridesAtStartup(): void {
  applyOverrides(loadOverrides());
}
