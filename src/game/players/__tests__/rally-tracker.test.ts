import { describe, expect, it } from 'vitest';

import { RallyTracker } from '../rally-tracker';
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

function ent(
  partial: Partial<ViewEntity> & Pick<ViewEntity, 'id' | 'kind' | 'team'>,
): ViewEntity {
  return {
    pos: { x: 0, y: 0 },
    hp: 60,
    maxHp: 60,
    ...partial,
  };
}

const SELF: 'enemy' = 'enemy';

describe('RallyTracker — cold start + no rallies', () => {
  it('emits no warnings before any rally is recorded', () => {
    const t = new RallyTracker(SELF);
    const out = t.update(makeView());
    expect(out.warnings).toEqual([]);
  });

  it('emits no warnings when a rally is recorded but no deaths occur', () => {
    const t = new RallyTracker(SELF);
    const marine = ent({ id: 5, kind: 'marine', team: SELF, pos: { x: 700, y: 700 } });
    t.update(makeView({ myEntities: [marine] }));
    t.recordRallySet(11, { x: 700, y: 700 }, 0);
    const out = t.update(makeView({ tick: 100, myEntities: [marine] }));
    expect(out.warnings).toEqual([]);
  });
});

describe('RallyTracker — death attribution', () => {
  it('warns when 3 own units die within 5 cells of an active rally inside 60s', () => {
    const t = new RallyTracker(SELF);
    // Three of our marines staged at the rally point.
    const m1 = ent({ id: 5, kind: 'marine', team: SELF, pos: { x: 700, y: 700 } });
    const m2 = ent({ id: 6, kind: 'marine', team: SELF, pos: { x: 710, y: 705 } });
    const m3 = ent({ id: 7, kind: 'marine', team: SELF, pos: { x: 720, y: 710 } });
    t.update(makeView({ myEntities: [m1, m2, m3] }));
    t.recordRallySet(11, { x: 700, y: 700 }, 0);
    // Next call: all three gone (killed by enemy fire).
    const out = t.update(makeView({ tick: 200, myEntities: [] }));
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toContain('Rally at (700, 700)');
    expect(out.warnings[0]).toContain('3 units');
    expect(out.warnings[0]).toContain('relocate');
  });

  it('singularises "1 unit" for a single death', () => {
    const t = new RallyTracker(SELF);
    const m1 = ent({ id: 5, kind: 'marine', team: SELF, pos: { x: 700, y: 700 } });
    t.update(makeView({ myEntities: [m1] }));
    t.recordRallySet(11, { x: 700, y: 700 }, 0);
    const out = t.update(makeView({ tick: 50, myEntities: [] }));
    expect(out.warnings[0]).toContain('1 unit ');
    expect(out.warnings[0]).not.toContain('1 units');
  });

  it('ignores deaths NOT near any rally (event-tracker is responsible there)', () => {
    const t = new RallyTracker(SELF);
    // Rally at one corner of the map.
    t.recordRallySet(11, { x: 100, y: 100 }, 0);
    // Marine far from rally (more than 5 cells = >80px away).
    const farMarine = ent({ id: 5, kind: 'marine', team: SELF, pos: { x: 900, y: 900 } });
    t.update(makeView({ myEntities: [farMarine] }));
    const out = t.update(makeView({ tick: 50, myEntities: [] }));
    // Death happened, but not in rally proximity — no rally warning.
    expect(out.warnings).toEqual([]);
  });

  it('counts only own-team deaths, ignoring enemy deaths in the same area', () => {
    const t = new RallyTracker(SELF);
    t.recordRallySet(11, { x: 700, y: 700 }, 0);
    const myMarine = ent({ id: 5, kind: 'marine', team: SELF, pos: { x: 705, y: 705 } });
    const enemyMarine = ent({
      id: 99,
      kind: 'marine',
      team: 'player',
      pos: { x: 705, y: 705 },
    });
    t.update(makeView({ myEntities: [myMarine], visibleEnemies: [enemyMarine] }));
    // Enemy marine vanishes (we killed it) — must NOT count as "rally cost a unit".
    const out = t.update(
      makeView({ tick: 50, myEntities: [myMarine], visibleEnemies: [] }),
    );
    expect(out.warnings).toEqual([]);
  });

  it('ignores building deaths near a rally (rally-tracker is unit-only)', () => {
    const t = new RallyTracker(SELF);
    t.recordRallySet(11, { x: 700, y: 700 }, 0);
    const depot = ent({ id: 5, kind: 'supplyDepot', team: SELF, pos: { x: 705, y: 705 } });
    t.update(makeView({ myEntities: [depot] }));
    const out = t.update(makeView({ tick: 50, myEntities: [] }));
    expect(out.warnings).toEqual([]);
  });
});

