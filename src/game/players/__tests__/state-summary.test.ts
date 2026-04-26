import { describe, expect, it } from 'vitest';

import { formatStateSummary, summarizeState } from '../state-summary';
import type { GameView, ViewEntity } from '../types';

function ve(id: number, kind: string, partial: Partial<ViewEntity> = {}): ViewEntity {
  return {
    id,
    kind,
    team: 'enemy',
    pos: { x: 0, y: 0 },
    hp: 50,
    maxHp: 50,
    ...partial,
  };
}

function makeView(overrides: Partial<GameView> = {}): GameView {
  return {
    tick: 0,
    resources: { minerals: 0, gas: 0 },
    myEntities: [],
    visibleEnemies: [],
    visibleResources: [],
    mapInfo: { w: 128, h: 128, cellPx: 16 },
    ...overrides,
  };
}

describe('summarizeState — counts', () => {
  it('returns zeros on empty view', () => {
    const s = summarizeState(makeView());
    expect(s.minerals).toBe(0);
    expect(s.workers.total).toBe(0);
    expect(s.army.total).toBe(0);
    expect(s.buildings.commandCenters).toBe(0);
    expect(s.threats.combatUnits).toBe(0);
    expect(s.visibleEnemies.total).toBe(0);
  });

  it('partitions workers by command type', () => {
    const view = makeView({
      myEntities: [
        ve(1, 'worker', { commandType: 'gather' }),
        ve(2, 'worker', { commandType: 'gather' }),
        ve(3, 'worker', { commandType: 'build' }),
        ve(4, 'worker'), // no command → idle
        ve(5, 'worker'), // idle
      ],
    });
    const s = summarizeState(view);
    expect(s.workers.total).toBe(5);
    expect(s.workers.gathering).toBe(2);
    expect(s.workers.building).toBe(1);
    expect(s.workers.idle).toBe(2);
    expect(s.workers.idleIds).toEqual([4, 5]);
  });

  it('caps idleIds at 5 and sorts ascending', () => {
    const view = makeView({
      myEntities: [
        ve(50, 'worker'),
        ve(40, 'worker'),
        ve(30, 'worker'),
        ve(20, 'worker'),
        ve(10, 'worker'),
        ve(5, 'worker'),
        ve(1, 'worker'),
      ],
    });
    const s = summarizeState(view);
    expect(s.workers.idle).toBe(7);
    expect(s.workers.idleIds).toHaveLength(5);
    // Sort is post-collection, but we collect first 5 in iteration order — and
    // then re-sort. So the IDs returned are the first-5-collected, sorted.
    expect(s.workers.idleIds).toEqual([20, 30, 40, 50, 10].sort((a, b) => a - b));
  });

  it('counts army by sub-kind', () => {
    const view = makeView({
      myEntities: [
        ve(1, 'marine'),
        ve(2, 'marine'),
        ve(3, 'tank'),
        ve(4, 'tank-light'),
        ve(5, 'medic'),
      ],
    });
    const s = summarizeState(view);
    expect(s.army.marines).toBe(2);
    expect(s.army.tanks).toBe(2);
    expect(s.army.medics).toBe(1);
    expect(s.army.total).toBe(5);
  });

  it('counts buildings and underConstruction separately', () => {
    const view = makeView({
      myEntities: [
        ve(1, 'commandCenter'),
        ve(2, 'supplyDepot'),
        ve(3, 'barracks', { underConstruction: true }),
        ve(4, 'factory'),
        ve(5, 'turret'),
        ve(6, 'refinery'),
      ],
    });
    const s = summarizeState(view);
    expect(s.buildings.commandCenters).toBe(1);
    expect(s.buildings.supplyDepots).toBe(1);
    expect(s.buildings.barracks).toBe(1);
    expect(s.buildings.factories).toBe(1);
    expect(s.buildings.turrets).toBe(1);
    expect(s.buildings.refineries).toBe(1);
    expect(s.buildings.underConstruction).toBe(1);
  });

  it('threats: counts combat enemies and computes nearest distance in cells', () => {
    const view = makeView({
      myEntities: [ve(1, 'commandCenter', { pos: { x: 0, y: 0 } })],
      visibleEnemies: [
        ve(10, 'marine', { pos: { x: 16 * 5, y: 16 * 0 } }), // 5 cells right
        ve(11, 'enemyDummy', { pos: { x: 16 * 100, y: 0 } }), // far
        ve(12, 'worker', { pos: { x: 16 * 3, y: 0 } }), // not combat
      ],
    });
    const s = summarizeState(view);
    expect(s.threats.combatUnits).toBe(2); // marine + enemyDummy
    expect(s.threats.nearestEnemyCells).toBe(3); // worker is closest
  });

  it('threats: returns nulls when no visible enemies', () => {
    const view = makeView({
      myEntities: [ve(1, 'commandCenter')],
    });
    const s = summarizeState(view);
    expect(s.threats.nearestEnemyCells).toBeNull();
    expect(s.threats.combatUnits).toBe(0);
  });

  it('visibleEnemies: buckets enemies by class', () => {
    const view = makeView({
      visibleEnemies: [
        ve(1, 'worker', { team: 'player' }),
        ve(2, 'worker', { team: 'player' }),
        ve(3, 'marine', { team: 'player' }),
        ve(4, 'commandCenter', { team: 'player' }),
      ],
    });
    const s = summarizeState(view);
    expect(s.visibleEnemies.workers).toBe(2);
    expect(s.visibleEnemies.marines).toBe(1);
    expect(s.visibleEnemies.buildings).toBe(1);
    expect(s.visibleEnemies.total).toBe(4);
  });

  it('uses team of first my-entity for label', () => {
    const view = makeView({
      myEntities: [ve(1, 'worker', { team: 'enemy' })],
    });
    expect(summarizeState(view).team).toBe('enemy');
  });
});

