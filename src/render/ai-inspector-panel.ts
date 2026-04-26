import type { World } from '../game/world';
import type { BuildOrderPhase } from '../game/players/build-order-tracker';
import type { DecisionRecord } from '../game/players/decision-history';
import type { LLMExchange } from '../game/players/types';
import type { EntityId } from '../types';

import {
  formatLatency,
  formatRecentEvents,
  padTypeColumn,
  parseDisplayCommands,
  type CommandColor,
  type DisplayCommand,
  type KindResolver,
  type ParseDisplayResult,
} from './ai-inspector-format';

export interface AIInspectorContext {
  readonly exchanges: readonly LLMExchange[];
  readonly decisions?: readonly DecisionRecord[];
  readonly phase?: BuildOrderPhase | null;
}

const PANEL_ID = 'ai-inspector-panel';
const PANEL_W = 540;
const PANEL_BOTTOM_OFFSET = 12;
const PANEL_RIGHT_OFFSET = 12;

const CMD_COLORS: Record<CommandColor, string> = {
  create: '#7cf07c',
  move: '#5cd2ff',
  attack: '#ff8a4c',
  idle: '#888',
  unknown: '#c97070',
};

// Module-scoped because the panel DOM is also module-scoped (lazy singleton).
// Toggling the PROMPT section persists across renders without churning state
// onto the world or the player.
let promptExpanded = false;

interface PanelDom {
  readonly root: HTMLDivElement;
  readonly header: HTMLDivElement;
  readonly phaseLine: HTMLDivElement;
  readonly decisionsLine: HTMLDivElement;
  readonly eventsLine: HTMLDivElement;
  readonly promptToggle: HTMLButtonElement;
  readonly promptBody: HTMLPreElement;
  readonly responseHeader: HTMLDivElement;
  readonly responseList: HTMLDivElement;
  readonly footnote: HTMLDivElement;
}

let dom: PanelDom | null = null;

/**
 * Idempotent: ensures the inspector DOM exists, mounts it under #app on the
 * first call, then refreshes its contents from `inspectorCtx`. Toggles
 * visibility based on `open`. Safe to call every frame from the render loop.
 *
 * Intentionally accepts `null` for inspectorCtx + `open=false` — the bootstrap
 * path may run before any LLM player is wired up; we still want to make sure
 * any orphan element from a hot-reload is hidden.
 */
export function syncAIInspectorPanel(
  open: boolean,
  inspectorCtx: AIInspectorContext | null,
): void {
  if (typeof document === 'undefined') return;
  const node = ensureDom();
  if (!open || inspectorCtx === null) {
    node.root.style.display = 'none';
    return;
  }
  node.root.style.display = 'flex';
  render(node, inspectorCtx);
}

/**
 * Returns the on-screen rect of the inspector panel when visible — `null`
 * otherwise. Used by `isPointOverHud` so canvas-side mouse handlers don't
 * eat clicks that landed on the HTML overlay (e.g. the PROMPT toggle button).
 *
 * Coords are viewport-relative (getBoundingClientRect). Today the canvas fills
 * #app starting at viewport (0,0) so they double as canvas-relative — if the
 * page ever grows a header/sidebar above #app, this helper needs to subtract
 * the canvas's own viewport offset before returning.
 */
