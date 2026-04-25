import { describe, expect, it } from 'vitest';
import { findSpeedButtonAt, isPointOverHud, speedButtonRect } from '../render/ui';
import {
  TICK_DT,
  TICK_MS,
  advanceTickAccumulator,
  computeEdgePanVector,
  createGame,
} from './loop';
import { createWorld } from './world';

describe('computeEdgePanVector', () => {
  const W = 800;
  const H = 600;
  const T = 20;

  it('returns (-1, 0) near left edge with y in middle', () => {
    expect(computeEdgePanVector(5, 300, W, H, T)).toEqual({ x: -1, y: 0 });
  });

  it('returns (1, 0) near right edge with y in middle', () => {
    expect(computeEdgePanVector(795, 300, W, H, T)).toEqual({ x: 1, y: 0 });
  });

  it('returns (0, -1) near top edge with x in middle', () => {
    expect(computeEdgePanVector(400, 5, W, H, T)).toEqual({ x: 0, y: -1 });
  });

  it('returns (0, 1) near bottom edge with x in middle', () => {
    expect(computeEdgePanVector(400, 595, W, H, T)).toEqual({ x: 0, y: 1 });
  });

  it('returns (-1, -1) at top-left corner', () => {
    expect(computeEdgePanVector(5, 5, W, H, T)).toEqual({ x: -1, y: -1 });
  });

  it('returns (1, -1) at top-right corner', () => {
    expect(computeEdgePanVector(795, 5, W, H, T)).toEqual({ x: 1, y: -1 });
  });

  it('returns (-1, 1) at bottom-left corner', () => {
    expect(computeEdgePanVector(5, 595, W, H, T)).toEqual({ x: -1, y: 1 });
  });

  it('returns (1, 1) at bottom-right corner', () => {
    expect(computeEdgePanVector(795, 595, W, H, T)).toEqual({ x: 1, y: 1 });
  });

  it('returns (0, 0) at center', () => {
    expect(computeEdgePanVector(400, 300, W, H, T)).toEqual({ x: 0, y: 0 });
  });

  it('returns (0, 0) when x < 0 (outside canvas)', () => {
    expect(computeEdgePanVector(-1, 300, W, H, T)).toEqual({ x: 0, y: 0 });
  });

  it('returns (0, 0) when x > canvasW (outside canvas)', () => {
    expect(computeEdgePanVector(801, 300, W, H, T)).toEqual({ x: 0, y: 0 });
  });

  it('returns (0, 0) when y < 0 (outside canvas)', () => {
    expect(computeEdgePanVector(400, -1, W, H, T)).toEqual({ x: 0, y: 0 });
  });

  it('returns (0, 0) when y > canvasH (outside canvas)', () => {
    expect(computeEdgePanVector(400, 601, W, H, T)).toEqual({ x: 0, y: 0 });
  });

  it('returns (0, 0) at exactly threshold (strict inequality)', () => {
    expect(computeEdgePanVector(T, 300, W, H, T)).toEqual({ x: 0, y: 0 });
  });
});

describe('isPointOverHud', () => {
  const W = 800;
  const H = 600;

  it('returns false for top-left region (no HUD blocks left edge anymore)', () => {
    expect(isPointOverHud(10, 10, W, H)).toBe(false);
    expect(isPointOverHud(100, 30, W, H)).toBe(false);
  });

  it('returns true for bottom panel region', () => {
    expect(isPointOverHud(10, H - 10, W, H)).toBe(true);
    expect(isPointOverHud(W - 1, H - 10, W, H)).toBe(true);
    expect(isPointOverHud(400, H - 100, W, H)).toBe(true);
  });

  it('returns true for top-right reserve (resource counters + ATTACK indicator)', () => {
    expect(isPointOverHud(W - 10, 10, W, H)).toBe(true);
    expect(isPointOverHud(W - 10, 30, W, H)).toBe(true);
    expect(isPointOverHud(W - 10, 50, W, H)).toBe(true);
  });

  it('returns false for non-HUD canvas area (center)', () => {
    expect(isPointOverHud(400, 300, W, H)).toBe(false);
  });

  it('returns false for upper-left mid area (left side now free of HUD)', () => {
    expect(isPointOverHud(50, 200, W, H)).toBe(false);
  });

  it('returns false just above bottom panel', () => {
    expect(isPointOverHud(400, H - 200, W, H)).toBe(false);
  });

  it('returns false near right edge but below top-right reserve', () => {
    expect(isPointOverHud(W - 10, 200, W, H)).toBe(false);
  });

  it('returns false to left of top-right reserve at same y', () => {
    expect(isPointOverHud(400, 30, W, H)).toBe(false);
  });

  it('returns false in bottom 5px exception band (south edge-pan)', () => {
    expect(isPointOverHud(50, H - 3, W, H)).toBe(false);
    expect(isPointOverHud(50, H - 1, W, H)).toBe(false);
  });

  it('returns false at boundary y = viewH - 5 (band starts here)', () => {
    expect(isPointOverHud(50, H - 5, W, H)).toBe(false);
  });

  it('returns true just above the 5px band (y = viewH - 6)', () => {
    expect(isPointOverHud(50, H - 6, W, H)).toBe(true);
  });

  it('returns true deep in bottom panel (y = viewH - 100)', () => {
    expect(isPointOverHud(50, H - 100, W, H)).toBe(true);
  });
});

