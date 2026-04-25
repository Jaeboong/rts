import {
  CELL,
  GRID_H,
  GRID_W,
  type BuildingKind,
  type Entity,
  type Team,
  type Vec2,
} from '../types';
import { BUILDING_DEFS } from '../game/balance';
import { canPlace, canPlaceRefinery, unclaimedGeyserAt } from '../game/commands';
import { drawTileBackground } from '../game/map/tile-render';
import type { AutotileAtlas } from '../game/map/tiles';
import type { World } from '../game/world';
import type { Camera } from '../game/camera';
import {
  pickBuildingSprite,
  pickResourceSprite,
  type SpriteAtlas,
} from './sprites';
import { drawUnits } from './units-render';

const TEAM_COLORS: Record<Team, string> = {
  player: '#4a8cff',
  enemy: '#ff5c5c',
  neutral: '#a0a0a0',
};

export interface DragBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface RallyVisualization {
  from: Vec2;
  to: Vec2;
}

export function getRallyVisualizations(world: World): RallyVisualization[] {
  const out: RallyVisualization[] = [];
  for (const id of world.selection) {
    const e = world.entities.get(id);
    if (!e) continue;
    if (!isBuilding(e)) continue;
    if (e.rallyPoint === undefined || e.rallyPoint === null) continue;
    if (
      e.cellX === undefined ||
      e.cellY === undefined ||
      e.sizeW === undefined ||
      e.sizeH === undefined
    ) {
      continue;
    }
    const from: Vec2 = {
      x: (e.cellX + e.sizeW / 2) * CELL,
      y: (e.cellY + e.sizeH / 2) * CELL,
    };
    out.push({ from, to: { x: e.rallyPoint.x, y: e.rallyPoint.y } });
  }
  return out;
}

export interface PlacementPreview {
  cellX: number;
  cellY: number;
  sizeW: number;
  sizeH: number;
  valid: boolean;
}

/**
 * Shape mouse + placement state into the rect+validity needed by the preview pass.
 * Returns null when no preview should render (no placement, off-grid mouse).
 * Refinery snaps to geyser TL when mouse is over an unclaimed geyser, otherwise
 * renders at mouse cell as red — mirroring confirmPlacement's snap rule.
 */
export function computePlacementPreview(
  world: World,
  kind: BuildingKind,
  mouseWorld: Vec2,
): PlacementPreview | null {
  const def = BUILDING_DEFS[kind];
  const clickCellX = Math.floor(mouseWorld.x / CELL);
  const clickCellY = Math.floor(mouseWorld.y / CELL);
  if (clickCellX < 0 || clickCellY < 0 || clickCellX >= GRID_W || clickCellY >= GRID_H) {
    return null;
  }
  if (kind === 'refinery') {
    const geyser = unclaimedGeyserAt(world, clickCellX, clickCellY);
    if (geyser && geyser.cellX !== undefined && geyser.cellY !== undefined) {
      return {
        cellX: geyser.cellX,
        cellY: geyser.cellY,
        sizeW: def.w,
        sizeH: def.h,
        valid: canPlaceRefinery(world, geyser.cellX, geyser.cellY, geyser.id),
      };
    }
    // No canonical TL when off-geyser — show 5×5 anchored at mouse cell as invalid.
    return {
      cellX: clickCellX,
      cellY: clickCellY,
      sizeW: def.w,
      sizeH: def.h,
      valid: false,
    };
  }
  const cellX = clickCellX - Math.floor(def.w / 2);
  const cellY = clickCellY - Math.floor(def.h / 2);
  return {
    cellX,
    cellY,
    sizeW: def.w,
    sizeH: def.h,
    valid: canPlace(world, cellX, cellY, def.w, def.h),
  };
}

export function renderWorld(
  ctx: CanvasRenderingContext2D,
  world: World,
  cam: Camera,
  drag: DragBox | null,
  mouseWorld: Vec2 | null,
  atlas: SpriteAtlas | null = null,
  tileAtlas: AutotileAtlas | null = null,
): void {
  ctx.save();
  ctx.translate(-cam.x, -cam.y);

  // Procedural tilemap renders independently of atlas while terrain sprites
  // aren't ready; fall back to solid fill only when world.tiles is empty.
  if (world.tiles && world.tiles.length > 0) {
    drawTileBackground(ctx, world, cam, tileAtlas);
  } else {
    drawBackground(ctx, cam);
  }
  drawMineralNodes(ctx, world, atlas);
  drawGasGeysers(ctx, world, atlas);
  drawBuildings(ctx, world, atlas);
  drawUnits(ctx, world, atlas);
  drawPlacementPreview(ctx, world, mouseWorld);
  drawSelection(ctx, world);
  drawRallyPoints(ctx, world);
  drawHPBars(ctx, world);

  ctx.restore();

  if (drag) drawDragBox(ctx, drag);
}

