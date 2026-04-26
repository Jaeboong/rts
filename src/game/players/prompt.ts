import type { BuildOrderPhase } from './build-order-tracker';
import { formatBuildOrderPhase } from './build-order-tracker';
import type { DecisionRecord } from './decision-history';
import { formatDecisionHistory } from './decision-history';
import type { StateSummary } from './state-summary';
import { formatStateSummary } from './state-summary';
import type { GameView, ViewEntity } from './types';

// Downsampled minimap dimensions. Real grid is GRID_W×GRID_H (Phase 46: 256×256
// = ~65k chars per request) which is far too large for an LLM scan. 32 cols ×
// 16 rows keeps the prompt cheap while preserving rough spatial relations.
// Tweak here if the user wants higher fidelity.
const MINIMAP_COLS = 32;
const MINIMAP_ROWS = 16;

const RESOURCE_KINDS: ReadonlySet<string> = new Set(['mineralNode', 'gasGeyser']);

/**
 * Optional contextual annotations that NanoclawPlayer assembles outside of the
 * raw GameView — synthesized state summary, current build-order phase, and
 * recent decision history. The bare buildPrompt(view) call (no ctx) skips
 * these prepended sections.
 */
export interface PromptContext {
  readonly summary?: StateSummary;
  readonly phase?: BuildOrderPhase;
  readonly decisions?: readonly DecisionRecord[];
  /** Free-form bullet notes appended after the decision history. */
  readonly notes?: readonly string[];
  /**
   * One-line summary of combat events since the last LLM call (Phase 41).
   * Pre-formatted by EventTracker — prompt.ts stays dumb on contents.
   */
  readonly recentEventsBrief?: string;
  /**
   * Multi-line death-by-death detail. Emitted at most every 30s by EventTracker;
   * undefined on intervening calls.
   */
  readonly recentEventsDetailed?: string;
  /**
   * Phase 44 — per-rally postmortem warnings (rally-tracker output). Each
   * string is one bleeding rally; rendered before the brief/detailed events
   * sections so the LLM sees "this specific rally is killing your units"
   * before reading the unattributed kill-feed below.
   */
  readonly rallyWarnings?: readonly string[];
}

/**
 * Pure deterministic projection of a GameView into the prompt text format
 * documented in AI_INFRASTRUCTURE.md §4-4. Same input always produces identical
 * output; that property is what makes prompt.test.ts trustworthy as a snapshot
 * and what lets the user diff prompts across game ticks.
 *
 * When `ctx` is supplied, additional sections (Synthesized State / Current
 * Build Phase / Your last N decisions / Notes) are prepended BEFORE the raw
 * Tick/Map/units block. Without ctx, output matches the pre-context format.
 */
export function buildPrompt(view: GameView, ctx?: PromptContext): string {
  const lines: string[] = [];

  if (ctx) {
    appendContextSections(lines, ctx);
  }

  lines.push(`Tick: ${view.tick}`);
  lines.push(`Minerals: ${view.resources.minerals}`);
  lines.push(`Gas: ${view.resources.gas}`);
  lines.push(`Map: ${view.mapInfo.w}x${view.mapInfo.h} cells (cellPx=${view.mapInfo.cellPx})`);
  lines.push('');

  lines.push(`My units (${view.myEntities.length}):`);
  for (const e of sortById(view.myEntities)) {
    lines.push(`- ${formatEntity(e, view.mapInfo.cellPx)}`);
  }
  lines.push('');

  lines.push(`Enemy units (${view.visibleEnemies.length}):`);
  for (const e of sortById(view.visibleEnemies)) {
    lines.push(`- ${formatEntity(e, view.mapInfo.cellPx)}`);
  }
  lines.push('');

  lines.push(`Resources (${view.visibleResources.length}):`);
  for (const e of sortById(view.visibleResources)) {
    lines.push(`- ${formatEntity(e, view.mapInfo.cellPx)}`);
  }
  lines.push('');

  lines.push(`Minimap ${MINIMAP_COLS}x${MINIMAP_ROWS} (M=mine, E=enemy, R=resource, .=empty):`);
  for (const row of renderMinimap(view)) lines.push(row);

  return lines.join('\n');
}

