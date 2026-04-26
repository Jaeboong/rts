import { describe, expect, it } from 'vitest';

import { EventTracker } from '../event-tracker';
import type { GameView, ViewEntity } from '../types';

function makeView(overrides: Partial<GameView> = {}): GameView {
  return {
    tick: 0,
    resources: { minerals: 500, gas: 0 },
    myEntities: [],
    visibleEnemies: [],
    visibleResources: [],
    mapInfo: { w: 128, h: 128, cellPx: 16 },
    ...overrides,
  };
}

function ent(partial: Partial<ViewEntity> & Pick<ViewEntity, 'id' | 'kind' | 'team'>): ViewEntity {
  return {
    pos: { x: 0, y: 0 },
    hp: 40,
    maxHp: 40,
    ...partial,
  };
}

// LLM is the 'enemy' team in rts2 — keep tests aligned with production usage.
const SELF: 'enemy' = 'enemy';

// Place CC at cell (10,10), pixel center (12*16, 12*16) = (192, 192) for a
// 4×4 footprint. Provided as a helper so movement classification has a target.
function ownCC(): ViewEntity {
  return ent({
    id: 1,
    kind: 'commandCenter',
    team: SELF,
    pos: { x: 160, y: 160 },
    cellX: 10,
    cellY: 10,
    hp: 1000,
    maxHp: 1000,
  });
}

describe('EventTracker — cold start', () => {
  it('returns "no events" on the very first update', () => {
    const t = new EventTracker(SELF);
    const out = t.update(
      makeView({
        myEntities: [ownCC(), ent({ id: 5, kind: 'marine', team: SELF, pos: { x: 100, y: 100 } })],
      }),
    );
    expect(out.brief).toBe('no events');
    expect(out.detailed).toBeUndefined();
  });
});

describe('EventTracker — death detection (my units)', () => {
  it('counts and reports deaths of own units between two views', () => {
    const t = new EventTracker(SELF);
    const cc = ownCC();
    const m1 = ent({
      id: 5,
      kind: 'marine',
      team: SELF,
      pos: { x: 600, y: 700 },
      cellX: 37,
      cellY: 43,
    });
    t.update(makeView({ myEntities: [cc, m1] }));
    const out = t.update(makeView({ tick: 10, myEntities: [cc] }));
    // Brief should mention -1 marine at the dead marine's last cell (37,43).
    expect(out.brief).toContain('-1 marine (37,43)');
  });

  it('groups deaths of the same kind and pluralizes', () => {
    const t = new EventTracker(SELF);
    const cc = ownCC();
    const m1 = ent({ id: 5, kind: 'marine', team: SELF, cellX: 30, cellY: 30, pos: { x: 480, y: 480 } });
    const m2 = ent({ id: 6, kind: 'marine', team: SELF, cellX: 31, cellY: 31, pos: { x: 496, y: 496 } });
    t.update(makeView({ myEntities: [cc, m1, m2] }));
    const out = t.update(makeView({ tick: 5, myEntities: [cc] }));
    expect(out.brief).toContain('-2 marines');
  });
});

describe('EventTracker — kill detection', () => {
  it('counts kills when an enemy entity disappears', () => {
    const t = new EventTracker(SELF);
    const cc = ownCC();
    const enemyMarine = ent({ id: 99, kind: 'marine', team: 'player', cellX: 50, cellY: 50, pos: { x: 800, y: 800 } });
    t.update(makeView({ myEntities: [cc], visibleEnemies: [enemyMarine] }));
    const out = t.update(makeView({ tick: 5, myEntities: [cc], visibleEnemies: [] }));
    expect(out.brief).toContain('+1 kill');
  });
});

