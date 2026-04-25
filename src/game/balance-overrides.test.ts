import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STORAGE_KEY } from '../admin/storage';
import { BUILDING_DEFS, UNIT_DEFS, UNIT_PRODUCTION } from './balance';
import { applyOverrides, applyOverridesAtStartup } from './balance-overrides';

// Snapshot defaults so each test can restore (defs are mutated in-place by applyOverrides).
const ORIGINAL_UNIT = JSON.parse(JSON.stringify(UNIT_DEFS)) as typeof UNIT_DEFS;
const ORIGINAL_BUILDING = JSON.parse(JSON.stringify(BUILDING_DEFS)) as typeof BUILDING_DEFS;
const ORIGINAL_PRODUCTION = JSON.parse(JSON.stringify(UNIT_PRODUCTION)) as typeof UNIT_PRODUCTION;

function restoreDefaults(): void {
  for (const k of Object.keys(UNIT_DEFS) as Array<keyof typeof UNIT_DEFS>) {
    Object.assign(UNIT_DEFS[k], ORIGINAL_UNIT[k]);
    // Drop any keys that were added by an override (none in current schema, but defensive).
    const live: Record<string, unknown> = UNIT_DEFS[k] as unknown as Record<string, unknown>;
    for (const f of Object.keys(live)) {
      if (!(f in ORIGINAL_UNIT[k])) delete live[f];
    }
  }
  for (const k of Object.keys(BUILDING_DEFS) as Array<keyof typeof BUILDING_DEFS>) {
    Object.assign(BUILDING_DEFS[k], ORIGINAL_BUILDING[k]);
  }
  for (const k of Object.keys(ORIGINAL_PRODUCTION) as Array<keyof typeof ORIGINAL_PRODUCTION>) {
    const orig = ORIGINAL_PRODUCTION[k];
    const live = UNIT_PRODUCTION[k];
    if (orig && live) Object.assign(live, orig);
  }
}

beforeEach(() => {
  globalThis.localStorage.clear();
  restoreDefaults();
});
afterEach(() => {
  globalThis.localStorage.clear();
  restoreDefaults();
});

describe('applyOverrides', () => {
  it('mutates UNIT_DEFS in place for known kind+field', () => {
    applyOverrides({ unitDefs: { marine: { hp: 80 } } });
    expect(UNIT_DEFS.marine.hp).toBe(80);
  });

  it('mutates BUILDING_DEFS in place', () => {
    applyOverrides({ buildingDefs: { barracks: { hp: 1200 } } });
    expect(BUILDING_DEFS.barracks.hp).toBe(1200);
  });

  it('mutates UNIT_PRODUCTION in place', () => {
    applyOverrides({ unitProduction: { worker: { cost: 60 } } });
    expect(UNIT_PRODUCTION.worker?.cost).toBe(60);
  });

  it('producer override accepts valid BuildingKind', () => {
    applyOverrides({ unitProduction: { marine: { producer: 'commandCenter' } } });
    expect(UNIT_PRODUCTION.marine?.producer).toBe('commandCenter');
  });

  it('producer override rejects unknown BuildingKind', () => {
    const before = UNIT_PRODUCTION.marine?.producer;
    applyOverrides({
      unitProduction: { marine: { producer: 'nonsense' as never } },
    });
    expect(UNIT_PRODUCTION.marine?.producer).toBe(before);
  });

  it('skips unknown UnitKind silently', () => {
    expect(() =>
      applyOverrides({ unitDefs: { ghost: { hp: 999 } } as never }),
    ).not.toThrow();
  });

  it('skips unknown field silently', () => {
    applyOverrides({ unitDefs: { marine: { mana: 50 } as never } });
    const marine: Record<string, unknown> = UNIT_DEFS.marine as unknown as Record<string, unknown>;
    expect(marine.mana).toBeUndefined();
  });

  it('rejects non-numeric values for numeric fields', () => {
    applyOverrides({ unitDefs: { marine: { hp: 'oops' as never } } });
    expect(UNIT_DEFS.marine.hp).toBe(ORIGINAL_UNIT.marine.hp);
  });

  it('skips production override for unit without a recipe', () => {
    applyOverrides({ unitProduction: { enemyDummy: { cost: 99 } as never } });
    expect(UNIT_PRODUCTION.enemyDummy).toBeUndefined();
  });

  it('multiple fields applied in one call', () => {
    applyOverrides({
      unitDefs: { marine: { hp: 80, attackInterval: 0.8 } },
      buildingDefs: { turret: { attackDamage: 12 } },
    });
    expect(UNIT_DEFS.marine.hp).toBe(80);
    expect(UNIT_DEFS.marine.attackInterval).toBe(0.8);
    expect(BUILDING_DEFS.turret.attackDamage).toBe(12);
  });
});

describe('applyOverridesAtStartup', () => {
  it('no-op when localStorage empty', () => {
    applyOverridesAtStartup();
    expect(UNIT_DEFS.marine.hp).toBe(ORIGINAL_UNIT.marine.hp);
  });

  it('reads localStorage and mutates defs', () => {
    globalThis.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ unitDefs: { marine: { hp: 80 } } }),
    );
    applyOverridesAtStartup();
    expect(UNIT_DEFS.marine.hp).toBe(80);
  });

  it('survives malformed JSON in localStorage', () => {
    globalThis.localStorage.setItem(STORAGE_KEY, '{not json');
    expect(() => applyOverridesAtStartup()).not.toThrow();
    expect(UNIT_DEFS.marine.hp).toBe(ORIGINAL_UNIT.marine.hp);
  });
});
