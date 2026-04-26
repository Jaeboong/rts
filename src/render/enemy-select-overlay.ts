// Modal overlay shown at game start when no enemy AI is selected.
// Forces an explicit choice before play; click dispatches __swapEnemy.

import type { EnemyKindButton, HUDState, Rect } from './ui';

const PANEL_W = 520;
const PANEL_H = 340;
const TITLE_FONT = 'bold 22px ui-monospace, monospace';
const SUBTITLE_FONT = '13px ui-monospace, monospace';
const BTN_FONT = 'bold 18px ui-monospace, monospace';
const DESC_FONT = '11px ui-monospace, monospace';

const BTN_W = 440;
const BTN_H = 56;
const BTN_GAP = 12;
const BTN_FIRST_Y_OFFSET = 96;

const KIND_BTN_ORDER: readonly EnemyKindButton[] = ['claude', 'codex', 'scripted'];
const KIND_LABEL: Record<EnemyKindButton, string> = {
  claude: 'Claude',
  codex: 'Codex',
  scripted: 'Scripted AI',
};
const KIND_DESC: Record<EnemyKindButton, string> = {
  claude: 'Anthropic Sonnet 4.6 — careful, deliberative',
  codex: 'OpenAI GPT-5.5 — fast, action-first',
  scripted: 'Deterministic, offline — no LLM',
};
// Per Phase 45 spec: claude=orange, codex=black, scripted=gray.
const KIND_COLOR: Record<EnemyKindButton, string> = {
  claude: '#ff8800',
  codex: '#1a1a1a',
  scripted: '#6a7280',
};

export function isEnemySelectOverlayActive(hud: HUDState | undefined): boolean {
  // Active until handler.ts flips enemyOverlayDismissed on first button click.
  // Independent of activeEnemyKind so a default kind (e.g. codex) warms in
  // background while the modal still forces an explicit user pick.
  return hud?.enemyOverlayDismissed !== true;
}

function panelRect(viewW: number, viewH: number): Rect {
  return {
    x: Math.floor((viewW - PANEL_W) / 2),
    y: Math.floor((viewH - PANEL_H) / 2),
    w: PANEL_W,
    h: PANEL_H,
  };
}

function buttonRect(
  kind: EnemyKindButton,
  viewW: number,
  viewH: number,
): Rect {
  const panel = panelRect(viewW, viewH);
  const idx = KIND_BTN_ORDER.indexOf(kind);
  const x = panel.x + Math.floor((PANEL_W - BTN_W) / 2);
  const y = panel.y + BTN_FIRST_Y_OFFSET + idx * (BTN_H + BTN_GAP);
  return { x, y, w: BTN_W, h: BTN_H };
}

export function findEnemySelectOverlayKindAt(
  x: number,
  y: number,
  viewW: number,
  viewH: number,
): EnemyKindButton | null {
  for (const kind of KIND_BTN_ORDER) {
    const r = buttonRect(kind, viewW, viewH);
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return kind;
  }
  return null;
}

export function drawEnemySelectOverlay(
  ctx: CanvasRenderingContext2D,
  viewW: number,
  viewH: number,
  hud: HUDState | undefined,
): void {
  // Dim backdrop blocks the world visually so the choice feels modal.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(0, 0, viewW, viewH);

  const panel = panelRect(viewW, viewH);
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
  ctx.strokeStyle = '#f0c040';
  ctx.lineWidth = 2;
  ctx.strokeRect(panel.x + 0.5, panel.y + 0.5, panel.w - 1, panel.h - 1);

  ctx.font = TITLE_FONT;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('Select Enemy AI', panel.x + panel.w / 2, panel.y + 20);

  ctx.font = SUBTITLE_FONT;
  ctx.fillStyle = '#aaaaaa';
  ctx.fillText(
    'Click to start. You can swap mid-game from the top-right buttons.',
    panel.x + panel.w / 2,
    panel.y + 52,
  );

  const startingKind = hud?.backendStartingKind;
  for (const kind of KIND_BTN_ORDER) {
    const r = buttonRect(kind, viewW, viewH);
    const isStarting = startingKind === kind;
    const dim = startingKind !== undefined && !isStarting;
    ctx.globalAlpha = dim ? 0.4 : 1;
    ctx.fillStyle = KIND_COLOR[kind];
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = isStarting ? '#f0c040' : '#ffffff';
    ctx.lineWidth = isStarting ? 2.5 : 1.5;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);

    ctx.font = BTN_FONT;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const label = isStarting ? `${KIND_LABEL[kind]}  (starting…)` : KIND_LABEL[kind];
    ctx.fillText(label, r.x + 16, r.y + 20);

    ctx.font = DESC_FONT;
    ctx.fillStyle = '#dddddd';
    ctx.fillText(KIND_DESC[kind], r.x + 16, r.y + 40);
  }
  ctx.globalAlpha = 1;

  const statusY = panel.y + panel.h - 40;
  if (startingKind !== undefined) {
    ctx.font = DESC_FONT;
    ctx.fillStyle = '#f0c040';
    ctx.textAlign = 'center';
    ctx.fillText(
      `Starting ${KIND_LABEL[startingKind]} backend… cold start can take 60–90s.`,
      panel.x + panel.w / 2,
      statusY,
    );
  } else if (hud?.backendStartError) {
    ctx.font = DESC_FONT;
    ctx.fillStyle = '#ff6060';
    ctx.textAlign = 'center';
    // Backend error messages can be long (full ps1 stdout) — truncate to fit.
    const trimmed =
      hud.backendStartError.length > 80
        ? hud.backendStartError.slice(0, 77) + '…'
        : hud.backendStartError;
    ctx.fillText(`Failed: ${trimmed}`, panel.x + panel.w / 2, statusY);
  }

  // Reset alignment so subsequent renders aren't affected.
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}