// createGame depends on window (createInput); stub `window` for this single check.
describe('createGame speedFactor default', () => {
  it('initializes speedFactor to 1', () => {
    const stubCanvas = {
      addEventListener: () => {},
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
      }),
      clientWidth: 800,
      clientHeight: 600,
      style: {},
    } as unknown as HTMLCanvasElement;
    const stubCtx = {} as unknown as CanvasRenderingContext2D;
    // window.addEventListener is invoked by createInput. Provide a no-op shim.
    const g_unknown = globalThis as unknown as { window?: { addEventListener: () => void } };
    const hadWindow = 'window' in globalThis;
    if (!hadWindow) g_unknown.window = { addEventListener: () => {} };
    try {
      const w = createWorld();
      const g = createGame(stubCanvas, stubCtx, w);
      expect(g.speedFactor).toBe(1);
    } finally {
      if (!hadWindow) delete g_unknown.window;
    }
  });
});

describe('advanceTickAccumulator', () => {
  // Real loop fires onTick every tickMs — runs the same fixed-rate sim with TICK_DT.
  // speedFactor scales how fast the accumulator fills, so 2x → twice as many ticks per real-ms.

  it('returns 0 ticks if scaled dt is below threshold', () => {
    const r = advanceTickAccumulator(0, 10, 1, TICK_MS, 250);
    expect(r.ticks).toBe(0);
    expect(r.acc).toBeCloseTo(10);
  });

  it('speedFactor=1 over 50ms (one tick budget) yields 1 tick', () => {
    const r = advanceTickAccumulator(0, TICK_MS, 1, TICK_MS, 250);
    expect(r.ticks).toBe(1);
    expect(r.acc).toBeCloseTo(0);
  });

  it('speedFactor=2 over 50ms yields 2 ticks (effective dt is 2x base)', () => {
    const r = advanceTickAccumulator(0, TICK_MS, 2, TICK_MS, 250);
    expect(r.ticks).toBe(2);
    expect(r.acc).toBeCloseTo(0);
  });

  it('speedFactor=4 over 50ms yields 4 ticks (effective dt is 4x base)', () => {
    const r = advanceTickAccumulator(0, TICK_MS, 4, TICK_MS, 250);
    expect(r.ticks).toBe(4);
    expect(r.acc).toBeCloseTo(0);
  });

  it('speedFactor=2 across multiple frames accumulates 2x game time', () => {
    let acc = 0;
    let ticks = 0;
    const FRAMES = 20;
    const FRAME_DT = TICK_MS; // each frame supplies one base-tick worth of dt
    for (let i = 0; i < FRAMES; i++) {
      const r = advanceTickAccumulator(acc, FRAME_DT, 2, TICK_MS, 250);
      acc = r.acc;
      ticks += r.ticks;
    }
    // 20 frames × 2x speed = 40 ticks at 1/20s each = 2.0s sim time vs 1.0s real
    expect(ticks).toBe(40);
    expect(ticks * TICK_DT).toBeCloseTo(2.0);
  });

  it('clamps to maxCatchupMs to prevent spiral-of-death', () => {
    const r = advanceTickAccumulator(0, 10000, 1, TICK_MS, 250);
    // 250ms cap → floor(250/50) = 5 ticks
    expect(r.ticks).toBe(5);
    expect(r.acc).toBeCloseTo(0);
  });

  it('catchup cap applies after dt scaling (speedFactor=4 with huge dt still capped)', () => {
    const r = advanceTickAccumulator(0, 10000, 4, TICK_MS, 250);
    // Even at 4x, scaled dt 40000ms is still capped at 250ms = 5 ticks
    expect(r.ticks).toBe(5);
  });
});

describe('findSpeedButtonAt', () => {
  const W = 800;
  const H = 600;

  it('returns 1 when clicking the 1x button region', () => {
    const r = speedButtonRect(1, W);
    expect(r).not.toBeNull();
    if (!r) return;
    expect(findSpeedButtonAt(r.x + 5, r.y + 5, W, H)).toBe(1);
  });

  it('returns 2 when clicking the 2x button region', () => {
    const r = speedButtonRect(2, W);
    expect(r).not.toBeNull();
    if (!r) return;
    expect(findSpeedButtonAt(r.x + 5, r.y + 5, W, H)).toBe(2);
  });

  it('returns 4 when clicking the 4x button region', () => {
    const r = speedButtonRect(4, W);
    expect(r).not.toBeNull();
    if (!r) return;
    expect(findSpeedButtonAt(r.x + 5, r.y + 5, W, H)).toBe(4);
  });

  it('returns null when clicking outside speed-button region (center of canvas)', () => {
    expect(findSpeedButtonAt(W / 2, H / 2, W, H)).toBeNull();
  });

  it('returns null when clicking on the resource-counter area (right of buttons)', () => {
    expect(findSpeedButtonAt(W - 10, 10, W, H)).toBeNull();
  });

  it('returns null when clicking just below the speed-button row', () => {
    const r = speedButtonRect(1, W);
    expect(r).not.toBeNull();
    if (!r) return;
    expect(findSpeedButtonAt(r.x + 5, r.y + r.h + 10, W, H)).toBeNull();
  });

  it('speed-button rects do not overlap (3 distinct x-ranges)', () => {
    const r1 = speedButtonRect(1, W)!;
    const r2 = speedButtonRect(2, W)!;
    const r4 = speedButtonRect(4, W)!;
    expect(r1.x + r1.w).toBeLessThanOrEqual(r2.x);
    expect(r2.x + r2.w).toBeLessThanOrEqual(r4.x);
  });

  it('all speed buttons sit inside the top-right HUD reserve', () => {
    for (const f of [1, 2, 4] as const) {
      const r = speedButtonRect(f, W)!;
      // Center of button must register as HUD per isPointOverHud
      expect(isPointOverHud(r.x + r.w / 2, r.y + r.h / 2, W, H)).toBe(true);
    }
  });
});
