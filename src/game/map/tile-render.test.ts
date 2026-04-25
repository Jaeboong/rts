import { describe, expect, it } from 'vitest';
import type { Camera } from '../camera';
import { getVisibleTileRange } from './tile-render';

function makeCamera(x: number, y: number, viewW = 800, viewH = 600): Camera {
  return { x, y, viewW, viewH, panSpeed: 600 };
}

describe('getVisibleTileRange', () => {
  it('camera at origin (0,0) on a 128×128 grid yields a slab starting at (0,0)', () => {
    const cam = makeCamera(0, 0);
    const r = getVisibleTileRange(cam, 128, 128);
    expect(r.minCx).toBe(0);
    expect(r.minCy).toBe(0);
    // 800 / 16 = 50 → maxCx = 49 (zero-indexed, inclusive). 600/16 = 37.5 → 37.
    expect(r.maxCx).toBe(49);
    expect(r.maxCy).toBe(37);
  });

  it('camera offset by 32px shifts visible range by 2 cells (CELL=16)', () => {
    const cam = makeCamera(32, 32);
    const r = getVisibleTileRange(cam, 128, 128);
    expect(r.minCx).toBe(2);
    expect(r.minCy).toBe(2);
    expect(r.maxCx).toBe(51);
    expect(r.maxCy).toBe(39);
  });

  it('camera at far bottom-right corner clamps to grid bounds', () => {
    const W = 128;
    const H = 128;
    // World pixel size = 128*16 = 2048. Position cam so view spills past edge.
    const cam = makeCamera(2048 - 200, 2048 - 200, 400, 400);
    const r = getVisibleTileRange(cam, W, H);
    // maxCx/Cy must clamp to W-1, H-1.
    expect(r.maxCx).toBe(W - 1);
    expect(r.maxCy).toBe(H - 1);
    // minCx is in the window
    expect(r.minCx).toBeGreaterThanOrEqual(0);
    expect(r.minCx).toBeLessThan(W);
  });

  it('camera with negative position clamps minCx/minCy to 0', () => {
    const cam = makeCamera(-50, -50);
    const r = getVisibleTileRange(cam, 128, 128);
    expect(r.minCx).toBe(0);
    expect(r.minCy).toBe(0);
  });

  it('mid-grid camera produces a well-formed contiguous range', () => {
    const cam = makeCamera(500, 500, 320, 240);
    const r = getVisibleTileRange(cam, 128, 128);
    expect(r.minCx).toBeLessThanOrEqual(r.maxCx);
    expect(r.minCy).toBeLessThanOrEqual(r.maxCy);
    // 500/16 = 31.25 → minCx = 31. (500+319)/16 = 51.18 → maxCx = 51.
    expect(r.minCx).toBe(31);
    expect(r.maxCx).toBe(51);
    // 500/16 = 31.25 → minCy = 31. (500+239)/16 = 46.18 → maxCy = 46.
    expect(r.minCy).toBe(31);
    expect(r.maxCy).toBe(46);
  });

  it('1×1 viewport at (16, 16) sees exactly cell (1, 1)', () => {
    const cam = makeCamera(16, 16, 1, 1);
    const r = getVisibleTileRange(cam, 128, 128);
    expect(r.minCx).toBe(1);
    expect(r.maxCx).toBe(1);
    expect(r.minCy).toBe(1);
    expect(r.maxCy).toBe(1);
  });
});
