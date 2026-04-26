import type { EntityId } from '../types';

/**
 * Display-only projection of a single LLM-emitted command. Re-parsed straight
 * from the raw response string — does NOT pass through `parseCommands` because
 * by render time the live GameView may have changed (entities died, sites
 * blocked, etc.) and the inspector should faithfully show what the LLM SAID,
 * not what survived validation.
 */
export interface DisplayCommand {
  /** Short verb shown in the leading column ("produce", "build", "move", …). */
  readonly type: string;
  /** Human-readable body — already kind-resolved + coord-formatted. */
  readonly body: string;
  /** Logical color category — see CMD_COLORS in ai-inspector-panel.ts. */
  readonly color: CommandColor;
}

export type CommandColor = 'create' | 'move' | 'attack' | 'idle' | 'unknown';

/**
 * Resolves an entity id to its kind (e.g. "barracks", "worker"). Injected at
 * call time so the format module stays pure — production wiring reads from
 * `window.__world`, tests pass a Map.
 */
export type KindResolver = (id: EntityId) => string | null;

/**
 * Parses the raw LLM response into a displayable command list.
 *
 * Returns:
 *  - `{ kind: 'ok', commands: [...] }` on a successful JSON.parse to an array.
 *    Per-item failures degrade to a `type:'?'` row rather than dropping —
 *    inspector users want to see the malformed entry to know why it didn't
 *    apply.
 *  - `{ kind: 'empty' }` for `[]` — UI shows "(no commands this tick)".
 *  - `{ kind: 'unparseable', raw }` when JSON.parse throws or yields a
 *    non-array. UI shows a single warning line with the raw text.
 *
 * Intentionally SEPARATE from `parseCommands` in ../game/players/parser.ts:
 * parser.ts validates against a live GameView (entity-id liveness, kind
 * compatibility, walkable cells); this is a pure shape projection so the
 * inspector can display what the LLM emitted, not what survived gameplay.
 */
export type ParseDisplayResult =
  | { readonly kind: 'ok'; readonly commands: readonly DisplayCommand[] }
  | { readonly kind: 'empty' }
  | { readonly kind: 'unparseable'; readonly raw: string };

const COMMAND_TYPES: ReadonlySet<string> = new Set([
  'move',
  'attack',
  'attackMove',
  'gather',
  'build',
  'produce',
  'setRally',
  'cancel',
]);

const ID_LIST_INLINE_MAX = 4;

export function parseDisplayCommands(
  raw: string,
  resolveKind: KindResolver,
): ParseDisplayResult {
  const body = stripFence(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { kind: 'unparseable', raw: raw.trim() };
  }
  if (!Array.isArray(parsed)) {
    return { kind: 'unparseable', raw: raw.trim() };
  }
  if (parsed.length === 0) {
    return { kind: 'empty' };
  }
  const commands: DisplayCommand[] = [];
  for (const item of parsed) {
    commands.push(formatCommand(item, resolveKind));
  }
  return { kind: 'ok', commands };
}

export function formatCommand(raw: unknown, resolveKind: KindResolver): DisplayCommand {
  if (!isRecord(raw)) {
    return { type: '?', body: 'malformed (not an object)', color: 'unknown' };
  }
  const type = typeof raw.type === 'string' ? raw.type : '?';
  if (!COMMAND_TYPES.has(type)) {
    return { type: '?', body: `unknown type: ${type}`, color: 'unknown' };
  }
  switch (type) {
    case 'produce':
      return formatProduce(raw, resolveKind);
    case 'build':
      return formatBuild(raw, resolveKind);
    case 'setRally':
      return formatSetRally(raw, resolveKind);
    case 'move':
      return formatMoveLike(raw, resolveKind, 'move', 'move');
    case 'attackMove':
      return formatMoveLike(raw, resolveKind, 'attackMove', 'attack');
    case 'attack':
      return formatAttack(raw, resolveKind);
    case 'gather':
      return formatGather(raw, resolveKind);
    case 'cancel':
      return formatCancel(raw, resolveKind);
    default:
      return { type, body: '(unhandled)', color: 'unknown' };
  }
}

