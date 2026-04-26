import { BUILDING_DEFS, UNIT_PRODUCTION } from '../game/balance';
import type { BuildingKind, UnitKind } from '../types';
import type { UIAction, UIButton } from './ui';

export const TOOLTIP_PADDING = 7;
export const TOOLTIP_LINE_H = 15;
export const TOOLTIP_GAP_FROM_BUTTON = 6;
export const TOOLTIP_FONT = '12px ui-monospace, monospace';
export const TOOLTIP_BG = 'rgba(20,20,20,0.92)';
export const TOOLTIP_BORDER = '#555';
export const TOOLTIP_TEXT = '#e8e8e8';

const UNIT_DISPLAY_NAME: Record<UnitKind, string> = {
  worker: 'Worker',
  marine: 'Marine',
  tank: 'Tank',
  'tank-light': 'Light Tank',
  medic: 'Medic',
  enemyDummy: 'Enemy',
};

const BUILDING_DISPLAY_NAME: Record<BuildingKind, string> = {
  commandCenter: 'Command Center',
  barracks: 'Barracks',
  turret: 'Turret',
  refinery: 'Refinery',
  factory: 'Factory',
  supplyDepot: 'Supply Depot',
};

// Source of truth for "which letter triggers which action" — for tooltip display only.
// Routing remains in handler.ts; this lookup intentionally mirrors that mapping.
export const ACTION_HOTKEYS: Readonly<Record<string, string>> = {
  'produce-worker': 'S',
  'produce-marine': 'M',
  'produce-medic': 'C',
  'produce-tank': 'T',
  'produce-tank-light': 'L',
  'build-barracks': 'B',
  'build-turret': 'T',
  'build-refinery': 'R',
  'build-factory': 'F',
  'build-supplyDepot': 'D',
  'build-commandCenter': 'V',
  cancelPlacement: 'Esc',
};

export function actionKey(action: UIAction): string {
  switch (action.type) {
    case 'produce':
      return `produce-${action.unit}`;
    case 'beginPlace':
      return `build-${action.building}`;
    case 'cancelPlacement':
      return 'cancelPlacement';
  }
}

export function actionDisplayName(action: UIAction): string {
  switch (action.type) {
    case 'produce':
      return UNIT_DISPLAY_NAME[action.unit];
    case 'beginPlace':
      return BUILDING_DISPLAY_NAME[action.building];
    case 'cancelPlacement':
      return 'Cancel';
  }
}

export interface TooltipData {
  lines: readonly string[];
}

export function getButtonTooltip(button: UIButton): TooltipData {
  const lines: string[] = [actionDisplayName(button.action)];
  const cost = costLine(button.action);
  if (cost) lines.push(cost);
  const hotkey = ACTION_HOTKEYS[actionKey(button.action)];
  if (hotkey) lines.push(`Hotkey: ${hotkey}`);
  return { lines };
}

function costLine(action: UIAction): string | null {
  if (action.type === 'produce') {
    const def = UNIT_PRODUCTION[action.unit];
    if (!def || def.cost <= 0) return null;
    const gas = def.gasCost ?? 0;
    return gas > 0
      ? `Cost: ${def.cost}M / ${gas}G`
      : `Cost: ${def.cost} minerals`;
  }
  if (action.type === 'beginPlace') {
    const def = BUILDING_DEFS[action.building];
    if (def.cost <= 0) return null;
    const gas = def.gasCost ?? 0;
    return gas > 0
      ? `Cost: ${def.cost}M / ${gas}G`
      : `Cost: ${def.cost} minerals`;
  }
  return null;
}

export function drawTooltip(
  ctx: CanvasRenderingContext2D,
  button: UIButton,
): void {
  const data = getButtonTooltip(button);
  if (data.lines.length === 0) return;

  ctx.font = TOOLTIP_FONT;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'start';

  let maxLineW = 0;
  for (const line of data.lines) {
    const w = ctx.measureText(line).width;
    if (w > maxLineW) maxLineW = w;
  }
  const boxW = Math.ceil(maxLineW) + TOOLTIP_PADDING * 2;
  const boxH = data.lines.length * TOOLTIP_LINE_H + TOOLTIP_PADDING * 2;

  // Center horizontally on the button; place above unless that clips the top.
  const x = button.rect.x + button.rect.w / 2 - boxW / 2;
  let y = button.rect.y - TOOLTIP_GAP_FROM_BUTTON - boxH;
  if (y < 0) {
    y = button.rect.y + button.rect.h + TOOLTIP_GAP_FROM_BUTTON;
  }

  ctx.fillStyle = TOOLTIP_BG;
  ctx.fillRect(x, y, boxW, boxH);
  ctx.strokeStyle = TOOLTIP_BORDER;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, boxW - 1, boxH - 1);

  ctx.fillStyle = TOOLTIP_TEXT;
  for (let i = 0; i < data.lines.length; i++) {
    ctx.fillText(
      data.lines[i],
      x + TOOLTIP_PADDING,
      y + TOOLTIP_PADDING + i * TOOLTIP_LINE_H,
    );
  }
}