describe('EventTracker — attribution via lastDamageBy', () => {
  it('attributes a kill to the attacker found in the previous view (detailed report)', () => {
    const t = new EventTracker(SELF, { detailedIntervalTicks: 0 });
    const cc = ownCC();
    const myMarine = ent({
      id: 50,
      kind: 'marine',
      team: SELF,
      pos: { x: 400, y: 400 },
      cellX: 25,
      cellY: 25,
    });
    const enemyMarine = ent({
      id: 99,
      kind: 'marine',
      team: 'player',
      pos: { x: 416, y: 400 },
      cellX: 26,
      cellY: 25,
      lastDamageBy: 50,
    });
    // Frame 1: both alive.
    t.update(makeView({ myEntities: [cc, myMarine], visibleEnemies: [enemyMarine] }));
    // Frame 2: enemy dead — should attribute to my marine #50.
    const out = t.update(
      makeView({ tick: 5, myEntities: [cc, myMarine], visibleEnemies: [] }),
    );
    expect(out.detailed).toBeDefined();
    expect(out.detailed).toContain('Enemy marine #99 died at (26,25)');
    expect(out.detailed).toContain('killed by marine #50');
  });

  it('attributes a death of my unit to the enemy attacker (detailed report)', () => {
    const t = new EventTracker(SELF, { detailedIntervalTicks: 0 });
    const cc = ownCC();
    const myMarine = ent({
      id: 50,
      kind: 'marine',
      team: SELF,
      pos: { x: 400, y: 400 },
      cellX: 25,
      cellY: 25,
      lastDamageBy: 88,
    });
    const enemyDummy = ent({
      id: 88,
      kind: 'enemyDummy',
      team: 'player',
      pos: { x: 416, y: 400 },
      cellX: 26,
      cellY: 25,
    });
    t.update(makeView({ myEntities: [cc, myMarine], visibleEnemies: [enemyDummy] }));
    const out = t.update(
      makeView({ tick: 5, myEntities: [cc], visibleEnemies: [enemyDummy] }),
    );
    expect(out.detailed).toBeDefined();
    expect(out.detailed).toContain('My marine #50 died at (25,25)');
    expect(out.detailed).toContain('killed by enemyDummy #88');
  });

  it('falls back to "killed by unknown" when lastDamageBy is missing', () => {
    const t = new EventTracker(SELF, { detailedIntervalTicks: 0 });
    const cc = ownCC();
    const myMarine = ent({
      id: 50,
      kind: 'marine',
      team: SELF,
      cellX: 25,
      cellY: 25,
      pos: { x: 400, y: 400 },
    });
    t.update(makeView({ myEntities: [cc, myMarine] }));
    const out = t.update(makeView({ tick: 5, myEntities: [cc] }));
    expect(out.detailed).toContain('killed by unknown');
  });

  it('still attributes when the attacker also died this frame (lookup uses lastView)', () => {
    const t = new EventTracker(SELF, { detailedIntervalTicks: 0 });
    const cc = ownCC();
    const myMarine = ent({
      id: 50,
      kind: 'marine',
      team: SELF,
      cellX: 25,
      cellY: 25,
      pos: { x: 400, y: 400 },
      lastDamageBy: 88,
    });
    const enemyDummy = ent({
      id: 88,
      kind: 'enemyDummy',
      team: 'player',
      cellX: 26,
      cellY: 25,
      pos: { x: 416, y: 400 },
      lastDamageBy: 50,
    });
    t.update(makeView({ myEntities: [cc, myMarine], visibleEnemies: [enemyDummy] }));
    // Both gone in next view (mutual kill).
    const out = t.update(makeView({ tick: 5, myEntities: [cc] }));
    expect(out.detailed).toContain('My marine #50 died at (25,25) — killed by enemyDummy #88');
    expect(out.detailed).toContain('Enemy enemyDummy #88 died at (26,25) — killed by marine #50');
  });
});

