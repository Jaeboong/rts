import { BUILDING_DEFS, UNIT_PRODUCTION } from '../game/balance';
import type { SpeedFactor } from '../game/loop';
import type { World } from '../game/world';
import type { BuildingKind } from '../types';
import {
  ACTION_HOTKEYS,
  actionDisplayName,
  actionKey,
  drawTooltip,
} from './tooltip';

export const SPEED_FACTORS: readonly SpeedFactor[] = [1, 2, 4] as const;

export interface UIButton {
  label: string;
  action: UIAction;
  enabled: boolean;
  rect: { x: number; y: number; w: number; h: number };
}

export type UIAction =
  | { type: 'produce'; unit: 'worker' | 'marine' | 'medic' | 'tank' | 'tank-light' }
  | { type: 'beginPlace'; building: BuildingKind }
  | { type: 'cancelPlacement' };

export interface HUDState {
  fps: number;
  tickCount: number;
  buttons: UIButton[];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PANEL_H = 130;
const BUTTON_W = 92;
const BUTTON_H = 36;
const BUTTON_PAD = 8;

const TOP_LEFT_DEBUG_W = 140;
const TOP_LEFT_DEBUG_H = 44;
// Top-right reserve splits into [speed buttons | resource counters]. Wider than Phase 21 to fit speed buttons on the left.
const RESOURCE_COL_W = 140;
const SPEED_BTN_W = 36;
const SPEED_BTN_H = 22;
const SPEED_BTN_GAP = 4;
const SPEED_BTN_PAD_LEFT = 8;
const SPEED_BTN_PAD_RIGHT = 8;
const SPEED_BTN_AREA_W =
  SPEED_BTN_PAD_LEFT +
  SPEED_FACTORS.length * SPEED_BTN_W +
  (SPEED_FACTORS.length - 1) * SPEED_BTN_GAP +
  SPEED_BTN_PAD_RIGHT;
const TOP_RIGHT_W = SPEED_BTN_AREA_W + RESOURCE_COL_W;
const TOP_RIGHT_H = 70;
const SPEED_BTN_Y = 8;

export function isPointOverHud(
  x: number,
  y: number,
  viewW: number,
  viewH: number,
): boolean {
  // Bottom 5px act as not-over-HUD so south edge-pan still engages despite full-width panel.
  if (y >= viewH - 5) return false;
  if (y >= viewH - PANEL_H && y < viewH && x >= 0 && x < viewW) return true;
  // Reserve the top-right region (resource counters + ATTACK indicator) unconditionally to avoid jitter on mode toggle.
  if (
    x >= viewW - TOP_RIGHT_W &&
    x < viewW &&
    y >= 0 &&
    y < TOP_RIGHT_H
  ) {
    return true;
  }
  return false;
}

export function speedButtonRect(
  factor: SpeedFactor,
  viewW: number,
): Rect | null {
  const idx = SPEED_FACTORS.indexOf(factor);
  if (idx < 0) return null;
  const areaLeft = viewW - TOP_RIGHT_W;
  const x = areaLeft + SPEED_BTN_PAD_LEFT + idx * (SPEED_BTN_W + SPEED_BTN_GAP);
  return { x, y: SPEED_BTN_Y, w: SPEED_BTN_W, h: SPEED_BTN_H };
}

export function findSpeedButtonAt(
  canvasX: number,
  canvasY: number,
  viewW: number,
  _viewH: number,
): SpeedFactor | null {
  for (const factor of SPEED_FACTORS) {
    const r = speedButtonRect(factor, viewW);
    if (!r) continue;
    if (
      canvasX >= r.x &&
      canvasX <= r.x + r.w &&
      canvasY >= r.y &&
      canvasY <= r.y + r.h
    ) {
      return factor;
    }
  }
  return null;
}

export function drawHUD(
  ctx: CanvasRenderingContext2D,
  world: World,
  hud: HUDState,
  viewW: number,
  viewH: number,
  speedFactor: SpeedFactor,
  mouseScreen: { x: number; y: number } | null,
): void {
  // top-left: fps + tick (debug only)
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, TOP_LEFT_DEBUG_W, TOP_LEFT_DEBUG_H);
  ctx.fillStyle = '#e0e0e0';
  ctx.font = '14px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'start';
  ctx.fillText(`fps:  ${hud.fps}`, 10, 8);
  ctx.fillText(`tick: ${hud.tickCount}`, 10, 26);

  // top-right reserve: speed buttons (left) + resource counters + ATTACK indicator (right)
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(viewW - TOP_RIGHT_W, 0, TOP_RIGHT_W, TOP_RIGHT_H);
  drawSpeedButtons(ctx, viewW, speedFactor);
  ctx.font = '14px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'end';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#34c8b0';
  ctx.fillText(`mineral: ${world.resources.player}`, viewW - 10, 8);
  ctx.fillStyle = '#1ad1c2';
  ctx.fillText(`gas:     ${world.gas}`, viewW - 10, 26);
  ctx.textAlign = 'start';

