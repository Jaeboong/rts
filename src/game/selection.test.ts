import { describe, expect, it } from 'vitest';
import { CELL } from '../types';
import { spawnBuilding, spawnUnit } from './entities';
import {
  applyClick,
  applyDragBox,
  applySameKindExpand,
  EXPAND_RADIUS_CELLS,
} from './selection';
import { cellToPx, createWorld } from './world';

describe('applyDragBox: same-kind multi-select rule for buildings', () => {
  it('drag captures 2 CCs + 3 Barracks → only first-found kind survives', () => {
    const w = createWorld();
    // CC 20×20 cells span 20; barracks 15×15 spans 15. Place CCs in row y=4 and barracks in row y=30 to avoid overlap.
    const cc1 = spawnBuilding(w, 'commandCenter', 'player', 4, 4);
    const cc2 = spawnBuilding(w, 'commandCenter', 'player', 30, 4);
    const b1 = spawnBuilding(w, 'barracks', 'player', 4, 30);
    const b2 = spawnBuilding(w, 'barracks', 'player', 25, 30);
    const b3 = spawnBuilding(w, 'barracks', 'player', 46, 30);

    // Drag rect covers the centers of all five.
    applyDragBox(w, 0, 0, 70 * CELL, 60 * CELL, false);

    expect(w.selection.has(cc1.id)).toBe(true);
    expect(w.selection.has(cc2.id)).toBe(true);
    expect(w.selection.has(b1.id)).toBe(false);
    expect(w.selection.has(b2.id)).toBe(false);
    expect(w.selection.has(b3.id)).toBe(false);
  });

  it('drag captures 1 CC + 1 Barracks + 2 Marines → buildings reduced to first kind, units preserved', () => {
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'player', 4, 4);
    const brk = spawnBuilding(w, 'barracks', 'player', 4, 30);
    const m1 = spawnUnit(w, 'marine', 'player', cellToPx(50, 8));
    const m2 = spawnUnit(w, 'marine', 'player', cellToPx(55, 8));

    applyDragBox(w, 0, 0, 70 * CELL, 60 * CELL, false);

    expect(w.selection.has(cc.id)).toBe(true);
    expect(w.selection.has(brk.id)).toBe(false);
    expect(w.selection.has(m1.id)).toBe(true);
    expect(w.selection.has(m2.id)).toBe(true);
  });

  it('drag captures 3 same-kind CCs → all preserved', () => {
    const w = createWorld();
    // 20×20 CCs need 20-cell spacing minimum.
    const cc1 = spawnBuilding(w, 'commandCenter', 'player', 4, 4);
    const cc2 = spawnBuilding(w, 'commandCenter', 'player', 30, 4);
    const cc3 = spawnBuilding(w, 'commandCenter', 'player', 56, 4);

    applyDragBox(w, 0, 0, 80 * CELL, 30 * CELL, false);

    expect(w.selection.has(cc1.id)).toBe(true);
    expect(w.selection.has(cc2.id)).toBe(true);
    expect(w.selection.has(cc3.id)).toBe(true);
  });

  it('drag captures only units → all preserved (no normalization triggered)', () => {
    const w = createWorld();
    const m1 = spawnUnit(w, 'marine', 'player', cellToPx(5, 5));
    const m2 = spawnUnit(w, 'marine', 'player', cellToPx(10, 5));
    const wkr = spawnUnit(w, 'worker', 'player', cellToPx(15, 5));

    applyDragBox(w, 0, 0, 20 * CELL, 10 * CELL, false);

    expect(w.selection.has(m1.id)).toBe(true);
    expect(w.selection.has(m2.id)).toBe(true);
    expect(w.selection.has(wkr.id)).toBe(true);
  });

  it('drag captures 1 building + 0 units → preserved (single building, normalization no-op)', () => {
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'player', 4, 4);

    applyDragBox(w, 0, 0, 30 * CELL, 30 * CELL, false);

    expect(w.selection.has(cc.id)).toBe(true);
    expect(w.selection.size).toBe(1);
  });

  it('drag with mixed buildings + units: kept-kind buildings AND units survive together', () => {
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'player', 4, 4);
    const cc2 = spawnBuilding(w, 'commandCenter', 'player', 30, 4);
    const brk = spawnBuilding(w, 'barracks', 'player', 4, 30);
    const m = spawnUnit(w, 'marine', 'player', cellToPx(60, 8));

    applyDragBox(w, 0, 0, 80 * CELL, 60 * CELL, false);

    expect(w.selection.has(cc.id)).toBe(true);
    expect(w.selection.has(cc2.id)).toBe(true);
    expect(w.selection.has(brk.id)).toBe(false);
    expect(w.selection.has(m.id)).toBe(true);
  });

  it('drag excludes enemy buildings', () => {
    const w = createWorld();
    const enemy = spawnBuilding(w, 'barracks', 'enemy', 4, 4);
    applyDragBox(w, 0, 0, 30 * CELL, 30 * CELL, false);
    expect(w.selection.has(enemy.id)).toBe(false);
  });
});

