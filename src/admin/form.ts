import type { BuildingKind, UnitKind } from '../types';
import {
  BUILDING_DEFS,
  UNIT_DEFS,
  UNIT_PRODUCTION,
  type BuildingDef,
  type ProductionDef,
  type UnitDef,
} from '../game/balance';
import type { Overrides } from './storage';

// Field lists drive both column headers and per-row cells. Order matters for UX (HP first).
export const UNIT_FIELDS: ReadonlyArray<keyof UnitDef> = [
  'hp',
  'speed',
  'radius',
  'attackRange',
  'attackDamage',
  'attackInterval',
];
export const BUILDING_FIELDS: ReadonlyArray<keyof BuildingDef> = [
  'hp',
  'w',
  'h',
  'buildSeconds',
  'cost',
  'attackRange',
  'attackDamage',
  'attackInterval',
];
export const PRODUCTION_NUMERIC_FIELDS: ReadonlyArray<'cost' | 'seconds'> = ['cost', 'seconds'];

export function unitInputId(kind: UnitKind, field: keyof UnitDef): string {
  return `unit__${kind}__${field}`;
}
export function buildingInputId(kind: BuildingKind, field: keyof BuildingDef): string {
  return `building__${kind}__${field}`;
}
export function productionInputId(kind: UnitKind, field: keyof ProductionDef): string {
  return `production__${kind}__${field}`;
}

function getUnitOverride(
  overrides: Overrides,
  kind: UnitKind,
  field: keyof UnitDef,
): number | undefined {
  const v = overrides.unitDefs?.[kind]?.[field];
  return typeof v === 'number' ? v : undefined;
}
function getBuildingOverride(
  overrides: Overrides,
  kind: BuildingKind,
  field: keyof BuildingDef,
): number | undefined {
  const v = overrides.buildingDefs?.[kind]?.[field];
  return typeof v === 'number' ? v : undefined;
}
function getProductionOverride(
  overrides: Overrides,
  kind: UnitKind,
  field: keyof ProductionDef,
): string | number | undefined {
  const v = overrides.unitProduction?.[kind]?.[field];
  if (typeof v === 'number' || typeof v === 'string') return v;
  return undefined;
}

function makeNumberInput(id: string, defaultVal: number | undefined, current: number | undefined): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.id = id;
  input.step = 'any';
  if (defaultVal !== undefined) input.placeholder = String(defaultVal);
  if (current !== undefined) input.value = String(current);
  return input;
}

function makeProducerSelect(
  id: string,
  defaultVal: BuildingKind | undefined,
  current: BuildingKind | undefined,
): HTMLSelectElement {
  const select = document.createElement('select');
  select.id = id;
  // Empty option lets user "clear" the override (revert to default on next save).
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = defaultVal ? `(default: ${defaultVal})` : '(default)';
  select.appendChild(empty);
  for (const kind of Object.keys(BUILDING_DEFS) as BuildingKind[]) {
    const opt = document.createElement('option');
    opt.value = kind;
    opt.textContent = kind;
    select.appendChild(opt);
  }
  if (current !== undefined) select.value = current;
  return select;
}

function buildUnitTable(overrides: Overrides): HTMLTableElement {
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.appendChild(th('UnitKind'));
  for (const f of UNIT_FIELDS) headRow.appendChild(th(String(f)));
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const kind of Object.keys(UNIT_DEFS) as UnitKind[]) {
    const def = UNIT_DEFS[kind];
    const row = document.createElement('tr');
    row.appendChild(td(kind, 'kind'));
    for (const field of UNIT_FIELDS) {
      const cell = document.createElement('td');
      const defaultVal = def[field];
      // Cell stays empty when this unit doesn't use the field (e.g. worker has no attack stats).
      if (defaultVal === undefined) {
        cell.textContent = '';
      } else {
        cell.appendChild(
          makeNumberInput(unitInputId(kind, field), defaultVal, getUnitOverride(overrides, kind, field)),
        );
      }
      row.appendChild(cell);
    }
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  return table;
}

function buildBuildingTable(overrides: Overrides): HTMLTableElement {
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.appendChild(th('BuildingKind'));
  for (const f of BUILDING_FIELDS) headRow.appendChild(th(String(f)));
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const kind of Object.keys(BUILDING_DEFS) as BuildingKind[]) {
    const def = BUILDING_DEFS[kind];
    const row = document.createElement('tr');
    row.appendChild(td(kind, 'kind'));
    for (const field of BUILDING_FIELDS) {
      const cell = document.createElement('td');
      const defaultVal = def[field];
      if (defaultVal === undefined) {
        cell.textContent = '';
      } else {
        cell.appendChild(
          makeNumberInput(
            buildingInputId(kind, field),
            defaultVal,
            getBuildingOverride(overrides, kind, field),
          ),
        );
      }
      row.appendChild(cell);
    }
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  return table;
}

