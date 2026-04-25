import type { BuildingKind, UnitKind } from '../types';
import type { BuildingDef, ProductionDef, UnitDef } from '../game/balance';

export const STORAGE_KEY = 'rts2-balance-overrides';

export interface Overrides {
  unitDefs?: Partial<Record<UnitKind, Partial<UnitDef>>>;
  buildingDefs?: Partial<Record<BuildingKind, Partial<BuildingDef>>>;
  unitProduction?: Partial<Record<UnitKind, Partial<ProductionDef>>>;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Defensive parse: any malformed shape returns {} so admin/game never crash on bad localStorage.
function parseOverrides(raw: string): Overrides {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isObject(parsed)) return {};
  const out: Overrides = {};
  if (isObject(parsed.unitDefs)) {
    out.unitDefs = parsed.unitDefs as Overrides['unitDefs'];
  }
  if (isObject(parsed.buildingDefs)) {
    out.buildingDefs = parsed.buildingDefs as Overrides['buildingDefs'];
  }
  if (isObject(parsed.unitProduction)) {
    out.unitProduction = parsed.unitProduction as Overrides['unitProduction'];
  }
  return out;
}

function getStorage(): Storage | null {
  if (typeof globalThis === 'undefined') return null;
  const g = globalThis as { localStorage?: Storage };
  return g.localStorage ?? null;
}

export function loadOverrides(): Overrides {
  const ls = getStorage();
  if (!ls) return {};
  let raw: string | null;
  try {
    raw = ls.getItem(STORAGE_KEY);
  } catch {
    return {};
  }
  if (raw === null) return {};
  return parseOverrides(raw);
}

export function saveOverrides(overrides: Overrides): void {
  const ls = getStorage();
  if (!ls) return;
  try {
    ls.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // Storage may be full or denied; silent in admin context — caller can verify with loadOverrides.
  }
}

export function clearOverrides(): void {
  const ls = getStorage();
  if (!ls) return;
  try {
    ls.removeItem(STORAGE_KEY);
  } catch {
    // Ignore — already absent or denied.
  }
}