describe('applyClick: shift-add building rule', () => {
  it('shift-click adds different-kind building → existing buildings dropped, new one becomes sole building', () => {
    const w = createWorld();
    // Spread 20×20 CCs and 15×15 barracks so brk's hit-test doesn't overlap a CC.
    const cc1 = spawnBuilding(w, 'commandCenter', 'player', 4, 4);
    const cc2 = spawnBuilding(w, 'commandCenter', 'player', 30, 4);
    const brk = spawnBuilding(w, 'barracks', 'player', 4, 30);

    // Pre-select both CCs.
    w.selection.add(cc1.id);
    w.selection.add(cc2.id);

    // Shift-click on Barracks: barracks wins, both CCs drop.
    applyClick(w, brk.pos.x, brk.pos.y, true);

    expect(w.selection.has(cc1.id)).toBe(false);
    expect(w.selection.has(cc2.id)).toBe(false);
    expect(w.selection.has(brk.id)).toBe(true);
  });

  it('shift-click adds different-kind building → units in existing selection survive', () => {
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'player', 4, 4);
    const m1 = spawnUnit(w, 'marine', 'player', cellToPx(50, 8));
    const m2 = spawnUnit(w, 'marine', 'player', cellToPx(55, 8));
    const brk = spawnBuilding(w, 'barracks', 'player', 4, 30);

    w.selection.add(cc.id);
    w.selection.add(m1.id);
    w.selection.add(m2.id);

    applyClick(w, brk.pos.x, brk.pos.y, true);

    expect(w.selection.has(cc.id)).toBe(false);
    expect(w.selection.has(brk.id)).toBe(true);
    expect(w.selection.has(m1.id)).toBe(true);
    expect(w.selection.has(m2.id)).toBe(true);
  });

  it('shift-click adds same-kind building → all kept', () => {
    const w = createWorld();
    const cc1 = spawnBuilding(w, 'commandCenter', 'player', 4, 4);
    const cc2 = spawnBuilding(w, 'commandCenter', 'player', 30, 4);

    w.selection.add(cc1.id);
    applyClick(w, cc2.pos.x, cc2.pos.y, true);

    expect(w.selection.has(cc1.id)).toBe(true);
    expect(w.selection.has(cc2.id)).toBe(true);
  });

  it('shift-click toggles off an already-selected building (no normalization on remove)', () => {
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'player', 4, 4);
    const brk = spawnBuilding(w, 'barracks', 'player', 4, 30);

    w.selection.add(cc.id);
    w.selection.add(brk.id); // pre-existing mixed state (e.g., from API caller)

    // Shift-click on cc: it's already selected, so toggle it OFF — no normalize.
    applyClick(w, cc.pos.x, cc.pos.y, true);

    expect(w.selection.has(cc.id)).toBe(false);
    expect(w.selection.has(brk.id)).toBe(true);
  });
});