function appendContextSections(lines: string[], ctx: PromptContext): void {
  // Rally postmortem leads so the model sees "this rally is killing your units"
  // BEFORE the unattributed events below — closes the gap where the LLM saw
  // deaths but never connected them to its earlier setRally decision.
  if (ctx.rallyWarnings && ctx.rallyWarnings.length > 0) {
    lines.push('### Rally Postmortem (last 60s)');
    for (const w of ctx.rallyWarnings) lines.push(w);
    lines.push('');
  }
  // Recent-events sections follow so the LLM sees fresh combat feedback before
  // the static summary — keeps reactive decisions (defend/retreat) from being
  // buried beneath economy bookkeeping.
  if (ctx.recentEventsBrief) {
    lines.push('### Recent Events (last ~5s)');
    lines.push(ctx.recentEventsBrief);
    lines.push('');
  }
  if (ctx.recentEventsDetailed) {
    lines.push('### Detailed Combat Report (last 30s)');
    lines.push(ctx.recentEventsDetailed);
    lines.push('');
  }
  if (ctx.summary) {
    lines.push('--- Synthesized State ---');
    lines.push(formatStateSummary(ctx.summary));
    lines.push('');
  }
  if (ctx.phase) {
    lines.push('--- Current Build Phase ---');
    lines.push(formatBuildOrderPhase(ctx.phase));
    lines.push('');
  }
  if (ctx.decisions && ctx.decisions.length > 0) {
    lines.push(`--- Your last ${ctx.decisions.length} decisions ---`);
    lines.push(formatDecisionHistory(ctx.decisions));
    lines.push('');
  }
  if (ctx.notes && ctx.notes.length > 0) {
    lines.push('--- Notes ---');
    for (const n of ctx.notes) lines.push(`- ${n}`);
    lines.push('');
  }
}

function sortById(entities: readonly ViewEntity[]): ViewEntity[] {
  return [...entities].sort((a, b) => a.id - b.id);
}

function formatEntity(e: ViewEntity, cellPx: number): string {
  const cellX = e.cellX ?? Math.floor(e.pos.x / cellPx);
  const cellY = e.cellY ?? Math.floor(e.pos.y / cellPx);
  const flags: string[] = [];
  if (e.underConstruction) flags.push('underConstruction');
  // Worker actively constructing — LLM must skip these in move/gather/attack
  // (command-applier hard-rejects to prevent abandoned builds). See nanoclaw
  // CLAUDE.md §11 "자주 하는 실수".
  if (e.kind === 'worker' && e.commandType === 'build') flags.push('building');
  const flagStr = flags.length > 0 ? ` [${flags.join(',')}]` : '';
  return `id=${e.id} ${e.kind} at (${cellX},${cellY}) hp=${e.hp}/${e.maxHp}${flagStr}`;
}

function renderMinimap(view: GameView): string[] {
  const cols = MINIMAP_COLS;
  const rows = MINIMAP_ROWS;
  const cellPx = view.mapInfo.cellPx;
  const mapW = view.mapInfo.w;
  const mapH = view.mapInfo.h;
  const grid: string[][] = [];
  for (let r = 0; r < rows; r++) {
    grid.push(new Array<string>(cols).fill('.'));
  }
  // Priority when two entity classes occupy the same downsampled cell:
  // enemy > my > resource. Enemies are most actionable for an attacker AI.
  const place = (e: ViewEntity, ch: string, priority: number): void => {
    const cellX = e.cellX ?? Math.floor(e.pos.x / cellPx);
    const cellY = e.cellY ?? Math.floor(e.pos.y / cellPx);
    if (cellX < 0 || cellY < 0 || cellX >= mapW || cellY >= mapH) return;
    const col = Math.min(cols - 1, Math.floor((cellX * cols) / mapW));
    const row = Math.min(rows - 1, Math.floor((cellY * rows) / mapH));
    const existing = grid[row][col];
    const existingPriority = priorityOf(existing);
    if (priority >= existingPriority) grid[row][col] = ch;
  };
  for (const e of sortById(view.visibleResources)) {
    if (RESOURCE_KINDS.has(e.kind)) place(e, 'R', 1);
  }
  for (const e of sortById(view.myEntities)) place(e, 'M', 2);
  for (const e of sortById(view.visibleEnemies)) place(e, 'E', 3);
  return grid.map((row) => row.join(''));
}

function priorityOf(ch: string): number {
  switch (ch) {
    case 'E':
      return 3;
    case 'M':
      return 2;
    case 'R':
      return 1;
    default:
      return 0;
  }
}