function buildProductionTable(overrides: Overrides): HTMLTableElement {
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.appendChild(th('UnitKind'));
  headRow.appendChild(th('cost'));
  headRow.appendChild(th('seconds'));
  headRow.appendChild(th('producer'));
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const kind of Object.keys(UNIT_DEFS) as UnitKind[]) {
    const def = UNIT_PRODUCTION[kind];
    const row = document.createElement('tr');
    row.appendChild(td(kind, 'kind'));
    if (!def) {
      // Unit has no production recipe (e.g. enemyDummy) — render empty disabled cells.
      row.appendChild(emptyTd());
      row.appendChild(emptyTd());
      row.appendChild(emptyTd());
    } else {
      for (const field of PRODUCTION_NUMERIC_FIELDS) {
        const cell = document.createElement('td');
        const overrideVal = getProductionOverride(overrides, kind, field);
        const current = typeof overrideVal === 'number' ? overrideVal : undefined;
        cell.appendChild(makeNumberInput(productionInputId(kind, field), def[field], current));
        row.appendChild(cell);
      }
      const producerCell = document.createElement('td');
      const producerOverride = getProductionOverride(overrides, kind, 'producer');
      const currentProducer =
        typeof producerOverride === 'string' && producerOverride in BUILDING_DEFS
          ? (producerOverride as BuildingKind)
          : undefined;
      producerCell.appendChild(
        makeProducerSelect(productionInputId(kind, 'producer'), def.producer, currentProducer),
      );
      row.appendChild(producerCell);
    }
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  return table;
}

function th(text: string): HTMLTableCellElement {
  const el = document.createElement('th');
  el.textContent = text;
  return el;
}
function td(text: string, className?: string): HTMLTableCellElement {
  const el = document.createElement('td');
  el.textContent = text;
  if (className) el.className = className;
  return el;
}
function emptyTd(): HTMLTableCellElement {
  const el = document.createElement('td');
  el.textContent = '';
  return el;
}

export function buildForm(overrides: Overrides): DocumentFragment {
  const frag = document.createDocumentFragment();
  const h1 = document.createElement('h1');
  h1.textContent = 'RTS MVP — Balance Admin';
  frag.appendChild(h1);

  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent =
    'Empty input = use default (placeholder shows default). attackRange is stored as raw pixel values (CELL = 16px, so 10 cells = 160). ';
  const link = document.createElement('a');
  link.href = '/';
  link.textContent = 'Back to game';
  hint.appendChild(link);
  frag.appendChild(hint);

  const unitsHeader = document.createElement('h2');
  unitsHeader.textContent = 'Units';
  frag.appendChild(unitsHeader);
  frag.appendChild(buildUnitTable(overrides));

  const buildingsHeader = document.createElement('h2');
  buildingsHeader.textContent = 'Buildings';
  frag.appendChild(buildingsHeader);
  frag.appendChild(buildBuildingTable(overrides));

  const prodHeader = document.createElement('h2');
  prodHeader.textContent = 'Production';
  frag.appendChild(prodHeader);
  frag.appendChild(buildProductionTable(overrides));

  return frag;
}

// Walks the rendered form, returns Overrides containing only inputs whose value differs from default.
export function collectOverrides(root: ParentNode): Overrides {
  const result: Overrides = {};

  for (const kind of Object.keys(UNIT_DEFS) as UnitKind[]) {
    const def = UNIT_DEFS[kind];
    for (const field of UNIT_FIELDS) {
      const defaultVal = def[field];
      if (defaultVal === undefined) continue;
      const input = root.querySelector<HTMLInputElement>(`#${unitInputId(kind, field)}`);
      if (!input) continue;
      const raw = input.value.trim();
      if (raw === '') continue;
      const num = Number(raw);
      if (!Number.isFinite(num)) continue;
      if (num === defaultVal) continue;
      if (!result.unitDefs) result.unitDefs = {};
      const slot = result.unitDefs[kind] ?? {};
      slot[field] = num;
      result.unitDefs[kind] = slot;
    }
  }

  for (const kind of Object.keys(BUILDING_DEFS) as BuildingKind[]) {
    const def = BUILDING_DEFS[kind];
    for (const field of BUILDING_FIELDS) {
      const defaultVal = def[field];
      if (defaultVal === undefined) continue;
      const input = root.querySelector<HTMLInputElement>(`#${buildingInputId(kind, field)}`);
      if (!input) continue;
      const raw = input.value.trim();
      if (raw === '') continue;
      const num = Number(raw);
      if (!Number.isFinite(num)) continue;
      if (num === defaultVal) continue;
      if (!result.buildingDefs) result.buildingDefs = {};
      const slot = result.buildingDefs[kind] ?? {};
      slot[field] = num;
      result.buildingDefs[kind] = slot;
    }
  }

  for (const kind of Object.keys(UNIT_DEFS) as UnitKind[]) {
    const def = UNIT_PRODUCTION[kind];
    if (!def) continue;
    for (const field of PRODUCTION_NUMERIC_FIELDS) {
      const input = root.querySelector<HTMLInputElement>(`#${productionInputId(kind, field)}`);
      if (!input) continue;
      const raw = input.value.trim();
      if (raw === '') continue;
      const num = Number(raw);
      if (!Number.isFinite(num)) continue;
      if (num === def[field]) continue;
      if (!result.unitProduction) result.unitProduction = {};
      const slot = result.unitProduction[kind] ?? {};
      slot[field] = num;
      result.unitProduction[kind] = slot;
    }
    const producerSelect = root.querySelector<HTMLSelectElement>(
      `#${productionInputId(kind, 'producer')}`,
    );
    if (producerSelect && producerSelect.value !== '' && producerSelect.value !== def.producer) {
      if (!result.unitProduction) result.unitProduction = {};
      const slot = result.unitProduction[kind] ?? {};
      slot.producer = producerSelect.value as BuildingKind;
      result.unitProduction[kind] = slot;
    }
  }

  return result;
}
