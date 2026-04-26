import { CELL, GRID_H, GRID_W, WORLD_H, WORLD_W, type Team } from '../types';
import type { SpriteAtlas, SpriteKey } from '../render/sprites';
import type { TileKind } from '../game/map/types';
import {
  entityCenterPx,
  getEntityFootprint,
  isInBounds,
  type EditorEntity,
  type EditorEntityKind,
  type EditorState,
} from './editor-state';

interface VisibleRange {
  minCx: number;
  maxCx: number;
  minCy: number;
  maxCy: number;
}

export function renderEditor(
  ctx: CanvasRenderingContext2D,
  state: EditorState,
  sprites: SpriteAtlas | null,
): void {
  const width = state.camera.viewW;
  const height = state.camera.viewH;
  const dpr = Math.max(1, ctx.canvas.width / Math.max(1, width));

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#151511';
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.translate(-state.camera.x, -state.camera.y);
  drawTiles(ctx, state);
  drawWorldBorder(ctx);
  drawEntities(ctx, state.entities, sprites);
  drawHover(ctx, state);
  ctx.restore();
}

function drawTiles(ctx: CanvasRenderingContext2D, state: EditorState): void {
  const range = getVisibleRange(state.camera.x, state.camera.y, state.camera.viewW, state.camera.viewH);
  for (let cy = range.minCy; cy <= range.maxCy; cy++) {
    for (let cx = range.minCx; cx <= range.maxCx; cx++) {
      const tile = state.tiles[cy * GRID_W + cx];
      ctx.fillStyle = tileFill(tile);
      ctx.fillRect(cx * CELL, cy * CELL, CELL, CELL);
    }
  }
  drawGrid(ctx, range);
}

function drawGrid(ctx: CanvasRenderingContext2D, range: VisibleRange): void {
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let cx = range.minCx; cx <= range.maxCx + 1; cx++) {
    const x = cx * CELL + 0.5;
    ctx.moveTo(x, range.minCy * CELL);
    ctx.lineTo(x, (range.maxCy + 1) * CELL);
  }
  for (let cy = range.minCy; cy <= range.maxCy + 1; cy++) {
    const y = cy * CELL + 0.5;
    ctx.moveTo(range.minCx * CELL, y);
    ctx.lineTo((range.maxCx + 1) * CELL, y);
  }
  ctx.stroke();
}

function drawWorldBorder(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = 'rgba(255, 246, 199, 0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, WORLD_W - 2, WORLD_H - 2);
}

function drawEntities(
  ctx: CanvasRenderingContext2D,
  entities: readonly EditorEntity[],
  sprites: SpriteAtlas | null,
): void {
  for (const entity of entities) drawEntity(ctx, entity, sprites);
}

function drawEntity(
  ctx: CanvasRenderingContext2D,
  entity: EditorEntity,
  sprites: SpriteAtlas | null,
): void {
  if (sprites && drawEntitySprite(ctx, entity, sprites)) return;
  drawEntityFallback(ctx, entity);
}

function drawEntitySprite(
  ctx: CanvasRenderingContext2D,
  entity: EditorEntity,
  sprites: SpriteAtlas,
): boolean {
  const key = spriteKeyForEntity(entity.kind);
  if (!key) return false;
  const foot = getEntityFootprint(entity);
  const bbox = sprites.bbox[key];
  const image = tintedKind(entity.kind)
    ? sprites.getTinted(key, renderTeam(entity.team))
    : sprites.base[key];
  ctx.drawImage(
    image,
    bbox.sx,
    bbox.sy,
    bbox.sw,
    bbox.sh,
    foot.cellX * CELL,
    foot.cellY * CELL,
    foot.w * CELL,
    foot.h * CELL,
  );
  drawEntityOutline(ctx, entity);
  return true;
}

