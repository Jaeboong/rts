import { CELL, GRID_H, GRID_W } from '../../types';
import type { Camera } from '../camera';
import { cellIndex, type World } from '../world';
import { pickAutotile } from './autotile';
import type { AutotileAtlas } from './tiles';
import type { TileKind } from './types';

export interface VisibleTileRange {
  minCx: number;
  maxCx: number;
  minCy: number;
  maxCy: number;
}

// Pure helper — clamp camera-derived cell range to grid bounds. Extracted from
// drawTileBackground so unit tests can verify edge/corner cases without canvas.
export function getVisibleTileRange(
  cam: Camera,
  worldWidth: number = GRID_W,
  worldHeight: number = GRID_H,
): VisibleTileRange {
  const minCx = Math.max(0, Math.floor(cam.x / CELL));
  const minCy = Math.max(0, Math.floor(cam.y / CELL));
  const maxCx = Math.min(worldWidth - 1, Math.floor((cam.x + cam.viewW - 1) / CELL));
  const maxCy = Math.min(worldHeight - 1, Math.floor((cam.y + cam.viewH - 1) / CELL));
  return { minCx, maxCx, minCy, maxCy };
}

// Procedural palette per TileKind — flat fillRect per cell while terrain sprites
// aren't ready. Variants per family give subtle natural variety; props render as
// grass + small overlay marker.
const TILE_FILL: Record<TileKind, string> = {
  'dirt-1': '#7a5e3a',
  'dirt-2': '#82663e',
  'dirt-3': '#6e5234',
  'dirt-4': '#86643a',
  'dirt-5': '#765832',
  'grass-1': '#3d6e2e',
  'grass-2': '#427230',
  'grass-3': '#386628',
  'grass-4': '#467434',
  'grass-5': '#3a6a2c',
  'wall-1': '#6b665a',
  'wall-2': '#736c5e',
  'wall-3': '#615b50',
  'wall-4': '#6f6a5a',
  'wall-5': '#675f54',
  'prop-rocks': '#3d6e2e',
  'prop-bush': '#3d6e2e',
  'prop-tree': '#3d6e2e',
  'prop-fire': '#3d6e2e',
  'prop-well': '#3d6e2e',
  'water-1': '#2e5a78',
  'water-2': '#346080',
  'water-3': '#28526e',
  'water-4': '#386686',
};

interface PropOverlay { color: string; radius: number; }
const PROP_OVERLAYS: Partial<Record<TileKind, PropOverlay>> = {
  'prop-rocks': { color: '#5a5448', radius: 4 },
  'prop-bush':  { color: '#284a18', radius: 4 },
  'prop-tree':  { color: '#1e3a14', radius: 5 },
  'prop-fire':  { color: '#c0521a', radius: 3 },
  'prop-well':  { color: '#1a3052', radius: 3 },
};

// Hill outline highlight for wall-* — thin lighter rim suggests elevation
// without a sprite. Drawn after fill so it sits on top of the cell.
const HILL_RIM = 'rgba(255,240,210,0.18)';

// Draw the visible slab of tiles. When `atlas` is non-null we use the autotile
// sheet (per-cell sprite chosen by neighbour mask via pickAutotile); otherwise
// we fall back to the procedural flat-color palette.
export function drawTileBackground(
  ctx: CanvasRenderingContext2D,
  world: World,
  cam: Camera,
  atlas: AutotileAtlas | null = null,
): void {
  const { minCx, maxCx, minCy, maxCy } = getVisibleTileRange(cam);

  if (atlas) {
    drawTileBackgroundSprites(ctx, world, atlas, minCx, maxCx, minCy, maxCy);
  } else {
    drawTileBackgroundProcedural(ctx, world, minCx, maxCx, minCy, maxCy);
  }

  // Prop overlays draw last regardless of base path — the autotile sheet has no
  // per-prop variants, so the small marker preserves prop visibility.
  drawPropOverlays(ctx, world, minCx, maxCx, minCy, maxCy);
}

// Sprite-based pass — autotile sheet path. imageSmoothingEnabled=false is set
// per-call so the renderer's other layers (which want bilinear) aren't affected.
function drawTileBackgroundSprites(
  ctx: CanvasRenderingContext2D,
  world: World,
  atlas: AutotileAtlas,
  minCx: number,
  maxCx: number,
  minCy: number,
  maxCy: number,
): void {
  const prevSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  for (let cy = minCy; cy <= maxCy; cy++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      const id = pickAutotile(world.tiles, cx, cy, GRID_W, GRID_H);
      const img = atlas.slots[id];
      if (!img) {
        // Slot missing in atlas — fall back to fill so a load gap is debuggable
        // rather than invisible.
        const kind = world.tiles[cellIndex(cx, cy)];
        ctx.fillStyle = TILE_FILL[kind];
        ctx.fillRect(cx * CELL, cy * CELL, CELL, CELL);
        continue;
      }
      ctx.drawImage(img, cx * CELL, cy * CELL, CELL, CELL);
    }
  }
  ctx.imageSmoothingEnabled = prevSmoothing;
}

// Procedural pass — pre-Phase-36 behaviour, retained as fallback for atlas==null
// and for tests that don't need pixel-faithful terrain.
function drawTileBackgroundProcedural(
  ctx: CanvasRenderingContext2D,
  world: World,
  minCx: number,
  maxCx: number,
  minCy: number,
  maxCy: number,
): void {
  for (let cy = minCy; cy <= maxCy; cy++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      const kind = world.tiles[cellIndex(cx, cy)];
      ctx.fillStyle = TILE_FILL[kind];
      ctx.fillRect(cx * CELL, cy * CELL, CELL, CELL);
    }
  }
  ctx.strokeStyle = HILL_RIM;
  ctx.lineWidth = 1;
  for (let cy = minCy; cy <= maxCy; cy++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      const kind = world.tiles[cellIndex(cx, cy)];
      if (!kind.startsWith('wall-')) continue;
      const x = cx * CELL + 0.5;
      const y = cy * CELL + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, y + CELL - 1);
      ctx.lineTo(x, y);
      ctx.lineTo(x + CELL - 1, y);
      ctx.stroke();
    }
  }
}

function drawPropOverlays(
  ctx: CanvasRenderingContext2D,
  world: World,
  minCx: number,
  maxCx: number,
  minCy: number,
  maxCy: number,
): void {
  for (let cy = minCy; cy <= maxCy; cy++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      const kind = world.tiles[cellIndex(cx, cy)];
      const ov = PROP_OVERLAYS[kind];
      if (!ov) continue;
      ctx.fillStyle = ov.color;
      ctx.beginPath();
      ctx.arc(cx * CELL + CELL / 2, cy * CELL + CELL / 2, ov.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
