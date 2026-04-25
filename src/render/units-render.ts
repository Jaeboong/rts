import { type Entity, type Team } from '../types';
import type { World } from '../game/world';
import { pickUnitSprite, type SpriteAtlas, type SpriteKey } from './sprites';

const TEAM_COLORS: Record<Team, string> = {
  player: '#4a8cff',
  enemy: '#ff5c5c',
  neutral: '#a0a0a0',
};

export function drawUnits(
  ctx: CanvasRenderingContext2D,
  world: World,
  atlas: SpriteAtlas | null,
): void {
  for (const e of world.entities.values()) {
    if (!isUnit(e)) continue;

    const spriteKey = atlas ? pickUnitSprite(e) : null;
    if (atlas && spriteKey !== null) {
      drawSpriteUnit(ctx, e, atlas, spriteKey);
    } else {
      drawShapeUnit(ctx, e);
    }
  }
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}

function drawSpriteUnit(
  ctx: CanvasRenderingContext2D,
  e: Entity,
  atlas: SpriteAtlas,
  spriteKey: SpriteKey,
): void {
  const img = atlas.getTinted(spriteKey, e.team);
  // Use opaque-pixel bbox so the unit visually occupies its full rendered size
  // without transparent padding scaling down the apparent silhouette.
  const bb = atlas.bbox[spriteKey];
  const sw = bb.sw;
  const sh = bb.sh;
  ctx.save();
  ctx.translate(e.pos.x, e.pos.y);
  // Sprite canonical pose is north (-π/2). atan2-derived facing rotates by facing+π/2
  // to align canonical north with screen-CW canvas rotation.
  if (e.facing !== undefined) {
    ctx.rotate(e.facing + Math.PI / 2);
  }
  ctx.drawImage(img, bb.sx, bb.sy, bb.sw, bb.sh, -sw / 2, -sh / 2, sw, sh);
  ctx.restore();

  // Worker carrying indicator — drawn after restore so it stays upright.
  if (e.kind === 'worker' && (e.carrying ?? 0) > 0) {
    const r = e.radius ?? 10;
    ctx.fillStyle = '#34c8b0';
    ctx.beginPath();
    ctx.arc(e.pos.x, e.pos.y - r - 4, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawShapeUnit(ctx: CanvasRenderingContext2D, e: Entity): void {
  const r = e.radius ?? 10;
  if (e.kind === 'medic') {
    drawMedicShape(ctx, e, r);
    return;
  }
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
  if (e.kind === 'tank') {
    ctx.fillStyle = darken(color, 0.2);
    ctx.font = `${Math.floor(r * 1.1)}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('T', e.pos.x, e.pos.y);
  }
}

// Medic: white circle body + central team-color disk to keep player/enemy distinction +
// red cross overlay (Red Cross symbol).
function drawMedicShape(ctx: CanvasRenderingContext2D, e: Entity, r: number): void {
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(e.pos.x, e.pos.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#888';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const teamColor = TEAM_COLORS[e.team];
  ctx.fillStyle = teamColor;
  ctx.beginPath();
  ctx.arc(e.pos.x, e.pos.y, r * 0.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#d83a3a';
  const cw = r * 0.7;
  const ch = r * 0.22;
  ctx.fillRect(e.pos.x - cw / 2, e.pos.y - ch / 2, cw, ch);
  ctx.fillRect(e.pos.x - ch / 2, e.pos.y - cw / 2, ch, cw);
}

function isUnit(e: Entity): boolean {
  return (
    e.kind === 'worker' ||
    e.kind === 'marine' ||
    e.kind === 'tank' ||
    e.kind === 'tank-light' ||
    e.kind === 'medic' ||
    e.kind === 'enemyDummy'
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