  // bottom panel
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, viewH - PANEL_H, viewW, PANEL_H);

  hud.buttons = computeButtons(ctx, world, viewW, viewH);

  drawSelectionInfo(ctx, world, viewH);
  drawButtons(ctx, hud.buttons);

  // placement hint
  if (world.placement) {
    ctx.font = '14px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'start';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#f0c040';
    ctx.fillText(
      `placing ${world.placement.buildingKind} — left click to confirm, Esc to cancel`,
      TOP_LEFT_DEBUG_W + 10,
      8,
    );
  }

  if (world.attackMode) {
    ctx.font = 'bold 16px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = '#ff5050';
    ctx.textAlign = 'end';
    ctx.textBaseline = 'top';
    ctx.fillText('ATTACK', viewW - 12, 46);
    ctx.textAlign = 'start';
  }

  if (mouseScreen) {
    const hovered = findButtonAt(hud, mouseScreen.x, mouseScreen.y);
    if (hovered) drawTooltip(ctx, hovered);
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

function drawSpeedButtons(
  ctx: CanvasRenderingContext2D,
  viewW: number,
  active: SpeedFactor,
): void {
  ctx.font = '12px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const factor of SPEED_FACTORS) {
    const r = speedButtonRect(factor, viewW);
    if (!r) continue;
    const isActive = factor === active;
    // Match bottom-panel palette: enabled=blue tint = active, disabled-look=gray = inactive (still clickable).
    ctx.fillStyle = isActive ? 'rgba(74,140,255,0.35)' : 'rgba(80,80,80,0.25)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = isActive ? '#4a8cff' : '#555';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    ctx.fillStyle = isActive ? '#ffffff' : '#bbb';
    ctx.fillText(`${factor}x`, r.x + r.w / 2, r.y + r.h / 2);
  }
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}

const BUTTON_LABEL_FONT = '13px ui-monospace, monospace';
const BUTTON_LABEL_PAD = 6;

// Width-aware label: prefer "Name [K]" for the hotkey hint; if it overflows the
// button minus side padding, fall back to bare "Name". Tooltip carries the rest.
function buildButtonLabel(
  ctx: CanvasRenderingContext2D,
  action: UIAction,
): string {
  const name = actionDisplayName(action);
  const hotkey = ACTION_HOTKEYS[actionKey(action)];
  if (!hotkey) return name;
  const withHotkey = `${name} [${hotkey}]`;
  const prevFont = ctx.font;
  ctx.font = BUTTON_LABEL_FONT;
  const usable = BUTTON_W - BUTTON_LABEL_PAD * 2;
  const fits = ctx.measureText(withHotkey).width <= usable;
  ctx.font = prevFont;
  return fits ? withHotkey : name;
}

function computeButtons(
  ctx: CanvasRenderingContext2D,
  world: World,
  _viewW: number,
  viewH: number,
): UIButton[] {
  const ids = [...world.selection];
  if (ids.length === 0) return [];
  // Use first selected entity to drive panel actions
  const e = world.entities.get(ids[0]);
  if (!e || e.team !== 'player') return [];

  const buttons: UIButton[] = [];
  const startX = 240;
  const baseY = viewH - 120 + 10;
  let i = 0;

  const addBtn = (action: UIAction, enabled: boolean) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x = startX + col * (BUTTON_W + BUTTON_PAD);
    const y = baseY + row * (BUTTON_H + BUTTON_PAD);
    buttons.push({
      label: buildButtonLabel(ctx, action),
      action,
      enabled,
      rect: { x, y, w: BUTTON_W, h: BUTTON_H },
    });
    i++;
  };

  if (world.placement) {
    addBtn({ type: 'cancelPlacement' }, true);
    return buttons;
  }

  if (e.kind === 'commandCenter' && !e.underConstruction) {
    const def = UNIT_PRODUCTION.worker!;
    addBtn(
      { type: 'produce', unit: 'worker' },
      world.resources.player >= def.cost,
    );
  }
  if (e.kind === 'barracks' && !e.underConstruction) {
    const marineDef = UNIT_PRODUCTION.marine!;
    addBtn(
      { type: 'produce', unit: 'marine' },
      world.resources.player >= marineDef.cost,
    );
    const medicDef = UNIT_PRODUCTION.medic!;
    const medicGas = medicDef.gasCost ?? 0;
    addBtn(
      { type: 'produce', unit: 'medic' },
      world.resources.player >= medicDef.cost && world.gas >= medicGas,
    );
  }
  if (e.kind === 'factory' && !e.underConstruction) {
    const def = UNIT_PRODUCTION.tank!;
    const gas = def.gasCost ?? 0;
    addBtn(
      { type: 'produce', unit: 'tank' },
      world.resources.player >= def.cost && world.gas >= gas,
    );
    const lightDef = UNIT_PRODUCTION['tank-light']!;
    const lightGas = lightDef.gasCost ?? 0;
    addBtn(
      { type: 'produce', unit: 'tank-light' },
      world.resources.player >= lightDef.cost && world.gas >= lightGas,
    );
  }
  if (e.kind === 'worker') {
    for (const k of [
      'barracks',
      'turret',
      'refinery',
      'factory',
      'supplyDepot',
    ] as BuildingKind[]) {
      const def = BUILDING_DEFS[k];
      const gas = def.gasCost ?? 0;
      addBtn(
        { type: 'beginPlace', building: k },
        world.resources.player >= def.cost && world.gas >= gas,
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
