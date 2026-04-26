import { BUILDING_DEFS, UNIT_PRODUCTION } from '../game/balance';
import type { Camera } from '../game/camera';
import type { SpeedFactor } from '../game/loop';
import type { InspectableLLMPlayer } from '../game/players/types';
import type { World } from '../game/world';
import type { BuildingKind, Entity } from '../types';
import { aiInspectorPanelRect, syncAIInspectorPanel } from './ai-inspector-panel';
import {
  drawEnemySelectOverlay,
  isEnemySelectOverlayActive,
} from './enemy-select-overlay';
import { drawMinimap, isPointInMinimap } from './minimap';
import {
  computeProductionQueuePanel,
  drawProductionQueuePanel,
} from './production-queue-panel';
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
  aiInspectorOpen?: boolean;
  // Phase 42: HUD-side mirror of the runtime enemy AI selector. Set each
  // frame from the loop; ui.ts uses this to highlight the active enemy
  // button + render the "warming…" badge. Defaults reasonable for tests.
  activeEnemyKind?: EnemyKind;
  enemyWarming?: boolean;
  // Modal startup AI-picker. Decoupled from activeEnemyKind so the modal can
  // run a backend-start step before swapping. Set true after a successful pick.
  enemyOverlayDismissed?: boolean;
  // While set, the overlay's POST /api/start-backend is in flight; click loop
  // ignores further button clicks and the overlay shows a "starting" state.
  backendStartingKind?: EnemyKindButton;
  // Last failed start attempt — overlay renders this in red below the buttons.
  // Cleared on next click.
  backendStartError?: string;
  // Phase 53 — map dropdown on the AI-selector modal.
  // mapList: filenames (without .json) from GET /api/maps; empty until fetch
  //   resolves. Default option is rendered separately with the special name '_default_'.
  // selectedMap: '_default_' or a value from mapList; what the loader will fetch.
  mapList?: readonly string[];
  selectedMap?: string;
}

// Sentinel for "use the built-in expansion-front preset". '_default_' is illegal
// per MAP_NAME_RE so it can never collide with a user-saved map name.
export const DEFAULT_MAP_KEY = '_default_';

export const AI_INSPECT_BTN_W = 36;
export const AI_INSPECT_BTN_H = 22;
const AI_INSPECT_BTN_GAP = 8;

// 'none' = no enemy AI active (initial startup state until the user clicks a
// button). It never gets a button — the absence of any highlighted button IS
// the visual signal. Buttons keep the 3-kind order.
export type EnemyKind = 'none' | 'claude' | 'codex' | 'scripted';
export type EnemyKindButton = Exclude<EnemyKind, 'none'>;
export const ENEMY_KIND_BTN_ORDER: readonly EnemyKindButton[] = [
  'claude',
  'codex',
  'scripted',
] as const;
const ENEMY_KIND_LABELS: Record<EnemyKindButton, string> = {
  claude: 'Claude',
  codex: 'Codex',
  scripted: 'Scripted',
};
const ENEMY_KIND_BTN_W = 64;
const ENEMY_KIND_BTN_H = 22;
const ENEMY_KIND_BTN_GAP = 4;
const ENEMY_KIND_BTN_GROUP_GAP = 8;
const ENEMY_KIND_BTN_GROUP_W =
  ENEMY_KIND_BTN_ORDER.length * ENEMY_KIND_BTN_W +
  (ENEMY_KIND_BTN_ORDER.length - 1) * ENEMY_KIND_BTN_GAP;

export function aiInspectButtonRect(viewW: number): Rect {
  // Sits to the LEFT of the entire top-right block (speed + resource + attack)
  // so it never collides with speed buttons regardless of how many factors exist.
  return {
    x: viewW - TOP_RIGHT_W - AI_INSPECT_BTN_GAP - AI_INSPECT_BTN_W,
    y: SPEED_BTN_Y,
    w: AI_INSPECT_BTN_W,
    h: AI_INSPECT_BTN_H,
  };
}

