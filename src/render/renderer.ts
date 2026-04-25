import {
  CELL,
  GRID_H,
  GRID_W,
  WORLD_H,
  WORLD_W,
  type Entity,
  type Team,
} from '../types';
import { BUILDING_DEFS } from '../game/entities';
import type { World } from '../game/world';
import type { Camera } from '../game/camera';

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

export function renderWorld(
  ctx: CanvasRenderingContext2D,
  world: World,
  cam: Camera,
  drag: DragBox | null,
): void {
  ctx.save();
  ctx.translate(-cam.x, -cam.y);

  drawBackground(ctx, cam);
  drawGrid(ctx, cam);
  drawMineralNodes(ctx, world);
  drawBuildings(ctx, world);
  drawUnits(ctx, world);
  drawSelection(ctx, world);
  drawHPBars(ctx, world);

  ctx.restore();

  if (drag) drawDragBox(ctx, drag);
}

function drawBackground(ctx: CanvasRenderingContext2D, cam: Camera): void {
  ctx.fillStyle = '#1c2a1c';
  ctx.fillRect(cam.x, cam.y, cam.viewW, cam.viewH);
}

function drawGrid(ctx: CanvasRenderingContext2D, cam: Camera): void {
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  const x0 = Math.max(0, Math.floor(cam.x / CELL));
  const y0 = Math.max(0, Math.floor(cam.y / CELL));
  const x1 = Math.min(GRID_W, Math.ceil((cam.x + cam.viewW) / CELL));
  const y1 = Math.min(GRID_H, Math.ceil((cam.y + cam.viewH) / CELL));
  ctx.beginPath();
  for (let x = x0; x <= x1; x++) {
    ctx.moveTo(x * CELL, y0 * CELL);
    ctx.lineTo(x * CELL, y1 * CELL);
  }
  for (let y = y0; y <= y1; y++) {
    ctx.moveTo(x0 * CELL, y * CELL);
    ctx.lineTo(x1 * CELL, y * CELL);
  }
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.strokeRect(0, 0, WORLD_W, WORLD_H);
}

function drawMineralNodes(ctx: CanvasRenderingContext2D, world: World): void {
  for (const e of world.entities.values()) {
    if (e.kind !== 'mineralNode') continue;
    const half = CELL * 0.45;
    ctx.fillStyle = '#34c8b0';
    ctx.fillRect(e.pos.x - half, e.pos.y - half, half * 2, half * 2);
    ctx.strokeStyle = '#0f5e52';
    ctx.lineWidth = 1;
    ctx.strokeRect(e.pos.x - half, e.pos.y - half, half * 2, half * 2);
  }
}

function drawBuildings(ctx: CanvasRenderingContext2D, world: World): void {
  for (const e of world.entities.values()) {
    if (!isBuilding(e)) continue;
    const def = BUILDING_DEFS[e.kind as keyof typeof BUILDING_DEFS];
    const x = (e.cellX ?? 0) * CELL;
    const y = (e.cellY ?? 0) * CELL;
    const w = def.w * CELL;
    const h = def.h * CELL;

    const color = TEAM_COLORS[e.team];
    ctx.globalAlpha = e.underConstruction ? 0.5 : 1;
    ctx.fillStyle = darken(color, 0.5);
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

    // simple kind glyph
    ctx.fillStyle = color;
    ctx.font = `${Math.floor(CELL * 0.7)}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(buildingGlyph(e.kind), x + w / 2, y + h / 2);
    ctx.globalAlpha = 1;

    if (e.underConstruction && e.buildTotalSeconds && e.buildTotalSeconds > 0) {
      const p = (e.buildProgress ?? 0) / e.buildTotalSeconds;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x, y + h + 4, w, 5);
      ctx.fillStyle = '#f0c040';
      ctx.fillRect(x, y + h + 4, w * p, 5);
    }
  }
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}

function drawUnits(ctx: CanvasRenderingContext2D, world: World): void {
  for (const e of world.entities.values()) {
    if (!isUnit(e)) continue;
    const r = e.radius ?? 10;
    const color = TEAM_COLORS[e.team];

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(e.pos.x, e.pos.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = darken(color, 0.4);
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (e.kind === 'worker' && (e.carrying ?? 0) > 0) {
      ctx.fillStyle = '#34c8b0';
      ctx.beginPath();
      ctx.arc(e.pos.x, e.pos.y - r - 4, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
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
    } else {
      const r = (e.radius ?? 10) + 4;
      ctx.beginPath();
      ctx.arc(e.pos.x, e.pos.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

function drawHPBars(ctx: CanvasRenderingContext2D, world: World): void {
  for (const e of world.entities.values()) {
    if (e.kind === 'mineralNode') continue;
    if (e.hp >= e.hpMax && !world.selection.has(e.id)) continue;

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

function isUnit(e: Entity): boolean {
  return e.kind === 'worker' || e.kind === 'marine' || e.kind === 'enemyDummy';
}

function isBuilding(e: Entity): boolean {
  return (
    e.kind === 'commandCenter' || e.kind === 'barracks' || e.kind === 'turret'
  );
}

function buildingGlyph(kind: string): string {
  switch (kind) {
    case 'commandCenter':
      return 'CC';
    case 'barracks':
      return 'B';
    case 'turret':
      return 'T';
    default:
      return '?';
  }
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
