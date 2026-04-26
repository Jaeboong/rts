import { describe, expect, it } from 'vitest';

import { buildPrompt } from '../prompt';
import { summarizeState } from '../state-summary';
import { inferBuildOrderPhase } from '../build-order-tracker';
import type { GameView } from '../types';

function makeView(overrides: Partial<GameView> = {}): GameView {
  return {
    tick: 240,
    resources: { minerals: 350, gas: 0 },
    myEntities: [],
    visibleEnemies: [],
    visibleResources: [],
    mapInfo: { w: 128, h: 128, cellPx: 16 },
    ...overrides,
  };
}

describe('buildPrompt', () => {
  it('renders header lines deterministically', () => {
    const view = makeView();
    const prompt = buildPrompt(view);
    expect(prompt).toContain('Tick: 240');
    expect(prompt).toContain('Minerals: 350');
    expect(prompt).toContain('Map: 128x128 cells (cellPx=16)');
  });

  it('returns identical output for identical input (determinism)', () => {
    const view = makeView({
      myEntities: [
        { id: 12, kind: 'worker', team: 'enemy', pos: { x: 80, y: 80 }, hp: 40, maxHp: 40, cellX: 5, cellY: 5 },
        { id: 13, kind: 'marine', team: 'enemy', pos: { x: 128, y: 96 }, hp: 60, maxHp: 60, cellX: 8, cellY: 6 },
      ],
      visibleEnemies: [
        { id: 99, kind: 'enemyDummy', team: 'player', pos: { x: 640, y: 640 }, hp: 100, maxHp: 100, cellX: 40, cellY: 40 },
      ],
      visibleResources: [
        { id: 200, kind: 'mineralNode', team: 'neutral', pos: { x: 160, y: 160 }, hp: 1500, maxHp: 1500, cellX: 10, cellY: 10 },
      ],
    });
    const a = buildPrompt(view);
    const b = buildPrompt(view);
    expect(a).toBe(b);
  });

  it('lists my units with id, kind, cell, hp', () => {
    const view = makeView({
      myEntities: [
        { id: 7, kind: 'worker', team: 'enemy', pos: { x: 80, y: 80 }, hp: 38, maxHp: 40, cellX: 5, cellY: 5 },
      ],
    });
    const prompt = buildPrompt(view);
    expect(prompt).toContain('My units (1):');
    expect(prompt).toContain('id=7 worker at (5,5) hp=38/40');
  });

  it('sorts entities by id for stable diffs', () => {
    const view = makeView({
      myEntities: [
        { id: 13, kind: 'marine', team: 'enemy', pos: { x: 128, y: 96 }, hp: 60, maxHp: 60, cellX: 8, cellY: 6 },
        { id: 7, kind: 'worker', team: 'enemy', pos: { x: 80, y: 80 }, hp: 40, maxHp: 40, cellX: 5, cellY: 5 },
      ],
    });
    const prompt = buildPrompt(view);
    const idx7 = prompt.indexOf('id=7 ');
    const idx13 = prompt.indexOf('id=13 ');
    expect(idx7).toBeLessThan(idx13);
  });

  it('marks underConstruction entities', () => {
    const view = makeView({
      myEntities: [
        { id: 50, kind: 'barracks', team: 'enemy', pos: { x: 0, y: 0 }, hp: 100, maxHp: 1000, cellX: 0, cellY: 0, underConstruction: true },
      ],
    });
    expect(buildPrompt(view)).toContain('[underConstruction]');
  });

  it('marks workers actively constructing with [building] flag', () => {
    const view = makeView({
      myEntities: [
        { id: 37, kind: 'worker', team: 'enemy', pos: { x: 0, y: 0 }, hp: 40, maxHp: 40, cellX: 118, cellY: 40, commandType: 'build' },
      ],
    });
    const out = buildPrompt(view);
    expect(out).toContain('id=37 worker at (118,40) hp=40/40 [building]');
  });

  it('does not flag workers with non-build commands as [building]', () => {
    const view = makeView({
      myEntities: [
        { id: 7, kind: 'worker', team: 'enemy', pos: { x: 0, y: 0 }, hp: 40, maxHp: 40, cellX: 5, cellY: 5, commandType: 'gather' },
        { id: 8, kind: 'worker', team: 'enemy', pos: { x: 0, y: 0 }, hp: 40, maxHp: 40, cellX: 6, cellY: 6 },
      ],
    });
    const out = buildPrompt(view);
    expect(out).not.toContain('[building]');
  });

  it('does not flag non-worker entities with [building] even if commandType=build', () => {
    // Only workers can have a 'build' command in practice, but defensive check
    // ensures the formatter is type-safe should that invariant change.
    const view = makeView({
      myEntities: [
        { id: 50, kind: 'marine', team: 'enemy', pos: { x: 0, y: 0 }, hp: 60, maxHp: 60, cellX: 5, cellY: 5, commandType: 'build' },
      ],
    });
    const out = buildPrompt(view);
    expect(out).not.toContain('[building]');
  });

  it('renders a 32x16 minimap with the documented legend', () => {
    const view = makeView({
      myEntities: [
        { id: 1, kind: 'worker', team: 'enemy', pos: { x: 0, y: 0 }, hp: 40, maxHp: 40, cellX: 0, cellY: 0 },
      ],
      visibleEnemies: [
        { id: 99, kind: 'enemyDummy', team: 'player', pos: { x: 0, y: 0 }, hp: 100, maxHp: 100, cellX: 127, cellY: 127 },
      ],
      visibleResources: [
        { id: 200, kind: 'mineralNode', team: 'neutral', pos: { x: 0, y: 0 }, hp: 1500, maxHp: 1500, cellX: 64, cellY: 64 },
      ],
    });
    const prompt = buildPrompt(view);
    expect(prompt).toContain('Minimap 32x16');
    const minimapStart = prompt.indexOf('Minimap');
    const minimapBlock = prompt.slice(minimapStart);
    const lines = minimapBlock.split('\n');
    // 1 header line + 16 grid rows
    const gridLines = lines.slice(1, 17);
    expect(gridLines).toHaveLength(16);
    for (const row of gridLines) expect(row).toHaveLength(32);
    // Top-left corner has my unit (M)
    expect(gridLines[0][0]).toBe('M');
    // Bottom-right corner has enemy (E)
    expect(gridLines[15][31]).toBe('E');
    // Roughly center has a resource (R)
    expect(minimapBlock).toContain('R');
  });

  it('omits trailing JSON-reply instructions (tool-use mode lets the system prompt drive command emission)', () => {
    const prompt = buildPrompt(makeView());
    expect(prompt).not.toContain('Reply with a JSON array');
    expect(prompt).not.toContain('Return ONLY the JSON array');
    expect(prompt).not.toContain('Valid types: move,');
  });

  it('ends with the minimap grid (no post-minimap response directives)', () => {
    const prompt = buildPrompt(makeView());
    const lines = prompt.split('\n');
    // Last line must be a minimap row (32 chars from the M/E/R/. legend),
    // not an instruction line.
    const last = lines[lines.length - 1];
    expect(last).toHaveLength(32);
    expect(/^[MER.]{32}$/.test(last)).toBe(true);
  });
});

