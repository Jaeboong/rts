import { describe, expect, it } from 'vitest';

import { formatBuildOrderPhase, inferBuildOrderPhase } from '../build-order-tracker';
import { summarizeState } from '../state-summary';
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
    resources: { minerals: 0, gas: 0 },
    myEntities: [],
    visibleEnemies: [],
    visibleResources: [],
    mapInfo: { w: 128, h: 128, cellPx: 16 },
    ...overrides,
  };
}

function infer(view: GameView) {
  return inferBuildOrderPhase(view, summarizeState(view));
}

describe('inferBuildOrderPhase — branch coverage', () => {
  it('bootstrap when no commandCenter', () => {
    const view = makeView({
      myEntities: [ve(1, 'worker')],
    });
    const p = infer(view);
    expect(p.currentStep).toBe('bootstrap');
    expect(p.rationale).toContain('no commandCenter');
  });

  it('early-econ when worker count below target', () => {
    const view = makeView({
      resources: { minerals: 50, gas: 0 },
      myEntities: [
        ve(1, 'commandCenter'),
        ve(2, 'worker', { commandType: 'gather' }),
      ],
    });
    const p = infer(view);
    expect(p.currentStep).toBe('early-econ');
    // Phase 43: phrasing tightened to imperative "QUEUE ... workers".
    expect(p.nextGoal).toMatch(/workers/);
  });

  it('tech-up-barracks once 8 workers + 150M and no barracks', () => {
    const view = makeView({
      resources: { minerals: 200, gas: 0 },
      myEntities: [
        ve(1, 'commandCenter'),
        ...Array.from({ length: 8 }, (_, i) => ve(10 + i, 'worker', { commandType: 'gather' })),
      ],
    });
    const p = infer(view);
    expect(p.currentStep).toBe('tech-up-barracks');
    expect(p.nextGoal).toContain('barracks');
  });

  it('does not tech up when minerals are too low', () => {
    const view = makeView({
      resources: { minerals: 50, gas: 0 },
      myEntities: [
        ve(1, 'commandCenter'),
        ...Array.from({ length: 8 }, (_, i) => ve(10 + i, 'worker', { commandType: 'gather' })),
      ],
    });
    const p = infer(view);
    expect(p.currentStep).not.toBe('tech-up-barracks');
  });

  it('army-build once a completed barracks exists and marines < 4', () => {
    const view = makeView({
      resources: { minerals: 50, gas: 0 },
      myEntities: [
        ve(1, 'commandCenter'),
        ...Array.from({ length: 8 }, (_, i) => ve(10 + i, 'worker', { commandType: 'gather' })),
        ve(50, 'barracks'), // not underConstruction
      ],
    });
    const p = infer(view);
    expect(p.currentStep).toBe('army-build');
    expect(p.nextGoal).toMatch(/marines/);
  });

  it('still tech-up when barracks exists but is under construction', () => {
    const view = makeView({
      resources: { minerals: 50, gas: 0 },
      myEntities: [
        ve(1, 'commandCenter'),
        ...Array.from({ length: 8 }, (_, i) => ve(10 + i, 'worker', { commandType: 'gather' })),
        ve(50, 'barracks', { underConstruction: true }),
      ],
    });
    const p = infer(view);
    expect(p.currentStep).toBe('tech-up-barracks');
    expect(p.rationale).toContain('under construction');
  });

  it('attack once marines >= 4', () => {
    const view = makeView({
      resources: { minerals: 50, gas: 0 },
      myEntities: [
        ve(1, 'commandCenter'),
        ...Array.from({ length: 8 }, (_, i) => ve(10 + i, 'worker', { commandType: 'gather' })),
        ve(50, 'barracks'),
        ...Array.from({ length: 4 }, (_, i) => ve(100 + i, 'marine')),
      ],
    });
    const p = infer(view);
    expect(p.currentStep).toBe('attack');
  });

  it('Phase 45: defensivePosture=critical with comparable enemy force → defend (max production + engage)', () => {
    // 4 marines + 4 enemy marines, one near CC (5 cells) → critical AND
    // enemy*2 >= own (8 >= 4) → new defend branch fires regardless of having
    // crossed ATTACK_TRIGGER. Asserts §A2 wording.
    const view = makeView({
      resources: { minerals: 200, gas: 0 },
      myEntities: [
        ve(1, 'commandCenter', { pos: { x: 0, y: 0 } }),
        ...Array.from({ length: 8 }, (_, i) => ve(10 + i, 'worker', { commandType: 'gather' })),
        ve(50, 'barracks'),
        ...Array.from({ length: 4 }, (_, i) => ve(100 + i, 'marine')),
      ],
      visibleEnemies: [
        ve(99, 'marine', { team: 'player', pos: { x: 16 * 5, y: 0 } }),
        ve(98, 'marine', { team: 'player', pos: { x: 16 * 100, y: 0 } }),
        ve(97, 'marine', { team: 'player', pos: { x: 16 * 100, y: 0 } }),
        ve(96, 'marine', { team: 'player', pos: { x: 16 * 100, y: 0 } }),
      ],
    });
    const p = infer(view);
    expect(p.currentStep).toBe('defend');
    expect(p.nextGoal).toMatch(/DEFEND/);
    expect(p.nextGoal).toMatch(/EVERY barracks/);
    expect(p.rationale).toMatch(/critical/);
  });

  it('Phase 45: defensivePosture=critical but small lone poke (own army >> enemy*2) → keep attacking', () => {
    // 5 marines vs 1 nearby enemy marine. Critical fires (proximity), but the
    // army-balance gate suppresses the defend override → fall through to attack.
    const view = makeView({
      resources: { minerals: 200, gas: 0 },
      myEntities: [
        ve(1, 'commandCenter', { pos: { x: 0, y: 0 } }),
        ...Array.from({ length: 8 }, (_, i) => ve(10 + i, 'worker', { commandType: 'gather' })),
        ve(50, 'barracks'),
        ...Array.from({ length: 5 }, (_, i) => ve(100 + i, 'marine')),
      ],
      visibleEnemies: [ve(99, 'marine', { team: 'player', pos: { x: 16 * 5, y: 0 } })],
    });
    const p = infer(view);
    expect(p.currentStep).toBe('attack');
  });

  it('defend pre-empts everything when threats are close and army is small', () => {
    const view = makeView({
      resources: { minerals: 200, gas: 0 },
      myEntities: [
        ve(1, 'commandCenter', { pos: { x: 0, y: 0 } }),
        ...Array.from({ length: 8 }, (_, i) => ve(10 + i, 'worker', { commandType: 'gather', pos: { x: 0, y: 0 } })),
      ],
      visibleEnemies: [
        ve(99, 'marine', { team: 'player', pos: { x: 16 * 5, y: 0 } }), // 5 cells away
      ],
    });
    const p = infer(view);
    expect(p.currentStep).toBe('defend');
  });

  it('does NOT defend when threats are far away (>18 cells)', () => {
    const view = makeView({
      resources: { minerals: 200, gas: 0 },
      myEntities: [
        ve(1, 'commandCenter', { pos: { x: 0, y: 0 } }),
        ...Array.from({ length: 8 }, (_, i) => ve(10 + i, 'worker', { commandType: 'gather', pos: { x: 0, y: 0 } })),
      ],
      visibleEnemies: [
        ve(99, 'marine', { team: 'player', pos: { x: 16 * 30, y: 0 } }),
      ],
    });
    const p = infer(view);
    expect(p.currentStep).not.toBe('defend');
  });

  it('does NOT defend when our army is already big enough to push back', () => {
    const view = makeView({
      resources: { minerals: 200, gas: 0 },
      myEntities: [
        ve(1, 'commandCenter', { pos: { x: 0, y: 0 } }),
        ...Array.from({ length: 8 }, (_, i) => ve(10 + i, 'worker', { commandType: 'gather' })),
        ve(50, 'barracks'),
        ...Array.from({ length: 5 }, (_, i) => ve(100 + i, 'marine')),
      ],
      visibleEnemies: [
        ve(99, 'marine', { team: 'player', pos: { x: 16 * 5, y: 0 } }),
      ],
    });
    const p = infer(view);
    expect(p.currentStep).toBe('attack');
  });
});