function drawEntityFallback(ctx: CanvasRenderingContext2D, entity: EditorEntity): void {
  const foot = getEntityFootprint(entity);
  const x = foot.cellX * CELL;
  const y = foot.cellY * CELL;
  const w = foot.w * CELL;
  const h = foot.h * CELL;

  if (foot.w === 1 && foot.h === 1) {
    const center = entityCenterPx(entity);
    ctx.fillStyle = entityFill(entity);
    ctx.beginPath();
    ctx.arc(center.x, center.y, 6, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = entityFill(entity);
    ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
  }
  drawEntityOutline(ctx, entity);
}

function drawEntityOutline(ctx: CanvasRenderingContext2D, entity: EditorEntity): void {
  const foot = getEntityFootprint(entity);
  ctx.strokeStyle = entityStroke(entity);
  ctx.lineWidth = 2;
  ctx.strokeRect(
    foot.cellX * CELL + 1,
    foot.cellY * CELL + 1,
    foot.w * CELL - 2,
    foot.h * CELL - 2,
  );
}

function drawHover(ctx: CanvasRenderingContext2D, state: EditorState): void {
  const hover = state.hoverCell;
  if (!hover || !isInBounds(hover.cellX, hover.cellY)) return;
  ctx.strokeStyle = state.tool === 'erase' ? '#ff8b73' : '#fff2a1';
  ctx.lineWidth = 2;
  ctx.strokeRect(hover.cellX * CELL + 1, hover.cellY * CELL + 1, CELL - 2, CELL - 2);

  if (state.tool !== 'place') return;
  const preview: EditorEntity = {
    kind: state.selectedEntity.kind,
    team: state.selectedEntity.team,
    cellX: hover.cellX,
    cellY: hover.cellY,
  };
  const foot = getEntityFootprint(preview);
  ctx.strokeStyle = 'rgba(255, 242, 161, 0.7)';
  ctx.strokeRect(
    foot.cellX * CELL + 1,
    foot.cellY * CELL + 1,
    foot.w * CELL - 2,
    foot.h * CELL - 2,
  );
}

function getVisibleRange(camX: number, camY: number, viewW: number, viewH: number): VisibleRange {
  const minCx = Math.max(0, Math.floor(camX / CELL));
  const minCy = Math.max(0, Math.floor(camY / CELL));
  const maxCx = Math.min(GRID_W - 1, Math.floor((camX + viewW - 1) / CELL));
  const maxCy = Math.min(GRID_H - 1, Math.floor((camY + viewH - 1) / CELL));
  return { minCx, maxCx, minCy, maxCy };
}

function tileFill(kind: TileKind): string {
  if (kind.startsWith('grass-')) return '#3d6e2e';
  if (kind.startsWith('dirt-')) return '#7a5e3a';
  if (kind.startsWith('wall-')) return '#6b665a';
  if (kind.startsWith('water-')) return '#2e5a78';
  switch (kind) {
    case 'prop-rocks':
      return '#526040';
    case 'prop-bush':
      return '#2f6229';
    case 'prop-tree':
      return '#254f22';
    case 'prop-fire':
      return '#a84d24';
    case 'prop-well':
      return '#354a66';
  }
  return '#3d6e2e';
}

function entityFill(entity: EditorEntity): string {
  switch (entity.kind) {
    case 'mineralNode':
      return '#7fd1d6';
    case 'gasGeyser':
      return '#72c37b';
    case 'supplyDepot':
      return '#c4a04d';
    default:
      return teamFill(renderTeam(entity.team));
  }
}

function entityStroke(entity: EditorEntity): string {
  switch (renderTeam(entity.team)) {
    case 'player':
      return '#d4e7ff';
    case 'enemy':
      return '#ffd5d0';
    case 'neutral':
      return '#f3ecd0';
  }
}

function teamFill(team: Team): string {
  switch (team) {
    case 'player':
      return '#3a6ea5';
    case 'enemy':
      return '#a53a3a';
    case 'neutral':
      return '#8d8a78';
  }
}

function renderTeam(team: Team | undefined): Team {
  return team ?? 'neutral';
}

function tintedKind(kind: EditorEntityKind): boolean {
  return kind !== 'mineralNode' && kind !== 'gasGeyser' && kind !== 'enemyDummy';
}

function spriteKeyForEntity(kind: EditorEntityKind): SpriteKey | null {
  switch (kind) {
    case 'commandCenter':
      return 'commandCenter-idle';
    case 'barracks':
      return 'barracks-idle';
    case 'factory':
      return 'factory-idle';
    case 'refinery':
      return 'refinery';
    case 'turret':
      return 'turret-idle';
    case 'supplyDepot':
      return 'supply-depot';
    case 'mineralNode':
      return 'mineral-base';
    case 'gasGeyser':
      return 'gas-geyser';
    case 'worker':
      return 'worker';
    case 'marine':
      return 'marine';
    case 'tank':
      return 'tank';
    case 'tank-light':
      return 'tank-light';
    case 'medic':
      return 'medic';
    case 'enemyDummy':
      return 'enemy-dummy';
  }
}
