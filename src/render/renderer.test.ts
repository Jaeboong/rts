import { describe, expect, it } from 'vitest';
import { CELL } from '../types';
import {
  spawnBuilding,
  spawnGasGeyser,
  spawnMineralNode,
  spawnUnit,
} from '../game/entities';
import { cellToPx, createWorld } from '../game/world';
import {
  computePlacementPreview,
  getRallyVisualizations,
  shouldDrawHpBar,
} from './renderer';

describe('getRallyVisualizations', () => {
  it('returns [] when selection is empty', () => {
    const w = createWorld();
    expect(getRallyVisualizations(w)).toEqual([]);
  });

  it('returns [] when selection contains only a unit', () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    w.selection.add(m.id);
    expect(getRallyVisualizations(w)).toEqual([]);
  });

  it('returns [] when selected building has rallyPoint === null', () => {
    const w = createWorld();
    const b = spawnBuilding(w, 'barracks', 'player', 5, 5);
    b.rallyPoint = null;
    w.selection.add(b.id);
    expect(getRallyVisualizations(w)).toEqual([]);
  });

  it('returns one entry with from=center, to=rally for a building with rallyPoint', () => {
    const w = createWorld();
    const b = spawnBuilding(w, 'barracks', 'player', 5, 5);
    const rally = { x: 30 * CELL, y: 40 * CELL };
    b.rallyPoint = rally;
    w.selection.add(b.id);

    const out = getRallyVisualizations(w);
    expect(out).toHaveLength(1);
    // barracks is 15×15 starting at cell (5,5) → center pixel (5+7.5, 5+7.5) * CELL = 12.5 * CELL.
    expect(out[0].from).toEqual({ x: 12.5 * CELL, y: 12.5 * CELL });
    expect(out[0].to).toEqual(rally);
  });

  it('returns only the building with rally when one has it and another does not', () => {
    const w = createWorld();
    // 15×15 barracks need 15-cell separation between TLs.
    const withRally = spawnBuilding(w, 'barracks', 'player', 5, 5);
    const withoutRally = spawnBuilding(w, 'barracks', 'player', 25, 25);
    withRally.rallyPoint = { x: 50 * CELL, y: 50 * CELL };
    withoutRally.rallyPoint = null;
    w.selection.add(withRally.id);
    w.selection.add(withoutRally.id);

    const out = getRallyVisualizations(w);
    expect(out).toHaveLength(1);
    expect(out[0].to).toEqual({ x: 50 * CELL, y: 50 * CELL });
  });

  it('returns two entries when two selected buildings both have rally', () => {
    const w = createWorld();
    const b1 = spawnBuilding(w, 'barracks', 'player', 5, 5);
    const b2 = spawnBuilding(w, 'barracks', 'player', 25, 25);
    b1.rallyPoint = { x: 50 * CELL, y: 50 * CELL };
    b2.rallyPoint = { x: 60 * CELL, y: 60 * CELL };
    w.selection.add(b1.id);
    w.selection.add(b2.id);

    const out = getRallyVisualizations(w);
    expect(out).toHaveLength(2);
    const tos = out.map((r) => r.to);
    expect(tos).toContainEqual({ x: 50 * CELL, y: 50 * CELL });
    expect(tos).toContainEqual({ x: 60 * CELL, y: 60 * CELL });
  });
});

describe('shouldDrawHpBar', () => {
  it('returns false for mineral nodes', () => {
    const w = createWorld();
    const node = spawnMineralNode(w, 18, 18, 1500);
    expect(shouldDrawHpBar(node, false)).toBe(false);
    expect(shouldDrawHpBar(node, true)).toBe(false);
  });

  it('returns false for a building under construction (even if selected)', () => {
    const w = createWorld();
    const b = spawnBuilding(w, 'barracks', 'player', 5, 5);
    b.underConstruction = true;
    expect(shouldDrawHpBar(b, false)).toBe(false);
    expect(shouldDrawHpBar(b, true)).toBe(false);
  });

  it('returns true for a damaged building no longer under construction', () => {
    const w = createWorld();
    const b = spawnBuilding(w, 'barracks', 'player', 5, 5);
    b.underConstruction = false;
    b.hp = b.hpMax - 1;
    expect(shouldDrawHpBar(b, false)).toBe(true);
  });

  it('returns true for a fully-healthy unit when selected', () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    expect(shouldDrawHpBar(m, true)).toBe(true);
  });

  it('returns false for a fully-healthy unit when not selected', () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    expect(shouldDrawHpBar(m, false)).toBe(false);
  });
});

describe('computePlacementPreview', () => {
  it('non-refinery: TL offset by half-size, valid on empty ground', () => {
    const w = createWorld();
    // Barracks is 15×15, half = 7. Click at center of cell (17,17) → TL = (10,10).
    const preview = computePlacementPreview(w, 'barracks', {
      x: 17 * CELL + 4,
      y: 17 * CELL + 4,
    });
    expect(preview).not.toBeNull();
    expect(preview!.cellX).toBe(10);
    expect(preview!.cellY).toBe(10);
    expect(preview!.sizeW).toBe(15);
    expect(preview!.sizeH).toBe(15);
    expect(preview!.valid).toBe(true);
  });

  it('non-refinery: invalid when footprint overlaps an existing building', () => {
    const w = createWorld();
    // CC at (5,5) is 20×20 → cells 5..24. Click that puts the 15×15 barracks footprint inside the CC.
    spawnBuilding(w, 'commandCenter', 'player', 5, 5);
    // Click cell (15,15) → barracks TL = (15-7, 15-7) = (8,8) → footprint cells 8..22 overlaps CC.
    const preview = computePlacementPreview(w, 'barracks', {
      x: 15 * CELL + 4,
      y: 15 * CELL + 4,
    });
    expect(preview).not.toBeNull();
    expect(preview!.valid).toBe(false);
  });

  it('refinery over geyser: TL snaps to geyser TL, valid', () => {
    const w = createWorld();
    spawnGasGeyser(w, 30, 30);
    // Click anywhere within the 5×5 geyser footprint (cells 30..34).
    const preview = computePlacementPreview(w, 'refinery', {
      x: 32 * CELL + 4,
      y: 31 * CELL + 4,
    });
    expect(preview).not.toBeNull();
    expect(preview!.cellX).toBe(30);
    expect(preview!.cellY).toBe(30);
    expect(preview!.sizeW).toBe(5);
    expect(preview!.sizeH).toBe(5);
    expect(preview!.valid).toBe(true);
  });

  it('refinery off-geyser: TL = mouse cell, invalid', () => {
    const w = createWorld();
    const preview = computePlacementPreview(w, 'refinery', {
      x: 50 * CELL + 4,
      y: 50 * CELL + 4,
    });
    expect(preview).not.toBeNull();
    expect(preview!.cellX).toBe(50);
    expect(preview!.cellY).toBe(50);
    expect(preview!.valid).toBe(false);
  });

  it('refinery over claimed geyser: invalid (treated as off-geyser)', () => {
    const w = createWorld();
    const g = spawnGasGeyser(w, 30, 30);
    g.refineryId = 999;
    const preview = computePlacementPreview(w, 'refinery', {
      x: 30 * CELL + 4,
      y: 30 * CELL + 4,
    });
    expect(preview).not.toBeNull();
    expect(preview!.valid).toBe(false);
  });

  it('mouse outside grid → null', () => {
    const w = createWorld();
    const preview = computePlacementPreview(w, 'barracks', { x: -10, y: -10 });
    expect(preview).toBeNull();
  });
});
