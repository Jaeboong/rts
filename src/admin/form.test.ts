import { describe, expect, it } from 'vitest';
import { BUILDING_DEFS, UNIT_DEFS } from '../game/balance';
import {
  buildForm,
  buildingInputId,
  collectOverrides,
  productionInputId,
  unitInputId,
} from './form';
import type { Overrides } from './storage';
import type { BuildingKind, UnitKind } from '../types';

function mount(overrides: Overrides): HTMLDivElement {
  const root = document.createElement('div');
  root.appendChild(buildForm(overrides));
  return root;
}

describe('admin/form', () => {
  it('renders one row per UnitKind in units table', () => {
    const root = mount({});
    const tables = root.querySelectorAll('table');
    expect(tables.length).toBe(3);
    const unitRows = tables[0]!.querySelectorAll('tbody tr');
    expect(unitRows.length).toBe(Object.keys(UNIT_DEFS).length);
  });

  it('renders one row per BuildingKind in buildings table', () => {
    const root = mount({});
    const tables = root.querySelectorAll('table');
    const buildingRows = tables[1]!.querySelectorAll('tbody tr');
    expect(buildingRows.length).toBe(Object.keys(BUILDING_DEFS).length);
  });

  it('placeholder = default when no override', () => {
    const root = mount({});
    const hpInput = root.querySelector<HTMLInputElement>(`#${unitInputId('marine', 'hp')}`);
    expect(hpInput).not.toBeNull();
    expect(hpInput!.placeholder).toBe(String(UNIT_DEFS.marine.hp));
    expect(hpInput!.value).toBe('');
  });

  it('value = override when present, placeholder still = default', () => {
    const root = mount({ unitDefs: { marine: { hp: 80 } } });
    const hpInput = root.querySelector<HTMLInputElement>(`#${unitInputId('marine', 'hp')}`);
    expect(hpInput!.value).toBe('80');
    expect(hpInput!.placeholder).toBe(String(UNIT_DEFS.marine.hp));
  });

  it('omits inputs for fields not applicable to a unit (e.g. worker has no attackRange)', () => {
    const root = mount({});
    const workerAttack = root.querySelector(`#${unitInputId('worker', 'attackRange')}`);
    expect(workerAttack).toBeNull();
  });

  it('renders empty cells for unit with no production recipe (enemyDummy)', () => {
    const root = mount({});
    const enemyCost = root.querySelector(`#${productionInputId('enemyDummy', 'cost')}`);
    expect(enemyCost).toBeNull();
  });

  it('producer is a <select>, not an <input>', () => {
    const root = mount({});
    const producer = root.querySelector(`#${productionInputId('marine', 'producer')}`);
    expect(producer).not.toBeNull();
    expect(producer!.tagName).toBe('SELECT');
  });

  it('collectOverrides returns {} when nothing changed', () => {
    const root = mount({});
    expect(collectOverrides(root)).toEqual({});
  });

  it('collectOverrides ignores blank inputs (means: use default)', () => {
    const root = mount({ unitDefs: { marine: { hp: 80 } } });
    const hpInput = root.querySelector<HTMLInputElement>(`#${unitInputId('marine', 'hp')}`);
    hpInput!.value = '';
    expect(collectOverrides(root)).toEqual({});
  });

  it('collectOverrides skips values equal to default (no spurious override)', () => {
    const root = mount({});
    const hpInput = root.querySelector<HTMLInputElement>(`#${unitInputId('marine', 'hp')}`);
    hpInput!.value = String(UNIT_DEFS.marine.hp);
    expect(collectOverrides(root)).toEqual({});
  });

  it('collectOverrides picks up changed numeric inputs', () => {
    const root = mount({});
    const hpInput = root.querySelector<HTMLInputElement>(`#${unitInputId('marine', 'hp')}`);
    hpInput!.value = '80';
    const out = collectOverrides(root);
    expect(out.unitDefs?.marine?.hp).toBe(80);
  });

  it('collectOverrides picks up changed building input', () => {
    const root = mount({});
    const hpInput = root.querySelector<HTMLInputElement>(
      `#${buildingInputId('barracks', 'hp')}`,
    );
    hpInput!.value = '1200';
    const out = collectOverrides(root);
    expect(out.buildingDefs?.barracks?.hp).toBe(1200);
  });

  it('collectOverrides picks up changed producer select', () => {
    const root = mount({});
    const producer = root.querySelector<HTMLSelectElement>(
      `#${productionInputId('marine', 'producer')}`,
    );
    producer!.value = 'commandCenter';
    const out = collectOverrides(root);
    expect(out.unitProduction?.marine?.producer).toBe('commandCenter');
  });

  it('renders all UnitKind values as rows including ones without recipes', () => {
    const root = mount({});
    const tables = root.querySelectorAll('table');
    const productionRows = tables[2]!.querySelectorAll('tbody tr');
    expect(productionRows.length).toBe(Object.keys(UNIT_DEFS).length);
    // At least one row for a UnitKind known to have no production recipe.
    const kinds = Object.keys(UNIT_DEFS) as UnitKind[];
    expect(kinds).toContain('enemyDummy' satisfies BuildingKind | UnitKind);
  });
});