describe('applySameKindExpand: same-kind in-radius unit expansion', () => {
  it('replace mode: expands to all same-kind player units within radius', () => {
    const w = createWorld();
    const center = spawnUnit(w, 'marine', 'player', cellToPx(20, 20));
    const near = spawnUnit(w, 'marine', 'player', cellToPx(25, 20));
    const alsoNear = spawnUnit(w, 'marine', 'player', cellToPx(20, 28));

    applySameKindExpand(w, center, false);

    expect(w.selection.has(center.id)).toBe(true);
    expect(w.selection.has(near.id)).toBe(true);
    expect(w.selection.has(alsoNear.id)).toBe(true);
    expect(w.selection.size).toBe(3);
  });

  it('excludes same-kind units beyond the radius', () => {
    const w = createWorld();
    const center = spawnUnit(w, 'marine', 'player', cellToPx(20, 20));
    // EXPAND_RADIUS_CELLS=10 → place a marine 11 cells away (just outside).
    const far = spawnUnit(
      w,
      'marine',
      'player',
      cellToPx(20 + EXPAND_RADIUS_CELLS + 1, 20),
    );

    applySameKindExpand(w, center, false);

    expect(w.selection.has(center.id)).toBe(true);
    expect(w.selection.has(far.id)).toBe(false);
  });

  it('excludes different-kind units within radius', () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(20, 20));
    const wkr = spawnUnit(w, 'worker', 'player', cellToPx(22, 20));

    applySameKindExpand(w, m, false);

    expect(w.selection.has(m.id)).toBe(true);
    expect(w.selection.has(wkr.id)).toBe(false);
  });

  it('excludes enemy units of the same kind within radius', () => {
    const w = createWorld();
    const player = spawnUnit(w, 'marine', 'player', cellToPx(20, 20));
    // Same kind, opposite team — the team filter must reject it BEFORE the kind
    // filter has anything to do. Use marine+enemy (kinds match, teams differ).
    const enemyMarine = spawnUnit(w, 'marine', 'enemy', cellToPx(22, 20));

    applySameKindExpand(w, player, false);

    expect(w.selection.has(player.id)).toBe(true);
    expect(w.selection.has(enemyMarine.id)).toBe(false);
  });

  it('replace mode: clears prior selection before adding expanded set', () => {
    const w = createWorld();
    const m1 = spawnUnit(w, 'marine', 'player', cellToPx(20, 20));
    const m2 = spawnUnit(w, 'marine', 'player', cellToPx(22, 20));
    const wkr = spawnUnit(w, 'worker', 'player', cellToPx(50, 50));
    w.selection.add(wkr.id);

    applySameKindExpand(w, m1, false);

    expect(w.selection.has(wkr.id)).toBe(false);
    expect(w.selection.has(m1.id)).toBe(true);
    expect(w.selection.has(m2.id)).toBe(true);
  });

  it('additive mode: keeps prior selection AND adds expanded set', () => {
    const w = createWorld();
    const m1 = spawnUnit(w, 'marine', 'player', cellToPx(20, 20));
    const m2 = spawnUnit(w, 'marine', 'player', cellToPx(22, 20));
    const wkr = spawnUnit(w, 'worker', 'player', cellToPx(50, 50));
    w.selection.add(wkr.id);

    applySameKindExpand(w, m1, true);

    expect(w.selection.has(wkr.id)).toBe(true);
    expect(w.selection.has(m1.id)).toBe(true);
    expect(w.selection.has(m2.id)).toBe(true);
  });

  it('no-op for enemy unit hit (player-team-only contract)', () => {
    const w = createWorld();
    const enemy = spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(20, 20));
    w.selection.add(99); // sentinel to confirm selection is left alone

    applySameKindExpand(w, enemy, false);

    expect(w.selection.has(enemy.id)).toBe(false);
    expect(w.selection.has(99)).toBe(true);
  });

  it('no-op for building hit (player-team-only and unit-only contract)', () => {
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'player', 4, 4);
    w.selection.add(99); // sentinel

    applySameKindExpand(w, cc, false);

    expect(w.selection.has(cc.id)).toBe(false);
    expect(w.selection.has(99)).toBe(true);
  });

  it('uses Euclidean radius (squared distance), not bounding box', () => {
    const w = createWorld();
    const center = spawnUnit(w, 'marine', 'player', cellToPx(20, 20));
    // Diagonal corner of the bounding box (10√2 ≈ 14.14 cells) is OUT of the
    // circular radius. Place a marine at (cx+8, cy+8) → distance ≈ 11.31 cells
    // = OUT. And (cx+7, cy+7) ≈ 9.9 cells = IN.
    const inside = spawnUnit(w, 'marine', 'player', cellToPx(27, 27));
    const outside = spawnUnit(w, 'marine', 'player', cellToPx(28, 28));

    applySameKindExpand(w, center, false);

    expect(w.selection.has(center.id)).toBe(true);
    expect(w.selection.has(inside.id)).toBe(true);
    expect(w.selection.has(outside.id)).toBe(false);
  });

  it('CELL=16 sanity: radius is exactly EXPAND_RADIUS_CELLS * CELL pixels', () => {
    const w = createWorld();
    const center = spawnUnit(w, 'marine', 'player', { x: 100, y: 100 });
    // Place a marine at exactly radius distance along the x-axis.
    const onBoundary = spawnUnit(w, 'marine', 'player', {
      x: 100 + EXPAND_RADIUS_CELLS * CELL,
      y: 100,
    });
    // And one just past it.
    const justOver = spawnUnit(w, 'marine', 'player', {
      x: 100 + EXPAND_RADIUS_CELLS * CELL + 1,
      y: 100,
    });

    applySameKindExpand(w, center, false);

    expect(w.selection.has(onBoundary.id)).toBe(true);
    expect(w.selection.has(justOver.id)).toBe(false);
  });
});