describe('buildPrompt — ctx (Synthesized State / Build Phase / Decisions / Notes)', () => {
  it('with no ctx, output is byte-identical to bare call (back-compat)', () => {
    const view = makeView({
      myEntities: [
        { id: 7, kind: 'worker', team: 'enemy', pos: { x: 80, y: 80 }, hp: 38, maxHp: 40, cellX: 5, cellY: 5 },
      ],
    });
    expect(buildPrompt(view)).toBe(buildPrompt(view, undefined));
    // Legacy section ordering preserved.
    const out = buildPrompt(view);
    expect(out.startsWith('Tick: 240\n')).toBe(true);
  });

  it('renders Synthesized State section when ctx.summary supplied', () => {
    const view = makeView({
      resources: { minerals: 630, gas: 0 },
      myEntities: [
        { id: 1, kind: 'worker', team: 'enemy', pos: { x: 0, y: 0 }, hp: 40, maxHp: 40, cellX: 0, cellY: 0, commandType: 'gather' },
      ],
    });
    const out = buildPrompt(view, { summary: summarizeState(view) });
    expect(out).toContain('--- Synthesized State ---');
    expect(out).toContain('workers: 1');
    expect(out).toContain('minerals: 630');
    // Section appears BEFORE the Tick line.
    expect(out.indexOf('--- Synthesized State ---')).toBeLessThan(out.indexOf('Tick:'));
  });

  it('renders Current Build Phase section when ctx.phase supplied', () => {
    const view = makeView();
    const summary = summarizeState(view);
    const phase = inferBuildOrderPhase(view, summary);
    const out = buildPrompt(view, { summary, phase });
    expect(out).toContain('--- Current Build Phase ---');
    expect(out).toContain('Step:');
    expect(out).toContain('Next goal:');
    expect(out).toContain('Rationale:');
  });

  it('renders Your last N decisions section when ctx.decisions supplied', () => {
    const view = makeView();
    const out = buildPrompt(view, {
      decisions: [
        {
          tickAtRequest: 100,
          results: [
            { cmd: { type: 'gather', unitIds: [7], nodeId: 200 }, ok: true },
            {
              cmd: { type: 'produce', buildingId: 50, unit: 'worker' },
              ok: false,
              reason: 'produce worker insufficient minerals',
            },
          ],
        },
      ],
    });
    expect(out).toContain('--- Your last 1 decisions ---');
    expect(out).toContain('@tick 100');
    expect(out).toContain('gather([7] → 200)');
    expect(out).toContain('produce(50 worker)');
    expect(out).toContain('insufficient minerals');
  });

  it('renders Notes section when ctx.notes supplied', () => {
    const view = makeView();
    const out = buildPrompt(view, { notes: ['have idle workers — gather them', 'no barracks despite 600M'] });
    expect(out).toContain('--- Notes ---');
    expect(out).toContain('- have idle workers');
    expect(out).toContain('- no barracks');
  });

  it('skips empty decisions array (no header, clean prompt)', () => {
    const view = makeView();
    const out = buildPrompt(view, { decisions: [] });
    expect(out).not.toContain('--- Your last');
  });

  it('renders all sections together in fixed order: summary → phase → decisions → notes', () => {
    const view = makeView();
    const summary = summarizeState(view);
    const phase = inferBuildOrderPhase(view, summary);
    const out = buildPrompt(view, {
      summary,
      phase,
      decisions: [
        { tickAtRequest: 1, results: [] },
      ],
      notes: ['be careful'],
    });
    const idxSummary = out.indexOf('--- Synthesized State ---');
    const idxPhase = out.indexOf('--- Current Build Phase ---');
    const idxDecisions = out.indexOf('--- Your last');
    const idxNotes = out.indexOf('--- Notes ---');
    expect(idxSummary).toBeGreaterThanOrEqual(0);
    expect(idxSummary).toBeLessThan(idxPhase);
    expect(idxPhase).toBeLessThan(idxDecisions);
    expect(idxDecisions).toBeLessThan(idxNotes);
    // All ctx sections precede legacy Tick block.
    expect(idxNotes).toBeLessThan(out.indexOf('Tick:'));
  });
});