describe('EventTracker — advance / retreat classification', () => {
  it('classifies an enemy moving toward CC as "advancing"', () => {
    const t = new EventTracker(SELF, { detailedIntervalTicks: 0 });
    const cc = ownCC(); // CC center ≈ (192, 192)
    // Enemy starts at (800,800) and walks 5 samples toward CC.
    const positions = [
      { x: 800, y: 800 },
      { x: 700, y: 700 },
      { x: 600, y: 600 },
      { x: 500, y: 500 },
      { x: 400, y: 400 },
    ];
    let detailed: string | undefined;
    for (let i = 0; i < positions.length; i++) {
      const enemy = ent({
        id: 99,
        kind: 'marine',
        team: 'player',
        pos: positions[i],
        cellX: Math.floor(positions[i].x / 16),
        cellY: Math.floor(positions[i].y / 16),
      });
      const out = t.update(
        makeView({ tick: i, myEntities: [cc], visibleEnemies: [enemy] }),
      );
      if (out.detailed) detailed = out.detailed;
    }
    expect(detailed).toBeDefined();
    expect(detailed).toContain('1 advancing');
  });

  it('classifies an enemy moving away from CC as "retreating"', () => {
    const t = new EventTracker(SELF, { detailedIntervalTicks: 0 });
    const cc = ownCC();
    const positions = [
      { x: 300, y: 300 },
      { x: 400, y: 400 },
      { x: 500, y: 500 },
      { x: 600, y: 600 },
      { x: 700, y: 700 },
    ];
    let detailed: string | undefined;
    for (let i = 0; i < positions.length; i++) {
      const enemy = ent({
        id: 99,
        kind: 'marine',
        team: 'player',
        pos: positions[i],
        cellX: Math.floor(positions[i].x / 16),
        cellY: Math.floor(positions[i].y / 16),
      });
      const out = t.update(
        makeView({ tick: i, myEntities: [cc], visibleEnemies: [enemy] }),
      );
      if (out.detailed) detailed = out.detailed;
    }
    expect(detailed).toBeDefined();
    expect(detailed).toContain('1 retreating');
  });

  it('classifies a stationary enemy as "static"', () => {
    const t = new EventTracker(SELF, { detailedIntervalTicks: 0 });
    const cc = ownCC();
    let detailed: string | undefined;
    for (let i = 0; i < 5; i++) {
      const enemy = ent({
        id: 99,
        kind: 'marine',
        team: 'player',
        pos: { x: 800, y: 800 },
        cellX: 50,
        cellY: 50,
      });
      const out = t.update(
        makeView({ tick: i, myEntities: [cc], visibleEnemies: [enemy] }),
      );
      if (out.detailed) detailed = out.detailed;
    }
    expect(detailed).toBeDefined();
    expect(detailed).toContain('1 static');
  });
});

describe('EventTracker — 30s gating', () => {
  it('does not emit detailed before detailedIntervalTicks elapsed', () => {
    const t = new EventTracker(SELF, { detailedIntervalTicks: 600 });
    const cc = ownCC();
    t.update(makeView({ tick: 0, myEntities: [cc] }));
    // 599 ticks later — gate not yet open.
    const out = t.update(makeView({ tick: 599, myEntities: [cc] }));
    expect(out.detailed).toBeUndefined();
  });

  it('emits detailed exactly when detailedIntervalTicks elapsed', () => {
    const t = new EventTracker(SELF, { detailedIntervalTicks: 600 });
    const cc = ownCC();
    t.update(makeView({ tick: 0, myEntities: [cc] }));
    const out = t.update(makeView({ tick: 600, myEntities: [cc] }));
    expect(out.detailed).toBeDefined();
  });

  it('after a detailed emit, withholds the next detailed until interval elapses again', () => {
    const t = new EventTracker(SELF, { detailedIntervalTicks: 600 });
    const cc = ownCC();
    t.update(makeView({ tick: 0, myEntities: [cc] }));
    const first = t.update(makeView({ tick: 600, myEntities: [cc] }));
    expect(first.detailed).toBeDefined();
    const middle = t.update(makeView({ tick: 800, myEntities: [cc] }));
    expect(middle.detailed).toBeUndefined();
    const second = t.update(makeView({ tick: 1200, myEntities: [cc] }));
    expect(second.detailed).toBeDefined();
  });
});

