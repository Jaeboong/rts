import { describe, expect, it } from 'vitest';
import type { Camera } from '../game/camera';
import { spawnBuilding, spawnMineralNode, spawnUnit } from '../game/entities';
import { createWorld } from '../game/world';
import { CELL, WORLD_H, WORLD_W } from '../types';
import {
  centerCameraOn,
  findMinimapClickWorldPos,
  isPointInMinimap,
  MINIMAP_PADDING,
  MINIMAP_SIZE,
  minimapRect,
  minimapScale,
} from './minimap';

const VIEW_W = 800;
const VIEW_H = 600;
// Mirror of HUD_PANEL_H in minimap.ts.
const HUD_PANEL_H = 130;

function makeCamera(): Camera {
  return { x: 0, y: 0, viewW: VIEW_W, viewH: VIEW_H, panSpeed: 600 };
}

describe('minimapRect', () => {
  it('places the minimap above the HUD panel with right/bottom padding', () => {
    const r = minimapRect(VIEW_W, VIEW_H);
    expect(r.w).toBe(MINIMAP_SIZE);
    expect(r.h).toBe(MINIMAP_SIZE);
    expect(r.x).toBe(VIEW_W - MINIMAP_SIZE - MINIMAP_PADDING);
    expect(r.y).toBe(VIEW_H - HUD_PANEL_H - MINIMAP_SIZE - MINIMAP_PADDING);
  });

  it('does not overlap the bottom HUD panel', () => {
    const r = minimapRect(VIEW_W, VIEW_H);
    // Bottom edge of minimap must sit ABOVE the top edge of the HUD panel.
    expect(r.y + r.h).toBeLessThanOrEqual(VIEW_H - HUD_PANEL_H);
  });
});

describe('isPointInMinimap', () => {
  const r = minimapRect(VIEW_W, VIEW_H);

  it('true at the top-left corner', () => {
    expect(isPointInMinimap(r.x, r.y, VIEW_W, VIEW_H)).toBe(true);
  });

  it('true 1 px inside the bottom-right corner', () => {
    expect(isPointInMinimap(r.x + r.w - 1, r.y + r.h - 1, VIEW_W, VIEW_H)).toBe(true);
  });

  it('false 1 px outside the right edge', () => {
    expect(isPointInMinimap(r.x + r.w, r.y + 10, VIEW_W, VIEW_H)).toBe(false);
  });

  it('false 1 px outside the top edge', () => {
    expect(isPointInMinimap(r.x + 10, r.y - 1, VIEW_W, VIEW_H)).toBe(false);
  });

  it('false at the canvas top-left (where debug overlays live)', () => {
    expect(isPointInMinimap(0, 0, VIEW_W, VIEW_H)).toBe(false);
  });
});

describe('findMinimapClickWorldPos', () => {
  it('returns null when click is outside the minimap', () => {
    expect(findMinimapClickWorldPos(0, 0, VIEW_W, VIEW_H)).toBeNull();
  });

  it('top-left of minimap maps to world origin', () => {
    const r = minimapRect(VIEW_W, VIEW_H);
    const wp = findMinimapClickWorldPos(r.x, r.y, VIEW_W, VIEW_H);
    expect(wp).not.toBeNull();
    expect(wp!.x).toBeCloseTo(0, 5);
    expect(wp!.y).toBeCloseTo(0, 5);
  });

  it('center of minimap maps to world center', () => {
    const r = minimapRect(VIEW_W, VIEW_H);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const wp = findMinimapClickWorldPos(cx, cy, VIEW_W, VIEW_H);
    expect(wp).not.toBeNull();
    expect(wp!.x).toBeCloseTo(WORLD_W / 2, 1);
    expect(wp!.y).toBeCloseTo(WORLD_H / 2, 1);
  });

  it('formula round-trips: world point → minimap coord → world point', () => {
    // Pick an arbitrary in-world point, project to minimap coords, then
    // invert with findMinimapClickWorldPos and verify equality.
    const r = minimapRect(VIEW_W, VIEW_H);
    const scale = minimapScale();
    const worldX = 1234;
    const worldY = 2345;
    const mmX = r.x + worldX * scale;
    const mmY = r.y + worldY * scale;
    const wp = findMinimapClickWorldPos(mmX, mmY, VIEW_W, VIEW_H);
    expect(wp).not.toBeNull();
    expect(wp!.x).toBeCloseTo(worldX, 0);
    expect(wp!.y).toBeCloseTo(worldY, 0);
  });
});

describe('centerCameraOn', () => {
  it('centers the viewport on the given world position', () => {
    const cam = makeCamera();
    centerCameraOn(cam, { x: 2000, y: 1500 });
    expect(cam.x).toBe(2000 - VIEW_W / 2);
    expect(cam.y).toBe(1500 - VIEW_H / 2);
  });

  it('clamps to world top-left when target is near origin', () => {
    const cam = makeCamera();
    centerCameraOn(cam, { x: 10, y: 10 });
    expect(cam.x).toBe(0);
    expect(cam.y).toBe(0);
  });

  it('clamps to world bottom-right when target is past the corner', () => {
    const cam = makeCamera();
    centerCameraOn(cam, { x: WORLD_W + 100, y: WORLD_H + 100 });
    expect(cam.x).toBe(WORLD_W - VIEW_W);
    expect(cam.y).toBe(WORLD_H - VIEW_H);
  });
});

describe('drawMinimap (smoke / no-throw)', () => {
  // Pure rendering — no observable state to assert beyond "doesn't crash on
  // a populated world". Use a stub canvas context that records calls.
  function makeStubCtx(): CanvasRenderingContext2D {
    const noop = (): void => {};
    const ctx = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      fillRect: noop,
      strokeRect: noop,
      beginPath: noop,
      arc: noop,
      fill: noop,
      stroke: noop,
    };
    return ctx as unknown as CanvasRenderingContext2D;
  }

  it('renders without throwing for a world with various entity kinds', async () => {
    // Late import to avoid loading the full module graph during plain unit
    // tests above.
    const { drawMinimap } = await import('./minimap');
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 5, 5);
    spawnUnit(w, 'worker', 'player', { x: 10 * CELL, y: 10 * CELL });
    spawnUnit(w, 'marine', 'enemy', { x: 200 * CELL, y: 200 * CELL });
    spawnMineralNode(w, 30, 30, 1500);
    const cam = makeCamera();
    expect(() => drawMinimap(makeStubCtx(), w, cam)).not.toThrow();
  });
});