describe('RallyTracker — pruning', () => {
  it('drops a rally older than 60s with zero deaths', () => {
    const t = new RallyTracker(SELF);
    t.recordRallySet(11, { x: 700, y: 700 }, 0);
    // Seed lastView so subsequent diffs work.
    t.update(makeView());
    // 1300 ticks > 1200 (60s @ 20Hz). No deaths ever attributed.
    const out = t.update(makeView({ tick: 1300 }));
    expect(out.warnings).toEqual([]);
    // After this, internal state should be empty — adding a death NEAR the
    // dropped rally must NOT resurrect it (proves the entry was pruned).
    const stillDeadMarine = ent({
      id: 5,
      kind: 'marine',
      team: SELF,
      pos: { x: 705, y: 705 },
    });
    t.update(makeView({ tick: 1400, myEntities: [stillDeadMarine] }));
    const out2 = t.update(makeView({ tick: 1500, myEntities: [] }));
    expect(out2.warnings).toEqual([]);
  });

  it('keeps a rally with deaths past the initial 60s but drops it after another quiet 60s', () => {
    const t = new RallyTracker(SELF);
    t.recordRallySet(11, { x: 700, y: 700 }, 0);
    // First call: marine alive at the rally.
    const m1 = ent({ id: 5, kind: 'marine', team: SELF, pos: { x: 705, y: 705 } });
    t.update(makeView({ myEntities: [m1] }));
    // Tick 100: marine dies near the rally.
    const out1 = t.update(makeView({ tick: 100, myEntities: [] }));
    expect(out1.warnings).toHaveLength(1);
    // Tick 1100 (still <1200 from death): warning persists.
    const out2 = t.update(makeView({ tick: 1100, myEntities: [] }));
    expect(out2.warnings).toHaveLength(1);
    // Tick 1400 (>1200 from death=100): death drops out, no new ones, no warning.
    // The setAtTick was 0, so it's also outside the recently-set window.
    const out3 = t.update(makeView({ tick: 1400, myEntities: [] }));
    expect(out3.warnings).toEqual([]);
  });

  it('a freshly-set rally (within 60s) is kept even with zero deaths', () => {
    const t = new RallyTracker(SELF);
    t.update(makeView({ tick: 0 }));
    t.recordRallySet(11, { x: 700, y: 700 }, 100);
    // 500 ticks after set — still within window, no deaths, no warning, but
    // entry is alive internally (the next death will attribute correctly).
    const out = t.update(makeView({ tick: 600 }));
    expect(out.warnings).toEqual([]);
    // Now a marine dies near the rally.
    const m1 = ent({ id: 5, kind: 'marine', team: SELF, pos: { x: 700, y: 700 } });
    t.update(makeView({ tick: 650, myEntities: [m1] }));
    const out2 = t.update(makeView({ tick: 700, myEntities: [] }));
    expect(out2.warnings).toHaveLength(1);
  });
});

describe('RallyTracker — multiple rallies + overwrite', () => {
  it('emits one warning per bleeding rally', () => {
    const t = new RallyTracker(SELF);
    t.recordRallySet(11, { x: 200, y: 200 }, 0);
    t.recordRallySet(12, { x: 800, y: 800 }, 0);
    const m1 = ent({ id: 5, kind: 'marine', team: SELF, pos: { x: 205, y: 205 } });
    const m2 = ent({ id: 6, kind: 'marine', team: SELF, pos: { x: 805, y: 805 } });
    t.update(makeView({ myEntities: [m1, m2] }));
    const out = t.update(makeView({ tick: 50, myEntities: [] }));
    expect(out.warnings).toHaveLength(2);
    const joined = out.warnings.join('\n');
    expect(joined).toContain('(200, 200)');
    expect(joined).toContain('(800, 800)');
  });

  it('overwriting a rally on the same building resets its death tally', () => {
    const t = new RallyTracker(SELF);
    t.recordRallySet(11, { x: 700, y: 700 }, 0);
    const m1 = ent({ id: 5, kind: 'marine', team: SELF, pos: { x: 700, y: 700 } });
    t.update(makeView({ myEntities: [m1] }));
    const out1 = t.update(makeView({ tick: 50, myEntities: [] }));
    expect(out1.warnings).toHaveLength(1);
    // LLM moves the rally somewhere safe — fresh slate at the new pos.
    t.recordRallySet(11, { x: 100, y: 100 }, 60);
    const out2 = t.update(makeView({ tick: 100 }));
    expect(out2.warnings).toEqual([]);
  });
});
