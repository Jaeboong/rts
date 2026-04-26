import { describe, expect, it } from 'vitest';

import {
  formatCommand,
  formatEntityRef,
  formatIdList,
  formatLatency,
  formatRecentEvents,
  padTypeColumn,
  parseDisplayCommands,
} from '../ai-inspector-format';

const ZERO_RESOLVER = (): string | null => null;

const TEST_RESOLVER = new Map<number, string>([
  [41, 'barracks'],
  [68, 'barracks'],
  [104, 'worker'],
  [200, 'mineralNode'],
]);
const lookup = (id: number): string | null => TEST_RESOLVER.get(id) ?? null;

describe('parseDisplayCommands', () => {
  it('returns kind:empty for an empty array', () => {
    const out = parseDisplayCommands('[]', ZERO_RESOLVER);
    expect(out.kind).toBe('empty');
  });

  it('returns kind:unparseable for malformed JSON', () => {
    const out = parseDisplayCommands('{not json', ZERO_RESOLVER);
    expect(out.kind).toBe('unparseable');
    if (out.kind === 'unparseable') {
      expect(out.raw).toContain('{not json');
    }
  });

  it('returns kind:unparseable when JSON is not an array', () => {
    const out = parseDisplayCommands('{"type":"produce"}', ZERO_RESOLVER);
    expect(out.kind).toBe('unparseable');
  });

  it('strips a markdown ```json fence before parsing', () => {
    const out = parseDisplayCommands(
      '```json\n[{"type":"produce","buildingId":68,"unit":"tank"}]\n```',
      lookup,
    );
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.commands).toHaveLength(1);
      expect(out.commands[0].type).toBe('produce');
    }
  });

  it('parses the two-command exchange from the task spec', () => {
    const raw =
      '[{"type":"produce","buildingId":68,"unit":"tank"},{"type":"setRally","buildingId":41,"pos":{"x":664,"y":1064}}]';
    const out = parseDisplayCommands(raw, lookup);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(out.commands).toHaveLength(2);
    expect(out.commands[0].type).toBe('produce');
    expect(out.commands[0].body).toContain('TANK');
    expect(out.commands[0].body).toContain('barracks#68');
    expect(out.commands[1].type).toBe('setRally');
    expect(out.commands[1].body).toContain('barracks#41');
    expect(out.commands[1].body).toContain('(664, 1064)');
  });
});