export function isAiInspectButtonAt(
  x: number,
  y: number,
  viewW: number,
): boolean {
  const r = aiInspectButtonRect(viewW);
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

export function enemyKindButtonRect(kind: EnemyKindButton, viewW: number): Rect {
  // Sits LEFT of the AI inspect button, same row. Group reads claude→codex→scripted.
  const idx = ENEMY_KIND_BTN_ORDER.indexOf(kind);
  const inspectBtn = aiInspectButtonRect(viewW);
  const groupRight = inspectBtn.x - ENEMY_KIND_BTN_GROUP_GAP;
  const groupLeft = groupRight - ENEMY_KIND_BTN_GROUP_W;
  const x = groupLeft + idx * (ENEMY_KIND_BTN_W + ENEMY_KIND_BTN_GAP);
  return { x, y: SPEED_BTN_Y, w: ENEMY_KIND_BTN_W, h: ENEMY_KIND_BTN_H };
}

export function findEnemyKindButtonAt(
  x: number,
  y: number,
  viewW: number,
): EnemyKindButton | null {
  for (const kind of ENEMY_KIND_BTN_ORDER) {
    const r = enemyKindButtonRect(kind, viewW);
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return kind;
  }
  return null;
}

function enemyKindGroupRect(viewW: number): Rect {
  const inspectBtn = aiInspectButtonRect(viewW);
  const groupRight = inspectBtn.x - ENEMY_KIND_BTN_GROUP_GAP;
  const groupLeft = groupRight - ENEMY_KIND_BTN_GROUP_W;
  return {
    x: groupLeft,
    y: SPEED_BTN_Y,
    w: ENEMY_KIND_BTN_GROUP_W,
    h: ENEMY_KIND_BTN_H,
  };
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
  // Reserve the AI inspect button (sits to the LEFT of resource counters).
  const btn = aiInspectButtonRect(viewW);
  if (x >= btn.x && x < btn.x + btn.w && y >= btn.y && y < btn.y + btn.h) {
    return true;
  }
  // Reserve the enemy-kind button group (Claude / Codex / Scripted) which sits
  // immediately LEFT of the AI inspect button.
  const grp = enemyKindGroupRect(viewW);
  if (x >= grp.x && x < grp.x + grp.w && y >= grp.y && y < grp.y + grp.h) {
    return true;
  }
  // Reserve the AI inspector HTML overlay region when the panel is open. The
  // DOM element captures its own clicks via pointer-events:auto, but the canvas
  // mouse-move handler still uses isPointOverHud to decide if drag-select /
  // hover-cell logic should fire — without this clause the user sees ghost
  // selection rectangles starting under the panel.
  const insp = aiInspectorPanelRect();
  if (insp && x >= insp.x && x < insp.x + insp.w && y >= insp.y && y < insp.y + insp.h) {
    return true;
  }
  // Reserve the minimap so edge-pan / drag-preview / cursor-hover suppress
  // when the cursor is over it (handler.ts adds the equivalent click-time
  // guard so drag-select doesn't fire from inside the minimap).
  if (isPointInMinimap(x, y, viewW, viewH)) return true;
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
  paused: boolean = false,
  camera: Camera | null = null,
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
  ctx.fillText(`gas:     ${world.gas.player}`, viewW - 10, 26);
  ctx.textAlign = 'start';
  drawEnemyKindButtons(ctx, viewW, hud.activeEnemyKind ?? null, hud.enemyWarming === true);
  drawAiInspectButton(ctx, viewW, hud.aiInspectorOpen === true);

  // bottom panel
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, viewH - PANEL_H, viewW, PANEL_H);

  hud.buttons = computeButtons(ctx, world, viewW, viewH);

  drawSelectionInfo(ctx, world, viewH);
  drawButtons(ctx, hud.buttons);

  const queuePanel = computeProductionQueuePanel(world, viewW, viewH, PANEL_H);
  if (queuePanel) drawProductionQueuePanel(ctx, queuePanel);

  // Inspector lives in the DOM (HTML overlay) rather than canvas — collapsible
  // sections + per-command click colors are unworkable on raw 2D context. Sync
  // every frame: the function is idempotent and content only changes ~once / 5s
  // so the DOM-write churn is negligible.
  const aiHook = hud.aiInspectorOpen
    ? (window as unknown as { __aiInspect?: InspectableLLMPlayer | null }).__aiInspect ?? null
    : null;
  syncAIInspectorPanel(
    hud.aiInspectorOpen === true,
    aiHook
      ? {
          exchanges: aiHook.recentExchanges(),
          decisions: aiHook.recentDecisions(),
          phase: aiHook.lastBuildPhase(),
        }
      : null,
  );

  // Minimap sits above the bottom HUD panel (bottom-right). Skip while the
  // enemy-select modal is up so the dimmed overlay reads cleanly. Gated on
  // camera being supplied — older test paths invoke drawHUD without one.
  if (camera && !isEnemySelectOverlayActive(hud)) {
    drawMinimap(ctx, world, camera);
  }

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

  if (paused) {
    drawPausedIndicator(ctx, viewW);
  }

  if (mouseScreen) {
    const hovered = findButtonAt(hud, mouseScreen.x, mouseScreen.y);
    if (hovered) drawTooltip(ctx, hovered);
  }

  // Modal overlay LAST so it sits above everything (including the AI inspector
  // HTML overlay's z-index for canvas-drawn items). Once user picks an AI and
  // activeEnemyKind flips off 'none', this is a no-op.
  if (isEnemySelectOverlayActive(hud)) {
    drawEnemySelectOverlay(ctx, viewW, viewH, hud);
  }
}

