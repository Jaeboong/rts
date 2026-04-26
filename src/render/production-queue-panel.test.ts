import { describe, expect, it } from 'vitest';
import { spawnBuilding } from '../game/entities';
import { createWorld } from '../game/world';
import {
  PRODUCTION_PANEL_H,
  PRODUCTION_PANEL_RIGHT_PAD,
  PRODUCTION_PANEL_TOP_PAD,
  PRODUCTION_PANEL_W,
  computeProductionQueuePanel,
} from './production-queue-panel';

const VIEW_W = 1280;
const VIEW_H = 720;
const PANEL_H = 130;

describe('computeProductionQueuePanel', () => {
  it('returns null when nothing is selected', () => {
    const w = createWorld();
    const panel = computeProductionQueuePanel(w, VIEW_W, VIEW_H, PANEL_H);
    expect(panel).toBeNull();
  });

  it('returns null when only non-producer buildings are selected', () => {
    const w = createWorld();
    const supply = spawnBuilding(w, 'supplyDepot', 'player', 30, 30);
    w.selection.add(supply.id);
    expect(computeProductionQueuePanel(w, VIEW_W, VIEW_H, PANEL_H)).toBeNull();
  });

  it('returns null when only enemy producer is selected', () => {
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'enemy', 10, 10);
    w.selection.add(cc.id);
    expect(computeProductionQueuePanel(w, VIEW_W, VIEW_H, PANEL_H)).toBeNull();
  });

  it('returns panel with empty items for an idle player CC', () => {
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    w.selection.add(cc.id);
    const panel = computeProductionQueuePanel(w, VIEW_W, VIEW_H, PANEL_H);
    expect(panel).not.toBeNull();
    expect(panel!.producerId).toBe(cc.id);
    expect(panel!.items).toEqual([]);
  });

  it('first item gets isHead=true with progress derived from remaining/total', () => {
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    cc.productionQueue!.push({
      produces: 'worker',
      totalSeconds: 10,
      remainingSeconds: 4, // 60% complete
    });
    cc.productionQueue!.push({
      produces: 'worker',
      totalSeconds: 10,
      remainingSeconds: 10,
    });
    w.selection.add(cc.id);
    const panel = computeProductionQueuePanel(w, VIEW_W, VIEW_H, PANEL_H);
    expect(panel).not.toBeNull();
    expect(panel!.items.length).toBe(2);
    expect(panel!.items[0].isHead).toBe(true);
    expect(panel!.items[0].produces).toBe('worker');
    expect(panel!.items[0].progress).toBeCloseTo(0.6, 5);
    expect(panel!.items[1].isHead).toBe(false);
    expect(panel!.items[1].progress).toBeUndefined();
  });

  it('caps visible items at 5', () => {
    const w = createWorld();
    const bx = spawnBuilding(w, 'barracks', 'player', 30, 30);
    for (let i = 0; i < 8; i++) {
      bx.productionQueue!.push({
        produces: 'marine',
        totalSeconds: 15,
        remainingSeconds: 15,
      });
    }
    w.selection.add(bx.id);
    const panel = computeProductionQueuePanel(w, VIEW_W, VIEW_H, PANEL_H);
    expect(panel!.items.length).toBe(5);
  });

  it('clamps progress to [0,1] even on stale data', () => {
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    cc.productionQueue!.push({
      produces: 'worker',
      totalSeconds: 10,
      remainingSeconds: -2, // already overdue
    });
    w.selection.add(cc.id);
    const panel = computeProductionQueuePanel(w, VIEW_W, VIEW_H, PANEL_H);
    expect(panel!.items[0].progress).toBe(1);

    cc.productionQueue![0].remainingSeconds = 20; // longer than total
    const panel2 = computeProductionQueuePanel(w, VIEW_W, VIEW_H, PANEL_H);
    expect(panel2!.items[0].progress).toBe(0);
  });

  it('panel rect anchors to bottom-right of HUD with fixed padding', () => {
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    w.selection.add(cc.id);
    const panel = computeProductionQueuePanel(w, VIEW_W, VIEW_H, PANEL_H);
    expect(panel!.rect.x).toBe(
      VIEW_W - PRODUCTION_PANEL_W - PRODUCTION_PANEL_RIGHT_PAD,
    );
    expect(panel!.rect.y).toBe(VIEW_H - PANEL_H + PRODUCTION_PANEL_TOP_PAD);
    expect(panel!.rect.w).toBe(PRODUCTION_PANEL_W);
    expect(panel!.rect.h).toBe(PRODUCTION_PANEL_H);
  });

  it('uses first selected producer when both producer and unit are selected', () => {
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const bx = spawnBuilding(w, 'barracks', 'player', 30, 30);
    w.selection.add(cc.id);
    w.selection.add(bx.id);
    const panel = computeProductionQueuePanel(w, VIEW_W, VIEW_H, PANEL_H);
    // Set iteration order matches insertion order; CC was added first.
    expect(panel!.producerId).toBe(cc.id);
  });
});