describe('formatCommand — per command shape', () => {
  it('produce: unit name uppercased + building ref', () => {
    const c = formatCommand({ type: 'produce', buildingId: 68, unit: 'tank' }, lookup);
    expect(c.type).toBe('produce');
    expect(c.color).toBe('create');
    expect(c.body).toMatch(/TANK\s+@ barracks#68/);
  });

  it('build: building name + cell coords + worker ref', () => {
    const c = formatCommand(
      { type: 'build', workerId: 104, building: 'supplyDepot', cellX: 123, cellY: 19 },
      lookup,
    );
    expect(c.type).toBe('build');
    expect(c.color).toBe('create');
    // camelCase enum is humanized into separate words for the panel.
    expect(c.body).toContain('SUPPLY DEPOT');
    expect(c.body).toContain('(123, 19)');
    expect(c.body).toContain('worker#104');
  });

  it('produce: kebab-case unit name is humanized too (tank-light -> TANK LIGHT)', () => {
    const c = formatCommand(
      { type: 'produce', buildingId: 41, unit: 'tank-light' },
      lookup,
    );
    expect(c.body).toContain('TANK LIGHT');
  });

  it('setRally: building ref + px coords from pos', () => {
    const c = formatCommand(
      { type: 'setRally', buildingId: 41, pos: { x: 664, y: 1064 } },
      lookup,
    );
    expect(c.color).toBe('move');
    expect(c.body).toBe('barracks#41 -> (664, 1064)');
  });

  it('move: id list + px coords from target', () => {
    const c = formatCommand(
      { type: 'move', unitIds: [12, 34, 56], target: { x: 200, y: 300 } },
      lookup,
    );
    expect(c.type).toBe('move');
    expect(c.color).toBe('move');
    expect(c.body).toBe('unitIds#[12,34,56] -> (200, 300)');
  });

  it('attackMove: id list + px coords + attack color', () => {
    const c = formatCommand(
      { type: 'attackMove', unitIds: [7], target: { x: 1, y: 2 } },
      lookup,
    );
    expect(c.color).toBe('attack');
    expect(c.body).toBe('unitIds#[7] -> (1, 2)');
  });

  it('attack: id list -> resolved target', () => {
    const c = formatCommand(
      { type: 'attack', unitIds: [12, 34], targetId: 200 },
      lookup,
    );
    expect(c.color).toBe('attack');
    expect(c.body).toBe('unitIds#[12,34] -> mineralNode#200');
  });

  it('gather: workers label + node ref + idle color', () => {
    const c = formatCommand(
      { type: 'gather', unitIds: [1, 2], nodeId: 200 },
      lookup,
    );
    expect(c.color).toBe('idle');
    expect(c.body).toContain('workers#[1,2]');
    expect(c.body).toContain('mineralNode#200');
  });

  it('cancel: single ref, idle color', () => {
    const c = formatCommand({ type: 'cancel', entityId: 41 }, lookup);
    expect(c.color).toBe('idle');
    expect(c.body).toBe('barracks#41');
  });

  it('renders unknown type as ? row', () => {
    const c = formatCommand({ type: 'wiggle' }, lookup);
    expect(c.type).toBe('?');
    expect(c.color).toBe('unknown');
  });

  it('renders non-object as ? row', () => {
    const c = formatCommand('garbage', lookup);
    expect(c.type).toBe('?');
  });

  it('falls back gracefully when buildingId is missing', () => {
    const c = formatCommand({ type: 'produce', unit: 'marine' }, lookup);
    expect(c.body).toContain('building#?');
  });
});

describe('formatIdList', () => {
  it('inlines up to 4 ids', () => {
    expect(formatIdList([1, 2, 3, 4], 'unitIds')).toBe('unitIds#[1,2,3,4]');
  });

  it('truncates with count > 4 ids', () => {
    expect(formatIdList([1, 2, 3, 4, 5, 6, 7, 8], 'unitIds')).toBe(
      'unitIds#[1,2,3,4,...] (8)',
    );
  });

  it('renders empty list with placeholder so the line still reads', () => {
    expect(formatIdList([], 'unitIds')).toBe('unitIds#[]');
  });
});

describe('formatEntityRef', () => {
  it('uses resolved kind when available', () => {
    expect(formatEntityRef(41, lookup, 'building')).toBe('barracks#41');
  });

  it('falls back to label when resolver returns null', () => {
    expect(formatEntityRef(999, lookup, 'building')).toBe('building#999');
  });

  it('renders "?" id when input is null', () => {
    expect(formatEntityRef(null, lookup, 'worker')).toBe('worker#?');
  });
});

describe('padTypeColumn', () => {
  it('pads each type to the longest length in the batch', () => {
    const padded = padTypeColumn([
      { type: 'move', body: '', color: 'move' },
      { type: 'produce', body: '', color: 'create' },
      { type: 'build', body: '', color: 'create' },
    ]);
    expect(padded[0]).toBe('move   ');
    expect(padded[1]).toBe('produce');
    expect(padded[2]).toBe('build  ');
  });

  it('returns empty for empty input', () => {
    expect(padTypeColumn([])).toEqual([]);
  });
});

describe('formatLatency', () => {
  it('renders seconds with 1 decimal', () => {
    expect(formatLatency(1000, 21200)).toBe('20.2s');
  });

  it('renders … when respondedAtMs is null', () => {
    expect(formatLatency(1000, null)).toBe('…');
  });
});

describe('formatRecentEvents', () => {
  it('returns [] when input is null/undefined/empty/no-events', () => {
    expect(formatRecentEvents(null)).toEqual([]);
    expect(formatRecentEvents(undefined)).toEqual([]);
    expect(formatRecentEvents('')).toEqual([]);
    expect(formatRecentEvents('no events')).toEqual([]);
  });

  it('decorates death tokens with a death emoji', () => {
    const out = formatRecentEvents('-2 medics (73,70) -1 tank-light (87,47)');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('-2 medics');
    expect(out[0].codePointAt(0)).toBe(0x1f480);
  });

  it('decorates kill tokens with crossed-swords', () => {
    const out = formatRecentEvents('+6 kills');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('+6 kills');
  });

  it('splits comma-separated event groups into separate lines', () => {
    const out = formatRecentEvents(
      '-2 medics (73,70), +6 kills, 3 hostiles near base',
    );
    expect(out).toHaveLength(3);
  });
});