function drawPausedIndicator(ctx: CanvasRenderingContext2D, viewW: number): void {
  const label = 'PAUSED';
  const padX = 14;
  const padY = 6;
  const cx = viewW / 2;
  ctx.font = 'bold 18px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const w = ctx.measureText(label).width + padX * 2;
  const h = 18 + padY * 2;
  const x = cx - w / 2;
  const y = 8;
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#f0c040';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = '#f0c040';
  ctx.fillText(label, cx, y + padY);
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
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
    if (e.kind === 'supplyDepot') {
      const remaining = supplyDepotRemaining(world, e);
      if (remaining !== null) {
        ctx.fillText(`remaining: ${remaining}`, 12, baseY + 72);
      }
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

function drawEnemyKindButtons(
  ctx: CanvasRenderingContext2D,
  viewW: number,
  active: EnemyKind | null,
  warming: boolean,
): void {
  const grp = enemyKindGroupRect(viewW);
  // Backdrop spans the full button band (matches the AI inspect button strip
  // styling) so the buttons read at the top edge instead of floating.
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(grp.x - 4, 0, grp.w + 8, TOP_RIGHT_H);
  ctx.font = 'bold 11px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // 'none' = nothing selected: render all three even more dimly so the user
  // can tell the difference between "you picked X, others are off" and "you
  // haven't picked anyone yet". Same geometry, lower opacity fill + faded text.
  const noneActive = active === 'none' || active === null;
  for (const kind of ENEMY_KIND_BTN_ORDER) {
    const r = enemyKindButtonRect(kind, viewW);
    const isActive = kind === active;
    if (isActive) {
      // Yellow highlight = active.
      ctx.fillStyle = 'rgba(240,192,64,0.35)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = '#f0c040';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      ctx.fillStyle = '#ffffff';
    } else if (noneActive) {
      // Off / dim — no kind picked yet. Lower opacity than the regular
      // "another kind is active" gray so the user reads it as inert.
      ctx.fillStyle = 'rgba(60,60,60,0.18)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = '#3a3a3a';
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      ctx.fillStyle = '#888';
    } else {
      // Some other kind is active — standard inactive gray.
      ctx.fillStyle = 'rgba(80,80,80,0.25)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      ctx.fillStyle = '#bbb';
    }
    ctx.fillText(ENEMY_KIND_LABELS[kind], r.x + r.w / 2, r.y + r.h / 2);
  }
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
  if (warming) {
    // "warming…" badge sits directly under the active button band; only LLM
    // players ever set this so we don't need to gate per-kind.
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#f0c040';
    ctx.fillText('warming…', grp.x + grp.w / 2, grp.y + grp.h + 4);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }
}

function drawAiInspectButton(
  ctx: CanvasRenderingContext2D,
  viewW: number,
  open: boolean,
): void {
  const r = aiInspectButtonRect(viewW);
  // Same dark backdrop the speed/resource block uses so the button reads at the
  // top of the canvas instead of floating over world art.
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(r.x - 4, 0, r.w + 8, TOP_RIGHT_H);
  ctx.fillStyle = open ? 'rgba(124,240,124,0.30)' : 'rgba(255,255,255,0.10)';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = open ? '#7cf07c' : 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  ctx.font = 'bold 11px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = open ? '#7cf07c' : '#e0e0e0';
  ctx.fillText('AI', r.x + r.w / 2, r.y + r.h / 2);
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
  // CommandCenter renders as "CC" on the button — "Command Center" overruns the
  // 92px button width even before the hotkey hint. Tooltip header stays full.
  const name =
    action.type === 'beginPlace' && action.building === 'commandCenter'
      ? 'CC'
      : actionDisplayName(action);
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
      world.resources.player >= medicDef.cost && world.gas.player >= medicGas,
    );
  }
  if (e.kind === 'factory' && !e.underConstruction) {
    const def = UNIT_PRODUCTION.tank!;
    const gas = def.gasCost ?? 0;
    addBtn(
      { type: 'produce', unit: 'tank' },
      world.resources.player >= def.cost && world.gas.player >= gas,
    );
    const lightDef = UNIT_PRODUCTION['tank-light']!;
    const lightGas = lightDef.gasCost ?? 0;
    addBtn(
      { type: 'produce', unit: 'tank-light' },
      world.resources.player >= lightDef.cost && world.gas.player >= lightGas,
    );
  }
  if (e.kind === 'worker') {
    // commandCenter included for expansion (Phase 51-A): same beginPlace pathway,
    // 15×15 footprint handled by canPlace via def.w/h. Label shortens to "CC" so
    // it fits the 92px button width.
    for (const k of [
      'barracks',
      'turret',
      'refinery',
      'factory',
      'supplyDepot',
      'commandCenter',
    ] as BuildingKind[]) {
      const def = BUILDING_DEFS[k];
      const gas = def.gasCost ?? 0;
      addBtn(
        { type: 'beginPlace', building: k },
        world.resources.player >= def.cost && world.gas.player >= gas,
      );
    }
  }
  return buttons;
}

/**
 * Returns the underlying mineralNode's `remaining` ore for a supplyDepot, or
 * null when the depot has no link or the node is gone. Pure helper so the panel
 * "remaining: N" line is unit-testable without a Canvas context.
 */
export function supplyDepotRemaining(world: World, depot: Entity): number | null {
  if (depot.kind !== 'supplyDepot') return null;
  if (depot.mineralNodeId === null || depot.mineralNodeId === undefined) {
    return null;
  }
  const node = world.entities.get(depot.mineralNodeId);
  if (!node) return null;
  return node.remaining ?? 0;
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