function drawPlacementPreview(
  ctx: CanvasRenderingContext2D,
  world: World,
  mouseWorld: Vec2 | null,
): void {
  if (!world.placement || !mouseWorld) return;
  const preview = computePlacementPreview(world, world.placement.buildingKind, mouseWorld);
  if (!preview) return;
  const x = preview.cellX * CELL;
  const y = preview.cellY * CELL;
  const w = preview.sizeW * CELL;
  const h = preview.sizeH * CELL;
  ctx.fillStyle = preview.valid ? 'rgba(124,240,124,0.25)' : 'rgba(255,92,92,0.25)';
  ctx.strokeStyle = preview.valid ? '#7cf07c' : '#ff5c5c';
  ctx.lineWidth = 2;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
}

function drawBackground(ctx: CanvasRenderingContext2D, cam: Camera): void {
  ctx.fillStyle = '#1c2a1c';
  ctx.fillRect(cam.x, cam.y, cam.viewW, cam.viewH);
}

function drawMineralNodes(
  ctx: CanvasRenderingContext2D,
  world: World,
  atlas: SpriteAtlas | null,
): void {
  for (const e of world.entities.values()) {
    if (e.kind !== 'mineralNode') continue;
    if (e.cellX === undefined || e.cellY === undefined || !e.sizeW || !e.sizeH) {
      continue;
    }
    const x0 = e.cellX * CELL;
    const y0 = e.cellY * CELL;
    const w = e.sizeW * CELL;
    const h = e.sizeH * CELL;
    if (atlas) {
      const key = pickResourceSprite('mineralNode');
      const img = atlas.getTinted(key, e.team);
      const bb = atlas.bbox[key];
      ctx.drawImage(img, bb.sx, bb.sy, bb.sw, bb.sh, x0, y0, w, h);
    } else {
      const inset = CELL * 0.05;
      ctx.fillStyle = '#34c8b0';
      ctx.fillRect(x0 + inset, y0 + inset, w - inset * 2, h - inset * 2);
      ctx.strokeStyle = '#0f5e52';
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 + inset, y0 + inset, w - inset * 2, h - inset * 2);
    }
  }
}

