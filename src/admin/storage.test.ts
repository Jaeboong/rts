import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  STORAGE_KEY,
  clearOverrides,
  loadOverrides,
  saveOverrides,
  type Overrides,
} from './storage';

beforeEach(() => {
  globalThis.localStorage.clear();
});
afterEach(() => {
  globalThis.localStorage.clear();
});

describe('admin/storage', () => {
  it('returns {} when nothing stored', () => {
    expect(loadOverrides()).toEqual({});
  });

  it('round-trips save → load', () => {
    const o: Overrides = {
      unitDefs: { marine: { hp: 80, attackInterval: 0.8 } },
      buildingDefs: { barracks: { hp: 1200 } },
      unitProduction: { worker: { cost: 60 } },
    };
    saveOverrides(o);
    expect(loadOverrides()).toEqual(o);
  });

  it('returns {} when JSON is malformed', () => {
    globalThis.localStorage.setItem(STORAGE_KEY, '{not json');
    expect(loadOverrides()).toEqual({});
  });

  it('returns {} when stored value is not an object', () => {
    globalThis.localStorage.setItem(STORAGE_KEY, '"a string"');
    expect(loadOverrides()).toEqual({});
  });

  it('clearOverrides removes the key', () => {
    saveOverrides({ unitDefs: { marine: { hp: 80 } } });
    expect(globalThis.localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    clearOverrides();
    expect(globalThis.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(loadOverrides()).toEqual({});
  });

  it('drops sections that aren\'t plain objects', () => {
    globalThis.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ unitDefs: 'no good', buildingDefs: { barracks: { hp: 1100 } } }),
    );
    const out = loadOverrides();
    expect(out.unitDefs).toBeUndefined();
    expect(out.buildingDefs).toEqual({ barracks: { hp: 1100 } });
  });
});
