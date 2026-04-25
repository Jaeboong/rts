import { describe, expect, it } from 'vitest';
import { generateExportSnippet } from './export';

describe('admin/export', () => {
  it('empty overrides → header only', () => {
    const snippet = generateExportSnippet({});
    expect(snippet.split('\n')).toEqual(['// Paste into src/game/balance.ts:']);
  });

  it('single unit override → single assignment line', () => {
    const snippet = generateExportSnippet({ unitDefs: { marine: { hp: 80 } } });
    expect(snippet).toContain('UNIT_DEFS.marine.hp = 80;');
    expect(snippet.split('\n').filter((l) => !l.startsWith('//'))).toEqual([
      'UNIT_DEFS.marine.hp = 80;',
    ]);
  });

  it('mixed unit + building + production → properly grouped', () => {
    const snippet = generateExportSnippet({
      unitDefs: { marine: { hp: 80, attackInterval: 0.8 } },
      buildingDefs: { barracks: { hp: 1200 } },
      unitProduction: { worker: { cost: 60 } },
    });
    const lines = snippet.split('\n').filter((l) => !l.startsWith('//'));
    expect(lines).toContain('UNIT_DEFS.marine.hp = 80;');
    expect(lines).toContain('UNIT_DEFS.marine.attackInterval = 0.8;');
    expect(lines).toContain('BUILDING_DEFS.barracks.hp = 1200;');
    expect(lines).toContain('UNIT_PRODUCTION.worker.cost = 60;');
    expect(lines.length).toBe(4);
  });

  it('quotes string values (e.g. producer)', () => {
    const snippet = generateExportSnippet({
      unitProduction: { marine: { producer: 'commandCenter' } },
    });
    expect(snippet).toContain('UNIT_PRODUCTION.marine.producer = "commandCenter";');
  });

  it('preamble references balance.ts (where defs live in this codebase)', () => {
    const snippet = generateExportSnippet({});
    expect(snippet).toContain('src/game/balance.ts');
  });
});