describe('inferBuildOrderPhase — Phase 43 imperative phrasing', () => {
  it('early-econ: nextGoal is imperative ("QUEUE ... immediately") with deadline reference', () => {
    const view = makeView({
      resources: { minerals: 50, gas: 0 },
      myEntities: [
        ve(1, 'commandCenter'),
        ve(2, 'worker', { commandType: 'gather' }),
      ],
    });
    const p = infer(view);
    expect(p.currentStep).toBe('early-econ');
    // Imperative tone: capitalized verb + "immediately" hint + tick deadline.
    expect(p.nextGoal).toMatch(/QUEUE/);
    expect(p.nextGoal).toMatch(/refinery/);
    expect(p.nextGoal).toMatch(/tick \d+/);
    expect(p.rationale).toMatch(/Spend|do not sit/);
  });

  it('tech-up-barracks: nextGoal commands BUILD now (not soft "consider")', () => {
    const view = makeView({
      resources: { minerals: 200, gas: 0 },
      myEntities: [
        ve(1, 'commandCenter'),
        ...Array.from({ length: 8 }, (_, i) => ve(10 + i, 'worker', { commandType: 'gather' })),
      ],
    });
    const p = infer(view);
    expect(p.currentStep).toBe('tech-up-barracks');
    expect(p.nextGoal).toMatch(/BUILD barracks NOW/);
    expect(p.nextGoal).not.toMatch(/consider/i);
  });

  it('army-build: nextGoal demands queueing on every barracks', () => {
    const view = makeView({
      resources: { minerals: 50, gas: 0 },
      myEntities: [
        ve(1, 'commandCenter'),
        ...Array.from({ length: 8 }, (_, i) => ve(10 + i, 'worker', { commandType: 'gather' })),
        ve(50, 'barracks'),
      ],
    });
    const p = infer(view);
    expect(p.currentStep).toBe('army-build');
    expect(p.nextGoal).toMatch(/QUEUE/);
    expect(p.nextGoal).toMatch(/EVERY/);
  });
});

describe('formatBuildOrderPhase', () => {
  it('renders Step / Next goal / Rationale', () => {
    const text = formatBuildOrderPhase({
      currentStep: 'tech-up-barracks',
      nextGoal: 'build barracks',
      rationale: 'because',
    });
    expect(text).toContain('Step: tech-up-barracks');
    expect(text).toContain('Next goal: build barracks');
    expect(text).toContain('Rationale: because');
  });
});

describe('inferBuildOrderPhase — determinism', () => {
  it('same view → same phase', () => {
    const view = makeView({
      myEntities: [ve(1, 'commandCenter'), ve(2, 'worker')],
    });
    expect(infer(view)).toEqual(infer(view));
  });
});