describe('summarizeState — determinism', () => {
  it('same input produces identical output', () => {
    const view = makeView({
      resources: { minerals: 250, gas: 0 },
      myEntities: [
        ve(1, 'worker', { commandType: 'gather' }),
        ve(2, 'commandCenter'),
      ],
    });
    expect(summarizeState(view)).toEqual(summarizeState(view));
  });
});

describe('formatStateSummary — pretty print', () => {
  it('emits team / workers / army / buildings / minerals lines', () => {
    const view = makeView({
      resources: { minerals: 630, gas: 0 },
      myEntities: [
        ve(1, 'worker', { commandType: 'gather' }),
        ve(2, 'worker', { commandType: 'gather' }),
        ve(3, 'worker'),
        ve(4, 'commandCenter'),
        ve(5, 'supplyDepot'),
      ],
    });
    const text = formatStateSummary(summarizeState(view));
    expect(text).toContain('team: enemy');
    expect(text).toContain('workers: 3 (2 gathering, 1 idle: 3)');
    expect(text).toContain('army: 0 (0 marine, 0 tank, 0 medic)');
    expect(text).toContain('buildings: 1 CC, 1 supplyDepot');
    expect(text).toContain('minerals: 630');
    expect(text).toContain('threats: none visible');
    expect(text).toContain('visible enemies: none');
  });

  it('omits gas line when gas is 0', () => {
    const text = formatStateSummary(summarizeState(makeView()));
    expect(text).not.toContain('gas:');
  });

  it('includes gas line when gas > 0', () => {
    const text = formatStateSummary(summarizeState(makeView({ resources: { minerals: 0, gas: 50 } })));
    expect(text).toContain('gas: 50');
  });

  it('shows under-construction tally on buildings line when nonzero', () => {
    const view = makeView({
      myEntities: [ve(1, 'barracks', { underConstruction: true })],
    });
    const text = formatStateSummary(summarizeState(view));
    expect(text).toContain('1 barracks');
    expect(text).toContain('1 under construction');
  });
});

describe('summarizeState — hoarding flag (Phase 43)', () => {
  it('null when minerals & gas below warn (200)', () => {
    const s = summarizeState(makeView({ resources: { minerals: 150, gas: 50 } }));
    expect(s.hoarding.minerals).toBeNull();
    expect(s.hoarding.gas).toBeNull();
  });

  it('warn when minerals > 200 but <= 400', () => {
    const s = summarizeState(makeView({ resources: { minerals: 250, gas: 0 } }));
    expect(s.hoarding.minerals).toBe('warn');
    expect(s.hoarding.gas).toBeNull();
  });

  it('critical when minerals > 400', () => {
    const s = summarizeState(makeView({ resources: { minerals: 500, gas: 0 } }));
    expect(s.hoarding.minerals).toBe('critical');
  });

  it('warn when gas > 200 but <= 400', () => {
    const s = summarizeState(makeView({ resources: { minerals: 0, gas: 250 } }));
    expect(s.hoarding.gas).toBe('warn');
  });

  it('critical when gas > 400', () => {
    const s = summarizeState(makeView({ resources: { minerals: 0, gas: 500 } }));
    expect(s.hoarding.gas).toBe('critical');
  });

  it('exact threshold (200) is NOT yet warn (strictly greater)', () => {
    const s = summarizeState(makeView({ resources: { minerals: 200, gas: 200 } }));
    expect(s.hoarding.minerals).toBeNull();
    expect(s.hoarding.gas).toBeNull();
  });
});