function formatProduce(raw: Record<string, unknown>, resolve: KindResolver): DisplayCommand {
  const buildingId = parseId(raw.buildingId);
  const unit = typeof raw.unit === 'string' ? raw.unit : '?';
  const ref = formatEntityRef(buildingId, resolve, 'building');
  return {
    type: 'produce',
    body: `${humanizeKind(unit).padEnd(14)} @ ${ref}`,
    color: 'create',
  };
}

function formatBuild(raw: Record<string, unknown>, resolve: KindResolver): DisplayCommand {
  const workerId = parseId(raw.workerId);
  const building = typeof raw.building === 'string' ? raw.building : '?';
  const cellX = parseFiniteNumber(raw.cellX);
  const cellY = parseFiniteNumber(raw.cellY);
  const coord = cellX !== null && cellY !== null ? `(${cellX}, ${cellY})` : '(?, ?)';
  const ref = formatEntityRef(workerId, resolve, 'worker');
  return {
    type: 'build',
    body: `${humanizeKind(building).padEnd(14)} @ ${coord} by ${ref}`,
    color: 'create',
  };
}

/**
 * camelCase / kebab-case → "SUPPLY DEPOT" / "TANK LIGHT". Pure cosmetic — the
 * underlying enum strings stay machine-friendly; the panel just reads better.
 */
function humanizeKind(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/-/g, ' ')
    .toUpperCase();
}

function formatSetRally(raw: Record<string, unknown>, resolve: KindResolver): DisplayCommand {
  const buildingId = parseId(raw.buildingId);
  const pos = parseVec2(raw.pos);
  const ref = formatEntityRef(buildingId, resolve, 'building');
  const coord = pos === null ? '(?, ?)' : `(${pos.x}, ${pos.y})`;
  return {
    type: 'setRally',
    body: `${ref} -> ${coord}`,
    color: 'move',
  };
}

function formatMoveLike(
  raw: Record<string, unknown>,
  _resolve: KindResolver,
  type: 'move' | 'attackMove',
  color: CommandColor,
): DisplayCommand {
  const ids = parseIdList(raw.unitIds);
  const pos = parseVec2(raw.target);
  const idStr = formatIdList(ids, 'unitIds');
  const coord = pos === null ? '(?, ?)' : `(${pos.x}, ${pos.y})`;
  return {
    type,
    body: `${idStr} -> ${coord}`,
    color,
  };
}

function formatAttack(raw: Record<string, unknown>, resolve: KindResolver): DisplayCommand {
  const ids = parseIdList(raw.unitIds);
  const targetId = parseId(raw.targetId);
  const idStr = formatIdList(ids, 'unitIds');
  const ref = formatEntityRef(targetId, resolve, 'target');
  return {
    type: 'attack',
    body: `${idStr} -> ${ref}`,
    color: 'attack',
  };
}

function formatGather(raw: Record<string, unknown>, resolve: KindResolver): DisplayCommand {
  const ids = parseIdList(raw.unitIds);
  const nodeId = parseId(raw.nodeId);
  const idStr = formatIdList(ids, 'workers');
  const ref = formatEntityRef(nodeId, resolve, 'node');
  return {
    type: 'gather',
    body: `${idStr} -> ${ref}`,
    color: 'idle',
  };
}

function formatCancel(raw: Record<string, unknown>, resolve: KindResolver): DisplayCommand {
  const entityId = parseId(raw.entityId);
  const ref = formatEntityRef(entityId, resolve, 'entity');
  return {
    type: 'cancel',
    body: ref,
    color: 'idle',
  };
}

/**
 * Render an id reference as `kind#id` when the resolver finds a kind, otherwise
 * `<fallback>#id`. Returns `<fallback>#?` when id is null. The fallback exists
 * so a stale/dead id from the LLM still reads coherently in the panel.
 */
export function formatEntityRef(
  id: EntityId | null,
  resolveKind: KindResolver,
  fallback: string,
): string {
  if (id === null) return `${fallback}#?`;
  const kind = resolveKind(id);
  return `${kind ?? fallback}#${id}`;
}

/**
 * Format a multi-id reference. Inline up to ID_LIST_INLINE_MAX ids; beyond that,
 * append `(N)` total count. Empty list reads as `<label>#[]` so the row still
 * renders rather than collapsing to a confusing trailing "->".
 */
