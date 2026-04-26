import type { Camera } from '../game/camera';
import type { World } from '../game/world';
import {
  CELL,
  GRID_H,
  GRID_W,
  WORLD_H,
  WORLD_W,
  type Entity,
  type Team,
  type Vec2,
} from '../types';

// Geometry constants — exported for tests and so handler.ts can introspect.
export const MINIMAP_SIZE = 200;
export const MINIMAP_PADDING = 8;

// HUD's bottom panel reserves PANEL_H px at the bottom of the canvas. The
// minimap MUST sit ABOVE this band so it never overlaps the selection panel /
// production buttons. Hard-coded here (rather than imported from ui.ts) to
// avoid an import cycle: ui.ts already imports this module. If PANEL_H in
// ui.ts ever changes, mirror it here too.
const HUD_PANEL_H = 130;

// Background fill — slightly lighter than canvas clear so the minimap reads
// as a panel even before any entity dots are drawn.
const MINIMAP_BG = '#0e1410';
const MINIMAP_BORDER = '#f0c040';
const VIEWPORT_OUTLINE = '#f0c040';

const TEAM_DOT_COLORS: Record<Team, string> = {
  player: '#4a8cff',
  enemy: '#ff5c5c',
  neutral: '#a0a0a0',
};

// Resource node tint — readable against the dark fill, distinct from neutral
// units (which are also gray). SC convention: mineral = cyan/teal, gas = bright
// green. HUD's two cyans are too close at 2-px dot scale, so gas gets a
// dedicated bright green here.
const MINERAL_DOT = '#34c8b0';
const GAS_DOT = '#5cee5c';

// Dot pixel sizes. Buildings get a fatter square so they read as
// installations rather than units. Resources use the smallest dot.
const UNIT_DOT_PX = 2;
const BUILDING_DOT_PX = 3;
const RESOURCE_DOT_PX = 2;

interface MinimapRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Top-left corner of the minimap in screen coords. Bottom-right with
 * MINIMAP_PADDING from the right edge AND from the top of the HUD bottom panel.
 */
export function minimapRect(viewW: number, viewH: number): MinimapRect {
  const x = viewW - MINIMAP_SIZE - MINIMAP_PADDING;
  const y = viewH - HUD_PANEL_H - MINIMAP_SIZE - MINIMAP_PADDING;
  return { x, y, w: MINIMAP_SIZE, h: MINIMAP_SIZE };
}

/**
 * World→minimap scale factor. World is GRID_W × CELL px wide (assumed square).
 * Returned as a single scalar since the minimap is square and the world is
 * square — if either ever changes, switch to per-axis scales.
 */
export function minimapScale(): number {
  return MINIMAP_SIZE / WORLD_W;
}

