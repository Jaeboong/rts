import type { Overrides } from './storage';

const HEADER = '// Paste into src/game/balance.ts:';

function formatValue(v: unknown): string {
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

function emitFields(prefix: string, kindKey: string, fields: Record<string, unknown>): string[] {
  const lines: string[] = [];
  for (const [field, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    lines.push(`${prefix}.${kindKey}.${field} = ${formatValue(value)};`);
  }
  return lines;
}

export function generateExportSnippet(overrides: Overrides): string {
  const lines: string[] = [HEADER];

  if (overrides.unitDefs) {
    for (const [kind, partial] of Object.entries(overrides.unitDefs)) {
      if (!partial) continue;
      lines.push(...emitFields('UNIT_DEFS', kind, partial as Record<string, unknown>));
    }
  }

  if (overrides.buildingDefs) {
    for (const [kind, partial] of Object.entries(overrides.buildingDefs)) {
      if (!partial) continue;
      lines.push(...emitFields('BUILDING_DEFS', kind, partial as Record<string, unknown>));
    }
  }

  if (overrides.unitProduction) {
    for (const [kind, partial] of Object.entries(overrides.unitProduction)) {
      if (!partial) continue;
      lines.push(...emitFields('UNIT_PRODUCTION', kind, partial as Record<string, unknown>));
    }
  }

  return lines.join('\n');
}
