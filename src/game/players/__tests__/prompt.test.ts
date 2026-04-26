import { describe, expect, it } from 'vitest';

import { buildPrompt } from '../prompt';
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

  it('appends the JSON schema instructions for the LLM', () => {
    const prompt = buildPrompt(makeView());
    expect(prompt).toContain('Reply with a JSON array of commands.');
    expect(prompt).toContain('move, attack, attackMove, gather, build, produce, setRally, cancel');
  });
});