describe('formatStateSummary — hoarding render (Phase 43)', () => {
  it('renders the warn warning when minerals > 200', () => {
    const text = formatStateSummary(
      summarizeState(makeView({ resources: { minerals: 350, gas: 0 } })),
    );
    expect(text).toContain('MINERALS HOARDED');
    expect(text).toContain('(350)');
    expect(text).toContain('spend NOW');
  });

  it('escalates wording on critical (minerals > 400)', () => {
    const text = formatStateSummary(
      summarizeState(makeView({ resources: { minerals: 600, gas: 0 } })),
    );
    expect(text).toContain('MINERALS HOARDED CRITICAL');
    expect(text).toContain('MULTIPLE');
  });

  it('renders gas hoard warning when gas > 200', () => {
    const text = formatStateSummary(
      summarizeState(makeView({ resources: { minerals: 0, gas: 300 } })),
    );
    expect(text).toContain('GAS HOARDED');
    expect(text).toContain('tank/medic');
  });

  it('emits NO hoarding line when both are below threshold', () => {
    const text = formatStateSummary(
      summarizeState(makeView({ resources: { minerals: 100, gas: 50 } })),
    );
    expect(text).not.toContain('HOARDED');
  });
});

// Phase 45 helpers — keep view fixtures terse; share a CC-at-origin builder.
const farPos = { x: 16 * 100, y: 0 };
const cc0 = (): ViewEntity => ve(1, 'commandCenter', { pos: { x: 0, y: 0 } });
const myMarines = (n: number): ViewEntity[] =>
  Array.from({ length: n }, (_, i) => ve(10 + i, 'marine'));
const enemyMarines = (n: number, pos = farPos): ViewEntity[] =>
  Array.from({ length: n }, (_, i) => ve(50 + i, 'marine', { team: 'player', pos }));

describe('summarizeState — idleArmyCount (Phase 45)', () => {
  it('counts armed units (marine/tank/tank-light/medic) with no active command; ignores workers and commanded units', () => {
    const view = makeView({
      myEntities: [
        cc0(),
        ve(10, 'marine'),
        ve(11, 'marine'),
        ve(12, 'marine', { commandType: 'attackMove' }),
        ve(13, 'tank'),
        ve(14, 'tank-light'),
        ve(15, 'medic'),
        ve(16, 'medic', { commandType: 'move' }),
        ve(17, 'worker'),
      ],
    });
    expect(summarizeState(view).idleArmyCount).toBe(5);
  });

  it('returns 0 with no armed units or all commanded', () => {
    expect(summarizeState(makeView({ myEntities: [cc0(), ve(2, 'worker')] })).idleArmyCount).toBe(0);
    expect(
      summarizeState(
        makeView({ myEntities: [cc0(), ve(10, 'marine', { commandType: 'attack' })] }),
      ).idleArmyCount,
    ).toBe(0);
  });
});

describe('summarizeState — enemyArmySize (Phase 45)', () => {
  it('counts marine+tank+tank-light+medic only (excludes worker/building/turret)', () => {
    const view = makeView({
      visibleEnemies: [
        ve(1, 'marine', { team: 'player' }),
        ve(2, 'marine', { team: 'player' }),
        ve(3, 'tank', { team: 'player' }),
        ve(4, 'tank-light', { team: 'player' }),
        ve(5, 'medic', { team: 'player' }),
        ve(6, 'worker', { team: 'player' }),
        ve(7, 'commandCenter', { team: 'player' }),
        ve(8, 'turret', { team: 'player' }),
      ],
    });
    expect(summarizeState(view).enemyArmySize).toBe(5);
    expect(summarizeState(makeView()).enemyArmySize).toBe(0);
  });
});

