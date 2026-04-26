import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseCommands } from '../parser';
import type { GameView, ViewEntity } from '../types';

function ve(id: number, kind: string, partial: Partial<ViewEntity> = {}): ViewEntity {
  return {
    id,
    kind,
    team: 'enemy',
    pos: { x: 0, y: 0 },
    hp: 100,
    maxHp: 100,
    ...partial,
  };
}

function makeView(overrides: Partial<GameView> = {}): GameView {
  return {
    tick: 0,
    resources: { minerals: 500, gas: 0 },
    myEntities: [
      ve(1, 'worker'),
      ve(2, 'marine'),
      ve(50, 'barracks', { cellX: 10, cellY: 10 }),
    ],
    visibleEnemies: [ve(99, 'enemyDummy', { team: 'player' })],
    visibleResources: [ve(200, 'mineralNode', { team: 'neutral', cellX: 30, cellY: 30 })],
    mapInfo: { w: 128, h: 128, cellPx: 16 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('parseCommands — fence stripping', () => {
  it('strips ```json ... ``` fence', () => {
    const raw = '```json\n[{"type":"move","unitIds":[1],"target":{"x":100,"y":200}}]\n```';
    const cmds = parseCommands(raw, makeView());
    expect(cmds).toEqual([
      { type: 'move', unitIds: [1], target: { x: 100, y: 200 } },
    ]);
  });

  it('strips bare ``` ... ``` fence', () => {
    const raw = '```\n[{"type":"move","unitIds":[1],"target":{"x":50,"y":50}}]\n```';
    const cmds = parseCommands(raw, makeView());
    expect(cmds).toHaveLength(1);
    expect(cmds[0].type).toBe('move');
  });

  it('parses without fence', () => {
    const raw = '[{"type":"move","unitIds":[1],"target":{"x":50,"y":50}}]';
    const cmds = parseCommands(raw, makeView());
    expect(cmds).toHaveLength(1);
  });

  it('trims surrounding whitespace', () => {
    const raw = '\n\n  [{"type":"move","unitIds":[1],"target":{"x":50,"y":50}}]  \n\n';
    expect(parseCommands(raw, makeView())).toHaveLength(1);
  });
});

describe('parseCommands — invalid input', () => {
  it('returns [] on invalid JSON', () => {
    expect(parseCommands('not json', makeView())).toEqual([]);
    expect(parseCommands('[{type:move}', makeView())).toEqual([]);
  });

  it('returns [] when JSON parses to non-array', () => {
    expect(parseCommands('{"type":"move"}', makeView())).toEqual([]);
    expect(parseCommands('"hi"', makeView())).toEqual([]);
    expect(parseCommands('null', makeView())).toEqual([]);
  });

  it('skips items that are not objects', () => {
    const raw = '[1, "string", null, {"type":"move","unitIds":[1],"target":{"x":1,"y":1}}]';
    const cmds = parseCommands(raw, makeView());
    expect(cmds).toHaveLength(1);
  });

  it('skips items with unknown type', () => {
    const raw = '[{"type":"explode","unitIds":[1]}]';
    expect(parseCommands(raw, makeView())).toEqual([]);
  });
});

describe('parseCommands — stale / cross-team entity IDs', () => {
  it('skips move whose unitIds are not in myEntities', () => {
    const raw = '[{"type":"move","unitIds":[999],"target":{"x":1,"y":1}}]';
    expect(parseCommands(raw, makeView())).toEqual([]);
  });

  it('filters out the bad ids but keeps valid ones in the same command', () => {
    const raw = '[{"type":"move","unitIds":[1,999,2],"target":{"x":1,"y":1}}]';
    const cmds = parseCommands(raw, makeView());
    expect(cmds).toEqual([
      { type: 'move', unitIds: [1, 2], target: { x: 1, y: 1 } },
    ]);
  });

  it('skips attack with unknown targetId', () => {
    const raw = '[{"type":"attack","unitIds":[2],"targetId":12345}]';
    expect(parseCommands(raw, makeView())).toEqual([]);
  });

  it('skips attack targeting a friendly building (must be in visibleEnemies)', () => {
    const raw = '[{"type":"attack","unitIds":[2],"targetId":50}]';
    expect(parseCommands(raw, makeView())).toEqual([]);
  });

  it('skips gather with non-worker unitIds', () => {
    const raw = '[{"type":"gather","unitIds":[2],"nodeId":200}]';
    expect(parseCommands(raw, makeView())).toEqual([]);
  });

  it('skips gather with unknown nodeId', () => {
    const raw = '[{"type":"gather","unitIds":[1],"nodeId":7777}]';
    expect(parseCommands(raw, makeView())).toEqual([]);
  });

  it('skips build with non-worker workerId', () => {
    const raw = '[{"type":"build","workerId":2,"building":"barracks","cellX":1,"cellY":1}]';
    expect(parseCommands(raw, makeView())).toEqual([]);
  });

  it('skips build with unknown building kind', () => {
    const raw = '[{"type":"build","workerId":1,"building":"deathstar","cellX":1,"cellY":1}]';
    expect(parseCommands(raw, makeView())).toEqual([]);
  });

  it('skips produce when buildingId is not a building owned by us', () => {
    const raw = '[{"type":"produce","buildingId":1,"unit":"marine"}]';
    expect(parseCommands(raw, makeView())).toEqual([]);
  });

  it('skips produce with unknown unit kind', () => {
    const raw = '[{"type":"produce","buildingId":50,"unit":"battlecruiser"}]';
    expect(parseCommands(raw, makeView())).toEqual([]);
  });

  it('skips cancel for entityId not owned', () => {
    const raw = '[{"type":"cancel","entityId":99}]';
    expect(parseCommands(raw, makeView())).toEqual([]);
  });
});

describe('parseCommands — happy path coverage of all 8 command types', () => {
  it('parses move', () => {
    const cmds = parseCommands(
      '[{"type":"move","unitIds":[1,2],"target":{"x":100,"y":200}}]',
      makeView(),
    );
    expect(cmds).toEqual([
      { type: 'move', unitIds: [1, 2], target: { x: 100, y: 200 } },
    ]);
  });

  it('parses attackMove', () => {
    const cmds = parseCommands(
      '[{"type":"attackMove","unitIds":[2],"target":{"x":50,"y":50}}]',
      makeView(),
    );
    expect(cmds).toEqual([
      { type: 'attackMove', unitIds: [2], target: { x: 50, y: 50 } },
    ]);
  });

  it('parses attack', () => {
    const cmds = parseCommands(
      '[{"type":"attack","unitIds":[2],"targetId":99}]',
      makeView(),
    );
    expect(cmds).toEqual([
      { type: 'attack', unitIds: [2], targetId: 99 },
    ]);
  });

  it('parses gather', () => {
    const cmds = parseCommands(
      '[{"type":"gather","unitIds":[1],"nodeId":200}]',
      makeView(),
    );
    expect(cmds).toEqual([
      { type: 'gather', unitIds: [1], nodeId: 200 },
    ]);
  });

  it('parses build', () => {
    const cmds = parseCommands(
      '[{"type":"build","workerId":1,"building":"barracks","cellX":20,"cellY":20}]',
      makeView(),
    );
    expect(cmds).toEqual([
      {
        type: 'build',
        workerId: 1,
        building: 'barracks',
        cellX: 20,
        cellY: 20,
      },
    ]);
  });

  it('parses produce', () => {
    const cmds = parseCommands(
      '[{"type":"produce","buildingId":50,"unit":"marine"}]',
      makeView(),
    );
    expect(cmds).toEqual([
      { type: 'produce', buildingId: 50, unit: 'marine' },
    ]);
  });

  it('parses setRally', () => {
    const cmds = parseCommands(
      '[{"type":"setRally","buildingId":50,"pos":{"x":300,"y":300}}]',
      makeView(),
    );
    expect(cmds).toEqual([
      { type: 'setRally', buildingId: 50, pos: { x: 300, y: 300 } },
    ]);
  });

  it('parses cancel', () => {
    const cmds = parseCommands(
      '[{"type":"cancel","entityId":50}]',
      makeView(),
    );
    expect(cmds).toEqual([{ type: 'cancel', entityId: 50 }]);
  });
});

describe('parseCommands — Vec2 / id primitive guards', () => {
  it('rejects non-numeric id', () => {
    const raw = '[{"type":"move","unitIds":["1"],"target":{"x":1,"y":1}}]';
    expect(parseCommands(raw, makeView())).toEqual([]);
  });

  it('rejects target with NaN', () => {
    const raw = '[{"type":"move","unitIds":[1],"target":{"x":null,"y":1}}]';
    expect(parseCommands(raw, makeView())).toEqual([]);
  });

  it('rejects build with non-integer cellX', () => {
    const raw = '[{"type":"build","workerId":1,"building":"barracks","cellX":1.5,"cellY":1}]';
    expect(parseCommands(raw, makeView())).toEqual([]);
  });
});