describe('EventTracker — fallback when own CC is missing', () => {
  it('does not crash when LLM has lost its CC and emits a degraded detailed report', () => {
    const t = new EventTracker(SELF, { detailedIntervalTicks: 0 });
    // First view: no CC at all (player lost it before any LLM call).
    const enemy = ent({
      id: 99,
      kind: 'marine',
      team: 'player',
      pos: { x: 400, y: 400 },
      cellX: 25,
      cellY: 25,
    });
    t.update(makeView({ visibleEnemies: [enemy] }));
    const enemy2 = ent({
      id: 99,
      kind: 'marine',
      team: 'player',
      pos: { x: 300, y: 300 },
      cellX: 18,
      cellY: 18,
    });
    const out = t.update(makeView({ tick: 5, visibleEnemies: [enemy2] }));
    expect(out.detailed).toBeDefined();
    expect(out.detailed).toContain('no CC reference');
  });

  it('brief omits "near base" when there is no CC', () => {
    const t = new EventTracker(SELF);
    const enemy = ent({
      id: 99,
      kind: 'marine',
      team: 'player',
      pos: { x: 400, y: 400 },
      cellX: 25,
      cellY: 25,
    });
    t.update(makeView({ visibleEnemies: [enemy] }));
    const out = t.update(makeView({ tick: 5, visibleEnemies: [enemy] }));
    // No deaths, no kills, no CC → no "near base" notice.
    expect(out.brief).toBe('no events');
  });
});

describe('EventTracker — brief length', () => {
  it('keeps the brief one line', () => {
    const t = new EventTracker(SELF);
    const cc = ownCC();
    const m1 = ent({ id: 5, kind: 'marine', team: SELF, cellX: 30, cellY: 30, pos: { x: 480, y: 480 } });
    const m2 = ent({ id: 6, kind: 'marine', team: SELF, cellX: 31, cellY: 31, pos: { x: 496, y: 496 } });
    const enemy = ent({
      id: 99,
      kind: 'enemyDummy',
      team: 'player',
      cellX: 50,
      cellY: 50,
      pos: { x: 800, y: 800 },
    });
    t.update(makeView({ myEntities: [cc, m1, m2], visibleEnemies: [enemy] }));
    const out = t.update(
      makeView({
        tick: 5,
        myEntities: [cc],
        visibleEnemies: [],
      }),
    );
    expect(out.brief.includes('\n')).toBe(false);
    // Realistic scenario fits under 80 chars.
    expect(out.brief.length).toBeLessThanOrEqual(80);
  });
});

describe('EventTracker — visible enemies aggregate in detailed', () => {
  it('lists kinds and movement breakdown', () => {
    const t = new EventTracker(SELF, { detailedIntervalTicks: 0 });
    const cc = ownCC();
    // Walk two enemies inward across multiple frames so they classify as advancing.
    const make = (id: number, kind: string, pos: { x: number; y: number }): ViewEntity =>
      ent({
        id,
        kind,
        team: 'player',
        pos,
        cellX: Math.floor(pos.x / 16),
        cellY: Math.floor(pos.y / 16),
      });
    const positions: { x: number; y: number }[] = [
      { x: 800, y: 800 },
      { x: 700, y: 700 },
      { x: 600, y: 600 },
      { x: 500, y: 500 },
      { x: 400, y: 400 },
    ];
    let detailed: string | undefined;
    for (let i = 0; i < positions.length; i++) {
      const out = t.update(
        makeView({
          tick: i,
          myEntities: [cc],
          visibleEnemies: [
            make(99, 'marine', positions[i]),
            make(100, 'marine', { x: positions[i].x + 50, y: positions[i].y + 50 }),
          ],
        }),
      );
      if (out.detailed) detailed = out.detailed;
    }
    expect(detailed).toBeDefined();
    expect(detailed).toContain('Visible enemies: 2 marines');
    expect(detailed).toContain('2 advancing');
  });

  it('reports "Visible enemies: none" when nothing is visible', () => {
    const t = new EventTracker(SELF, { detailedIntervalTicks: 0 });
    const cc = ownCC();
    t.update(makeView({ myEntities: [cc] }));
    const out = t.update(makeView({ tick: 5, myEntities: [cc] }));
    expect(out.detailed).toContain('Visible enemies: none');
  });
});