describe('summarizeState — defensivePosture (Phase 45)', () => {
  it('safe when own army outclasses enemy and enemy is far from CC', () => {
    const view = makeView({
      myEntities: [cc0(), ...myMarines(6)],
      visibleEnemies: enemyMarines(1),
    });
    expect(summarizeState(view).defensivePosture).toBe('safe');
  });

  it('parity when enemy*2 >= own and enemy <= own', () => {
    // 4 own vs 2 enemy → enemy*2 (=4) >= own (4) → parity
    const view = makeView({
      myEntities: [cc0(), ...myMarines(4)],
      visibleEnemies: enemyMarines(2),
    });
    expect(summarizeState(view).defensivePosture).toBe('parity');
  });

  it('behind when enemy armed > own armed and no CC poke', () => {
    const view = makeView({
      myEntities: [cc0(), ve(10, 'marine')],
      visibleEnemies: enemyMarines(3),
    });
    expect(summarizeState(view).defensivePosture).toBe('behind');
  });

  it('critical: visible combat enemy within 15 cells of any CC pre-empts safe', () => {
    const view = makeView({
      myEntities: [cc0(), ...myMarines(10)],
      visibleEnemies: [ve(50, 'marine', { team: 'player', pos: { x: 16 * 5, y: 0 } })],
    });
    expect(summarizeState(view).defensivePosture).toBe('critical');
  });

  it('critical uses per-CC distance, not centroid (workers far away cannot mask the poke)', () => {
    const view = makeView({
      myEntities: [
        cc0(),
        ...Array.from({ length: 6 }, (_, i) =>
          ve(20 + i, 'worker', { commandType: 'gather', pos: { x: 16 * 60, y: 0 } }),
        ),
      ],
      visibleEnemies: [ve(50, 'marine', { team: 'player', pos: { x: 16 * 7, y: 0 } })],
    });
    expect(summarizeState(view).defensivePosture).toBe('critical');
  });

  it('non-critical fallback when CC count is zero (no centroid/CC to test against)', () => {
    expect(
      summarizeState(makeView({ myEntities: myMarines(4), visibleEnemies: [] })).defensivePosture,
    ).toBe('safe');
  });

  it('non-combat enemy (worker) near CC does NOT trigger critical', () => {
    const view = makeView({
      myEntities: [cc0(), ...myMarines(5)],
      visibleEnemies: [ve(50, 'worker', { team: 'player', pos: { x: 16 * 3, y: 0 } })],
    });
    expect(summarizeState(view).defensivePosture).toBe('safe');
  });
});

describe('formatStateSummary — Phase 45 lines', () => {
  it('renders army_idle hint with §A1 anchor when idle armed count >= 3', () => {
    const view = makeView({
      myEntities: [cc0(), ve(10, 'marine'), ve(11, 'marine'), ve(12, 'marine'), ve(13, 'tank'), ve(14, 'medic')],
    });
    const text = formatStateSummary(summarizeState(view));
    expect(text).toContain('army_idle: 5');
    expect(text).toContain('deploy them');
    expect(text).toContain('§A1');
  });

  it('omits army_idle line below threshold (<3)', () => {
    const view = makeView({ myEntities: [cc0(), ve(10, 'marine'), ve(11, 'marine')] });
    expect(formatStateSummary(summarizeState(view))).not.toContain('army_idle:');
  });

  it('renders defensive_posture: BEHIND with comparison + §A2 anchor', () => {
    const view = makeView({
      myEntities: [cc0(), ...myMarines(4)],
      visibleEnemies: enemyMarines(8),
    });
    const text = formatStateSummary(summarizeState(view));
    expect(text).toContain('defensive_posture: BEHIND');
    expect(text).toContain('4 armed');
    expect(text).toContain('8 enemy armed');
    expect(text).toContain('§A2');
  });

  it('renders defensive_posture: CRITICAL with §A2 anchor when enemy near CC', () => {
    const view = makeView({
      myEntities: [cc0(), ...myMarines(4)],
      visibleEnemies: [ve(50, 'marine', { team: 'player', pos: { x: 16 * 5, y: 0 } })],
    });
    const text = formatStateSummary(summarizeState(view));
    expect(text).toContain('defensive_posture: CRITICAL');
    expect(text).toContain('§A2');
  });

  it('omits defensive_posture line when posture is safe; renders parity line otherwise', () => {
    const safe = makeView({ myEntities: [cc0(), ...myMarines(6)] });
    expect(formatStateSummary(summarizeState(safe))).not.toContain('defensive_posture:');
    const parity = makeView({
      myEntities: [cc0(), ...myMarines(4)],
      visibleEnemies: enemyMarines(2),
    });
    expect(formatStateSummary(summarizeState(parity))).toContain('defensive_posture: parity');
  });
});