export function isPointInMinimap(
  x: number,
  y: number,
  viewW: number,
  viewH: number,
): boolean {
  const r = minimapRect(viewW, viewH);
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

/**
 * If (x, y) is inside the minimap, return the world position the click maps
 * to. Otherwise null. Uses the minimap-center → world inverse formula:
 *   worldX = (clickX - minimapX) / scale
 * Caller is responsible for centering the camera on the returned point.
 */
export function findMinimapClickWorldPos(
  x: number,
  y: number,
  viewW: number,
  viewH: number,
): Vec2 | null {
  if (!isPointInMinimap(x, y, viewW, viewH)) return null;
  const r = minimapRect(viewW, viewH);
  const scale = minimapScale();
  return {
    x: (x - r.x) / scale,
    y: (y - r.y) / scale,
  };
}

/**
 * Center the camera on a world position, clamping to world bounds. Mutates
 * the passed camera in place. Centralized here so handler.ts (click-to-pan)
 * and tests share one implementation.
 */
export function centerCameraOn(camera: Camera, worldPos: Vec2): void {
  camera.x = worldPos.x - camera.viewW / 2;
  camera.y = worldPos.y - camera.viewH / 2;
  // Clamp inline (camera.ts's clamp is private; setViewport re-clamps but
  // also overwrites viewW/viewH, which is fine to no-op). Inlining keeps
  // the dependency surface tight.
  const maxX = Math.max(0, WORLD_W - camera.viewW);
  const maxY = Math.max(0, WORLD_H - camera.viewH);
  if (camera.x < 0) camera.x = 0;
  if (camera.y < 0) camera.y = 0;
  if (camera.x > maxX) camera.x = maxX;
  if (camera.y > maxY) camera.y = maxY;
}

function entityWorldPos(e: Entity): Vec2 | null {
  // Buildings store position via cellX/cellY/sizeW/sizeH (footprint TL).
  // Use the footprint center so a CC dot reads at the building's middle.
  if (
    e.cellX !== undefined &&
    e.cellY !== undefined &&
    e.sizeW !== undefined &&
    e.sizeH !== undefined
  ) {
    return {
      x: (e.cellX + e.sizeW / 2) * CELL,
      y: (e.cellY + e.sizeH / 2) * CELL,
    };
  }
  return e.pos;
}

function isBuildingKind(e: Entity): boolean {
  return (
    e.kind === 'commandCenter' ||
    e.kind === 'barracks' ||
    e.kind === 'turret' ||
    e.kind === 'refinery' ||
    e.kind === 'factory' ||
    e.kind === 'supplyDepot'
  );
}

function dotForEntity(e: Entity): { color: string; size: number } | null {
  if (e.kind === 'mineralNode') return { color: MINERAL_DOT, size: RESOURCE_DOT_PX };
  if (e.kind === 'gasGeyser') return { color: GAS_DOT, size: RESOURCE_DOT_PX };
  if (isBuildingKind(e)) return { color: TEAM_DOT_COLORS[e.team], size: BUILDING_DOT_PX };
  // All remaining kinds are units (worker / marine / tank / tank-light /
  // medic / enemyDummy). Color by team.
  return { color: TEAM_DOT_COLORS[e.team], size: UNIT_DOT_PX };
}

export function drawMinimap(
  ctx: CanvasRenderingContext2D,
  world: World,
  camera: Camera,
): void {
  const r = minimapRect(camera.viewW, camera.viewH);

  // Background panel.
  ctx.fillStyle = MINIMAP_BG;
  ctx.fillRect(r.x, r.y, r.w, r.h);

  const scale = minimapScale();

  // Entity dots. Single pass — the entity count is small (low hundreds) so
  // sorting by kind for z-order isn't worth the alloc; resources rendering
  // under units is acceptable for a 2-px dot.
  for (const e of world.entities.values()) {
    const dot = dotForEntity(e);
    if (!dot) continue;
    const wp = entityWorldPos(e);
    if (!wp) continue;
    // Skip dead/off-grid entities defensively (shouldn't happen in practice
    // but guards against bad data crashing the frame).
    if (wp.x < 0 || wp.y < 0 || wp.x >= WORLD_W || wp.y >= WORLD_H) continue;
    const mx = r.x + wp.x * scale;
    const my = r.y + wp.y * scale;
    ctx.fillStyle = dot.color;
    // Center the dot on (mx,my) so the visible dot reads as the entity's
    // location — same reason renderer.ts centers unit circles on pos.
    const half = dot.size / 2;
    ctx.fillRect(mx - half, my - half, dot.size, dot.size);
  }

  // Viewport rectangle — yellow outline showing where the camera is looking.
  // Clamp to minimap bounds so the rectangle stays visually inside the panel
  // even when the camera sits at the world edge.
  const vx = r.x + camera.x * scale;
  const vy = r.y + camera.y * scale;
  const vw = camera.viewW * scale;
  const vh = camera.viewH * scale;
  const cx = Math.max(r.x, vx);
  const cy = Math.max(r.y, vy);
  const cw = Math.min(r.x + r.w, vx + vw) - cx;
  const ch = Math.min(r.y + r.h, vy + vh) - cy;
  if (cw > 0 && ch > 0) {
    ctx.strokeStyle = VIEWPORT_OUTLINE;
    ctx.lineWidth = 1;
    ctx.strokeRect(cx + 0.5, cy + 0.5, cw - 1, ch - 1);
  }

  // Border last so it sits above dots that might land on the edge.
  ctx.strokeStyle = MINIMAP_BORDER;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);

  // Defensive: keep grid dimensions referenced so a future GRID_H/_W
  // mismatch (non-square world) is loud rather than silently miscomputed.
  void GRID_H;
  void GRID_W;
}