export function aiInspectorPanelRect(): { x: number; y: number; w: number; h: number } | null {
  if (dom === null) return null;
  if (dom.root.style.display === 'none') return null;
  const r = dom.root.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

function ensureDom(): PanelDom {
  if (dom !== null) return dom;
  const host = document.getElementById('app') ?? document.body;
  const root = document.createElement('div');
  root.id = PANEL_ID;
  Object.assign(root.style, {
    position: 'absolute',
    right: `${PANEL_RIGHT_OFFSET}px`,
    bottom: `${PANEL_BOTTOM_OFFSET + 130}px`,
    width: `${PANEL_W}px`,
    maxHeight: '60vh',
    overflowY: 'auto',
    padding: '10px 12px',
    background: 'rgba(0,0,0,0.86)',
    border: '1px solid rgba(124,240,124,0.55)',
    borderRadius: '4px',
    color: '#e0e0e0',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '12px',
    lineHeight: '1.5',
    display: 'none',
    flexDirection: 'column',
    gap: '4px',
    pointerEvents: 'auto',
    zIndex: '50',
  });

  const header = document.createElement('div');
  Object.assign(header.style, {
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#7cf07c',
    marginBottom: '2px',
  });

  const phaseLine = document.createElement('div');
  Object.assign(phaseLine.style, { color: '#9ad', fontSize: '11px' });

  const decisionsLine = document.createElement('div');
  Object.assign(decisionsLine.style, { color: '#bbb', fontSize: '11px' });

  const eventsLine = document.createElement('div');
  Object.assign(eventsLine.style, {
    color: '#ddd',
    fontSize: '11px',
    marginTop: '2px',
  });

  const promptToggle = document.createElement('button');
  Object.assign(promptToggle.style, {
    background: 'transparent',
    color: '#34c8b0',
    border: 'none',
    padding: '4px 0',
    margin: '4px 0 0 0',
    font: 'inherit',
    fontWeight: 'bold',
    cursor: 'pointer',
    textAlign: 'left',
  });
  promptToggle.addEventListener('click', () => {
    promptExpanded = !promptExpanded;
    if (dom !== null) applyPromptToggle(dom);
  });
  promptToggle.addEventListener('mousedown', (e) => e.stopPropagation());

  const promptBody = document.createElement('pre');
  Object.assign(promptBody.style, {
    margin: '0',
    padding: '6px 8px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(124,240,124,0.18)',
    borderRadius: '3px',
    color: '#cfd0d0',
    fontFamily: 'inherit',
    fontSize: '11px',
    lineHeight: '1.4',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    maxHeight: '40vh',
    overflowY: 'auto',
    display: 'none',
  });

  const responseHeader = document.createElement('div');
  Object.assign(responseHeader.style, {
    color: '#34c8b0',
    fontWeight: 'bold',
    marginTop: '6px',
  });
  responseHeader.textContent = 'RESPONSE';

  const responseList = document.createElement('div');
  Object.assign(responseList.style, {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  });

  const footnote = document.createElement('div');
  Object.assign(footnote.style, {
    color: '#777',
    fontSize: '10px',
    marginTop: '6px',
  });

  root.appendChild(header);
  root.appendChild(phaseLine);
  root.appendChild(decisionsLine);
  root.appendChild(eventsLine);
  root.appendChild(promptToggle);
  root.appendChild(promptBody);
  root.appendChild(responseHeader);
  root.appendChild(responseList);
  root.appendChild(footnote);
  host.appendChild(root);

  dom = {
    root,
    header,
    phaseLine,
    decisionsLine,
    eventsLine,
    promptToggle,
    promptBody,
    responseHeader,
    responseList,
    footnote,
  };
  applyPromptToggle(dom);
  return dom;
}

function applyPromptToggle(node: PanelDom): void {
  const arrow = promptExpanded ? '▼' : '▶';
  node.promptToggle.textContent = `${arrow} PROMPT (click to ${promptExpanded ? 'collapse' : 'expand'})`;
  node.promptBody.style.display = promptExpanded ? 'block' : 'none';
}

function render(node: PanelDom, inspectorCtx: AIInspectorContext): void {
  const exchanges = inspectorCtx.exchanges;
  const newest = exchanges[0];
  // Prefer the latest exchange that already has a response so a slow in-flight
  // request doesn't blank the panel mid-stream.
  const lastWithResponse = exchanges.find((e) => e.respondedAtMs !== null);
  const last = lastWithResponse ?? newest;

  if (!last) {
    node.header.textContent = 'AI inspector — waiting for first request';
    node.phaseLine.textContent = '';
    node.decisionsLine.textContent = '';
    node.eventsLine.textContent = '';
    node.promptBody.textContent = '';
    node.responseList.replaceChildren();
    node.footnote.textContent = `total exchanges: 0`;
    return;
  }

  const cmdCount = last.parsedCount;
  const latency = formatLatency(last.requestedAtMs, last.respondedAtMs);
  const pendingMarker = newest && newest !== last ? ' (newer req in flight)' : '';
  node.header.textContent = `tick ${last.tickAtRequest} | ${cmdCount} cmd${cmdCount === 1 ? '' : 's'} | ${latency}${pendingMarker}`;

  const phase = inspectorCtx.phase;
  node.phaseLine.textContent = phase
    ? `phase: ${phase.currentStep} -> ${phase.nextGoal}`
    : 'phase: (not yet inferred)';

  const decisions = inspectorCtx.decisions ?? [];
  if (decisions.length > 0) {
    const lastD = decisions[0];
    const okN = lastD.results.filter((r) => r.ok).length;
    const failN = lastD.results.length - okN;
    node.decisionsLine.textContent = `${okN} ok / ${failN} rejected (last ${decisions.length} call${decisions.length === 1 ? '' : 's'})`;
  } else {
    node.decisionsLine.textContent = 'decisions: (none yet)';
  }

  const eventLines = formatRecentEvents(extractRecentEventsBrief(last.prompt));
  node.eventsLine.textContent = eventLines.join('   ');
  node.eventsLine.style.display = eventLines.length === 0 ? 'none' : 'block';

  node.promptBody.textContent = last.prompt;
  applyPromptToggle(node);

  renderResponse(node.responseList, last);

  node.footnote.textContent = `total exchanges: ${exchanges.length}    | toggle with the AI button`;
}

function renderResponse(list: HTMLDivElement, exchange: LLMExchange): void {
  list.replaceChildren();
  if (exchange.status === 'error') {
    const row = document.createElement('div');
    row.textContent = `[error] ${exchange.error ?? 'unknown'}`;
    row.style.color = '#ff8080';
    list.appendChild(row);
    return;
  }
  const raw = exchange.rawResponse;
  if (raw === null) {
    const row = document.createElement('div');
    row.textContent = '(pending…)';
    row.style.color = '#888';
    list.appendChild(row);
    return;
  }

  const result = parseDisplayCommands(raw, resolveKindFromWindowWorld);
  appendResponseRows(list, result);
}

function appendResponseRows(list: HTMLDivElement, result: ParseDisplayResult): void {
  if (result.kind === 'empty') {
    const row = document.createElement('div');
    row.textContent = '(no commands this tick)';
    row.style.color = '#888';
    list.appendChild(row);
    return;
  }
  if (result.kind === 'unparseable') {
    const head = document.createElement('div');
    head.textContent = '⚠️ unparseable';
    head.style.color = '#ff8080';
    head.style.fontWeight = 'bold';
    list.appendChild(head);
    const body = document.createElement('div');
    body.textContent = result.raw;
    Object.assign(body.style, {
      color: '#cfd0d0',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      fontSize: '11px',
      maxHeight: '200px',
      overflowY: 'auto',
    });
    list.appendChild(body);
    return;
  }
  const padded = padTypeColumn(result.commands);
  for (let i = 0; i < result.commands.length; i++) {
    list.appendChild(buildCommandRow(result.commands[i], padded[i]));
  }
}

function buildCommandRow(cmd: DisplayCommand, paddedType: string): HTMLDivElement {
  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex',
    gap: '6px',
    alignItems: 'baseline',
  });
  const marker = document.createElement('span');
  marker.textContent = '▶';
  marker.style.color = CMD_COLORS[cmd.color];
  marker.style.flex = '0 0 auto';

  const typeSpan = document.createElement('span');
  typeSpan.textContent = paddedType;
  typeSpan.style.color = CMD_COLORS[cmd.color];
  typeSpan.style.fontWeight = 'bold';
  typeSpan.style.whiteSpace = 'pre';
  typeSpan.style.flex = '0 0 auto';

  const bodySpan = document.createElement('span');
  bodySpan.textContent = cmd.body;
  bodySpan.style.color = '#e0e0e0';
  bodySpan.style.whiteSpace = 'pre';
  bodySpan.style.overflow = 'hidden';
  bodySpan.style.textOverflow = 'ellipsis';

  row.appendChild(marker);
  row.appendChild(typeSpan);
  row.appendChild(bodySpan);
  return row;
}

/**
 * Pull the "### Recent Events" block out of the prompt so the inspector can
 * surface it on the always-visible header strip without re-running the
 * EventTracker (it's stateful and can't be re-derived from the prompt alone).
 * Returns the brief line — falls back to null when the section is absent or
 * the prompt format changed.
 */
function extractRecentEventsBrief(prompt: string): string | null {
  const marker = '### Recent Events';
  const idx = prompt.indexOf(marker);
  if (idx < 0) return null;
  const tail = prompt.slice(idx);
  const lines = tail.split('\n');
  // Skip the heading line; the next non-empty line is the brief.
  for (let i = 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith('###') || trimmed.startsWith('---')) return null;
    return trimmed;
  }
  return null;
}

const resolveKindFromWindowWorld: KindResolver = (id: EntityId): string | null => {
  if (typeof window === 'undefined') return null;
  const w = (window as unknown as { __world?: World }).__world;
  if (!w) return null;
  const e = w.entities.get(id);
  if (!e) return null;
  return e.kind;
};
