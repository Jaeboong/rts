import { BUILDING_DEFS, UNIT_PRODUCTION } from '../game/entities';
import type { World } from '../game/world';
import type { BuildingKind } from '../types';

export interface UIButton {
  label: string;
  action: UIAction;
  enabled: boolean;
  rect: { x: number; y: number; w: number; h: number };
}

export type UIAction =
  | { type: 'produce'; unit: 'worker' | 'marine' }
  | { type: 'beginPlace'; building: BuildingKind }
  | { type: 'cancelPlacement' };

export interface HUDState {
  fps: number;
  tickCount: number;
  buttons: UIButton[];
}

const PANEL_H = 130;
const BUTTON_W = 92;
const BUTTON_H = 36;
const BUTTON_PAD = 8;

export function drawHUD(
  ctx: CanvasRenderingContext2D,
  world: World,
  hud: HUDState,
  viewW: number,
  viewH: number,
): void {
  // top-left: fps + tick + resources
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, 220, 64);
  ctx.fillStyle = '#e0e0e0';
  ctx.font = '14px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'start';
  ctx.fillText(`fps:  ${hud.fps}`, 10, 8);
  ctx.fillText(`tick: ${hud.tickCount}`, 10, 26);
  ctx.fillStyle = '#34c8b0';
  ctx.fillText(`mineral: ${world.resources.player}`, 10, 44);

  // bottom panel
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, viewH - PANEL_H, viewW, PANEL_H);

  hud.buttons = computeButtons(world, viewW, viewH);

  drawSelectionInfo(ctx, world, viewH);
  drawButtons(ctx, hud.buttons);

  // placement hint
  if (world.placement) {
    ctx.fillStyle = '#f0c040';
    ctx.fillText(
      `placing ${world.placement.buildingKind} — left click to confirm, Esc to cancel`,
      230,
      8,
    );
  }
}

function drawSelectionInfo(
  ctx: CanvasRenderingContext2D,
  world: World,
  viewH: number,
): void {
  const ids = [...world.selection];
  ctx.fillStyle = '#e0e0e0';
  ctx.font = '13px ui-monospace, monospace';
  ctx.textAlign = 'start';
  ctx.textBaseline = 'top';
  const baseY = viewH - PANEL_H + 10;
  if (ids.length === 0) {
    ctx.fillStyle = '#888';
    ctx.fillText('no selection', 12, baseY);
    return;
  }
  if (ids.length === 1) {
    const e = world.entities.get(ids[0]);
    if (!e) return;
    ctx.fillText(`${e.kind}  team=${e.team}`, 12, baseY);
    ctx.fillText(`HP: ${Math.ceil(e.hp)}/${e.hpMax}`, 12, baseY + 18);
    if (e.kind === 'worker') {
      ctx.fillText(`carrying: ${e.carrying ?? 0}`, 12, baseY + 36);
    }
    if (e.productionQueue && e.productionQueue.length > 0) {
      const head = e.productionQueue[0];
      const pct = 1 - head.remainingSeconds / head.totalSeconds;
      ctx.fillText(
        `producing ${head.produces} ${(pct * 100).toFixed(0)}%  queue=${e.productionQueue.length}`,
        12,
        baseY + 36,
      );
    }
    if (e.underConstruction) {
      const p = (e.buildProgress ?? 0) / (e.buildTotalSeconds ?? 1);
      ctx.fillText(`under construction ${(p * 100).toFixed(0)}%`, 12, baseY + 54);
    }
    if (e.kind === 'mineralNode') {
      ctx.fillText(`remaining: ${e.remaining ?? 0}`, 12, baseY + 18);
    }
  } else {
    const counts = new Map<string, number>();
    for (const id of ids) {
      const e = world.entities.get(id);
      if (!e) continue;
      counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
    }
    let y = baseY;
    ctx.fillText(`selected: ${ids.length}`, 12, y);
    y += 18;
    for (const [k, c] of counts) {
      ctx.fillText(`  ${k} × ${c}`, 12, y);
      y += 16;
    }
  }
}

function drawButtons(ctx: CanvasRenderingContext2D, buttons: UIButton[]): void {
  ctx.font = '13px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const b of buttons) {
    ctx.fillStyle = b.enabled ? 'rgba(74,140,255,0.25)' : 'rgba(80,80,80,0.25)';
    ctx.fillRect(b.rect.x, b.rect.y, b.rect.w, b.rect.h);
    ctx.strokeStyle = b.enabled ? '#4a8cff' : '#555';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(b.rect.x + 0.5, b.rect.y + 0.5, b.rect.w - 1, b.rect.h - 1);
    ctx.fillStyle = b.enabled ? '#e0e0e0' : '#777';
    ctx.fillText(
      b.label,
      b.rect.x + b.rect.w / 2,
      b.rect.y + b.rect.h / 2,
    );
  }
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}

function computeButtons(world: World, _viewW: number, viewH: number): UIButton[] {
  const ids = [...world.selection];
  if (ids.length === 0) return [];
  // Use first selected entity to drive panel actions
  const e = world.entities.get(ids[0]);
  if (!e || e.team !== 'player') return [];

  const buttons: UIButton[] = [];
  const startX = 240;
  const baseY = viewH - 120 + 10;
  let i = 0;

  const addBtn = (label: string, action: UIAction, enabled: boolean) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x = startX + col * (BUTTON_W + BUTTON_PAD);
    const y = baseY + row * (BUTTON_H + BUTTON_PAD);
    buttons.push({
      label,
      action,
      enabled,
      rect: { x, y, w: BUTTON_W, h: BUTTON_H },
    });
    i++;
  };

  if (world.placement) {
    addBtn('Cancel (Esc)', { type: 'cancelPlacement' }, true);
    return buttons;
  }

  if (e.kind === 'commandCenter' && !e.underConstruction) {
    const def = UNIT_PRODUCTION.worker!;
    addBtn(
      `Worker (${def.cost})`,
      { type: 'produce', unit: 'worker' },
      world.resources.player >= def.cost,
    );
  }
  if (e.kind === 'barracks' && !e.underConstruction) {
    const def = UNIT_PRODUCTION.marine!;
    addBtn(
      `Marine (${def.cost})`,
      { type: 'produce', unit: 'marine' },
      world.resources.player >= def.cost,
    );
  }
  if (e.kind === 'worker') {
    for (const k of ['barracks', 'turret'] as BuildingKind[]) {
      const def = BUILDING_DEFS[k];
      addBtn(
        `${k} (${def.cost})`,
        { type: 'beginPlace', building: k },
        world.resources.player >= def.cost,
      );
    }
  }
  return buttons;
}

export function findButtonAt(
  hud: HUDState,
  x: number,
  y: number,
): UIButton | null {
  for (const b of hud.buttons) {
    if (
      x >= b.rect.x &&
      x <= b.rect.x + b.rect.w &&
      y >= b.rect.y &&
      y <= b.rect.y + b.rect.h
    ) {
      return b;
    }
  }
  return null;
}