function drawGasGeysers(
  ctx: CanvasRenderingContext2D,
  world: World,
  atlas: SpriteAtlas | null,
): void {
  for (const e of world.entities.values()) {
    if (e.kind !== 'gasGeyser') continue;
    if (e.cellX === undefined || e.cellY === undefined || !e.sizeW || !e.sizeH) {
      continue;
    }
    // Hide geysers claimed by a refinery — refinery draws on top of them.
    if (e.refineryId !== null && e.refineryId !== undefined) continue;
    const x0 = e.cellX * CELL;
    const y0 = e.cellY * CELL;
    const w = e.sizeW * CELL;
    const h = e.sizeH * CELL;
    if (atlas) {
      const key = pickResourceSprite('gasGeyser');
      const img = atlas.getTinted(key, e.team);
      const bb = atlas.bbox[key];
      ctx.drawImage(img, bb.sx, bb.sy, bb.sw, bb.sh, x0, y0, w, h);
    } else {
      const inset = CELL * 0.05;
      ctx.fillStyle = '#1ad1c2';
      ctx.fillRect(x0 + inset, y0 + inset, w - inset * 2, h - inset * 2);
      ctx.strokeStyle = '#0a5b56';
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 + inset, y0 + inset, w - inset * 2, h - inset * 2);
      ctx.fillStyle = '#0a5b56';
      ctx.font = `${Math.floor((e.sizeW ?? 2) * CELL * 0.5)}px ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('V', x0 + w / 2, y0 + h / 2);
    }
  }
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}

function drawBuildings(
  ctx: CanvasRenderingContext2D,
  world: World,
  atlas: SpriteAtlas | null,
): void {
  for (const e of world.entities.values()) {
    if (!isBuilding(e)) continue;
    const def = BUILDING_DEFS[e.kind as keyof typeof BUILDING_DEFS];
    const x = (e.cellX ?? 0) * CELL;
    const y = (e.cellY ?? 0) * CELL;
    const w = def.w * CELL;
    const h = def.h * CELL;

    if (atlas) {
      ctx.globalAlpha = e.underConstruction ? 0.5 : 1;
      const key = pickBuildingSprite(e);
      const img = atlas.getTinted(key, e.team);
      const bb = atlas.bbox[key];
      ctx.drawImage(img, bb.sx, bb.sy, bb.sw, bb.sh, x, y, w, h);
      ctx.globalAlpha = 1;
    } else {
      const color = TEAM_COLORS[e.team];
      ctx.globalAlpha = e.underConstruction ? 0.5 : 1;
      ctx.fillStyle = darken(color, 0.5);
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      ctx.globalAlpha = 1;
    }

    if (e.underConstruction && e.buildTotalSeconds && e.buildTotalSeconds > 0) {
      const p = (e.buildProgress ?? 0) / e.buildTotalSeconds;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x, y - 8, w, 5);
      ctx.fillStyle = '#f0c040';
      ctx.fillRect(x, y - 8, w * p, 5);
    }
  }
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}

function drawSelection(ctx: CanvasRenderingContext2D, world: World): void {
  for (const id of world.selection) {
    const e = world.entities.get(id);
    if (!e) continue;
    ctx.strokeStyle = '#7cf07c';
    ctx.lineWidth = 2;
    if (isBuilding(e)) {
      const def = BUILDING_DEFS[e.kind as keyof typeof BUILDING_DEFS];
      const x = (e.cellX ?? 0) * CELL;
      const y = (e.cellY ?? 0) * CELL;
      const w = def.w * CELL;
      const h = def.h * CELL;
      ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
    } else if (e.kind === 'mineralNode' || e.kind === 'gasGeyser') {
      // Resource nodes render as a rect across cellX/cellY/sizeW/sizeH; pos is top-left cell center, not footprint center.
      if (
        e.cellX === undefined ||
        e.cellY === undefined ||
        !e.sizeW ||
        !e.sizeH
      ) {
        continue;
      }
      const x = e.cellX * CELL;
      const y = e.cellY * CELL;
      const w = e.sizeW * CELL;
      const h = e.sizeH * CELL;
      ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
    } else {
      const r = (e.radius ?? 10) + 4;
      ctx.beginPath();
      ctx.arc(e.pos.x, e.pos.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

function drawRallyPoints(ctx: CanvasRenderingContext2D, world: World): void {
  const items = getRallyVisualizations(world);
  if (items.length === 0) return;
  ctx.strokeStyle = '#ffd700';
  ctx.fillStyle = '#ffd700';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  for (const { from, to } of items) {
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const { to } of items) {
    ctx.beginPath();
    ctx.arc(to.x, to.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function shouldDrawHpBar(e: Entity, selected: boolean): boolean {
  if (e.kind === 'mineralNode' || e.kind === 'gasGeyser') return false;
  if (isBuilding(e) && e.underConstruction === true) return false;
  if (e.hp >= e.hpMax && !selected) return false;
  return true;
}

function drawHPBars(ctx: CanvasRenderingContext2D, world: World): void {
  for (const e of world.entities.values()) {
    if (!shouldDrawHpBar(e, world.selection.has(e.id))) continue;

    const ratio = Math.max(0, Math.min(1, e.hp / e.hpMax));
    let x: number, y: number, w: number;
    if (isBuilding(e)) {
      const def = BUILDING_DEFS[e.kind as keyof typeof BUILDING_DEFS];
      x = (e.cellX ?? 0) * CELL;
      y = (e.cellY ?? 0) * CELL - 8;
      w = def.w * CELL;
    } else {
      const r = e.radius ?? 10;
      x = e.pos.x - r;
      y = e.pos.y - r - 8;
      w = r * 2;
    }
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x, y, w, 4);
    ctx.fillStyle = ratio > 0.5 ? '#7cf07c' : ratio > 0.25 ? '#f0c040' : '#ff5c5c';
    ctx.fillRect(x, y, w * ratio, 4);
  }
}

function drawDragBox(ctx: CanvasRenderingContext2D, drag: DragBox): void {
  const x = Math.min(drag.x0, drag.x1);
  const y = Math.min(drag.y0, drag.y1);
  const w = Math.abs(drag.x1 - drag.x0);
  const h = Math.abs(drag.y1 - drag.y0);
  ctx.strokeStyle = 'rgba(124,240,124,0.9)';
  ctx.fillStyle = 'rgba(124,240,124,0.15)';
  ctx.lineWidth = 1;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
}

function isBuilding(e: Entity): boolean {
  return (
    e.kind === 'commandCenter' ||
    e.kind === 'barracks' ||
    e.kind === 'turret' ||
    e.kind === 'refinery' ||
    e.kind === 'factory'
  );
}

function darken(hex: string, factor: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  const r = Math.round(((v >> 16) & 0xff) * factor);
  const g = Math.round(((v >> 8) & 0xff) * factor);
  const b = Math.round((v & 0xff) * factor);
  return `rgb(${r}, ${g}, ${b})`;
}