export function formatIdList(ids: readonly EntityId[], label: string): string {
  if (ids.length === 0) return `${label}#[]`;
  if (ids.length <= ID_LIST_INLINE_MAX) {
    return `${label}#[${ids.join(',')}]`;
  }
  const head = ids.slice(0, ID_LIST_INLINE_MAX).join(',');
  return `${label}#[${head},...] (${ids.length})`;
}

/**
 * Right-pad the `type` column across a list so commands align vertically. The
 * pad width is the longest type string + 1 — keeps single-command lists tight
 * and grows naturally for mixed batches.
 */
export function padTypeColumn(commands: readonly DisplayCommand[]): readonly string[] {
  if (commands.length === 0) return [];
  let maxLen = 0;
  for (const c of commands) {
    if (c.type.length > maxLen) maxLen = c.type.length;
  }
  return commands.map((c) => c.type.padEnd(maxLen));
}

/** Latency in seconds with 1 decimal — `null`/missing renders as `…`. */
export function formatLatency(requestedAtMs: number, respondedAtMs: number | null): string {
  if (respondedAtMs === null) return '…';
  const sec = (respondedAtMs - requestedAtMs) / 1000;
  return `${sec.toFixed(1)}s`;
}

/**
 * Decorate the EventTracker `brief` line with emoji per event class. The brief
 * format from event-tracker.ts is comma-separated tokens like:
 *   "-2 medics (73,70) -1 tank-light (87,47), +6 kills, 3 hostiles near base"
 * We preserve the tokens but prepend a single emoji per class so the user can
 * scan deaths/kills/threats at a glance.
 *
 * `null` / `'no events'` / empty returns an empty array — the caller hides the
 * row entirely rather than rendering a "(none)" placeholder.
 */
export function formatRecentEvents(brief: string | null | undefined): readonly string[] {
  if (brief === null || brief === undefined) return [];
  const trimmed = brief.trim();
  if (trimmed.length === 0 || trimmed === 'no events') return [];
  const out: string[] = [];
  // Split on commas that are NOT inside parens — coord tokens like "(73,70)"
  // contain commas we MUST keep intact, so a naive `.split(',')` would shred
  // them across rows and lose the location info.
  for (const part of splitOutsideParens(trimmed, ',')) {
    const t = part.trim();
    if (t.length > 0) out.push(decorateEventToken(t));
  }
  return out;
}

function splitOutsideParens(input: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && ch === sep) {
      out.push(input.slice(start, i));
      start = i + 1;
    }
  }
  out.push(input.slice(start));
  return out;
}

function decorateEventToken(token: string): string {
  if (token.startsWith('-')) {
    // "-2 medics (73,70) -1 tank-light (87,47)" — multiple deaths in one comma
    // group; one emoji prefix is enough to cue the eye.
    return `\u{1F480} ${token}`;
  }
  if (/^\+\d+\s+kill/i.test(token)) return `⚔️ ${token}`;
  if (/hostile/i.test(token)) return `\u{1F3C3} ${token}`;
  if (/structure|building/i.test(token)) return `\u{1F3DA}️ ${token}`;
  return token;
}

// --- primitives ---------------------------------------------------------

function stripFence(raw: string): string {
  const fence = /```(?:json)?\s*([\s\S]*?)\s*```/m.exec(raw);
  if (fence) return fence[1].trim();
  return raw.trim();
}

function parseId(raw: unknown): EntityId | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  if (!Number.isInteger(raw) || raw < 0) return null;
  return raw;
}

function parseIdList(raw: unknown): EntityId[] {
  if (!Array.isArray(raw)) return [];
  const out: EntityId[] = [];
  for (const item of raw) {
    const id = parseId(item);
    if (id !== null) out.push(id);
  }
  return out;
}

function parseVec2(raw: unknown): { x: number; y: number } | null {
  if (!isRecord(raw)) return null;
  const x = parseFiniteNumber(raw.x);
  const y = parseFiniteNumber(raw.y);
  if (x === null || y === null) return null;
  return { x: Math.round(x), y: Math.round(y) };
}

function parseFiniteNumber(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return raw;
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}
