import type { EntityId, Team } from '../../types';

import type { GameView, ViewEntity } from './types';

/**
 * Phase 41 — combat-feedback tracker for the LLM-backed Player.
 *
 * Maintains state across LLM calls (NOT every game tick — see usage in
 * NanoclawPlayer.requestCommands) so the model sees:
 *   - brief: a token-cheap one-liner of what changed since the last call
 *   - detailed: every ~30s, a death-by-death report with attacker attribution
 *     and per-enemy advance/retreat classification
 *
 * Self-team is fixed at construction — NanoclawPlayer is the 'enemy' team in
 * rts2, so "my units died" / "I killed" must be computed from that perspective,
 * not hard-coded to 'player'.
 *
 * Deterministic: same sequence of views in → same brief/detailed strings out.
 */
export interface EventTrackerOpts {
  /**
   * Tick interval between detailed reports. Default 600 (= 30s @ 20Hz). Tick-
   * based rather than wall-clock so it respects pause + speedFactor.
   */
  readonly detailedIntervalTicks?: number;
  /**
   * Cells / sample threshold below which an enemy is classified 'static'.
   * Sample-to-sample movement is in pixel units divided by cellPx — well-tuned
   * threshold prevents an enemy that wiggles 1 cell over a 25s window from
   * looking like it's advancing.
   */
  readonly staticThresholdCells?: number;
  /** Ring-buffer depth per enemy. Default 5. */
  readonly historyDepth?: number;
}

export interface EventUpdateResult {
  readonly brief: string;
  readonly detailed?: string;
}

const DEFAULT_DETAILED_INTERVAL_TICKS = 600;
const DEFAULT_STATIC_THRESHOLD_CELLS = 2;
const DEFAULT_HISTORY_DEPTH = 5;

type Movement = 'advancing' | 'retreating' | 'static';

interface DeathRecord {
  readonly id: EntityId;
  readonly kind: string;
  readonly cellX: number;
  readonly cellY: number;
  readonly attacker: ViewEntity | null;
}

interface EnemyMovementRecord {
  readonly id: EntityId;
  readonly kind: string;
  readonly movement: Movement;
}

export class EventTracker {
  private readonly team: Team;
  private readonly detailedIntervalTicks: number;
  private readonly staticThresholdCells: number;
  private readonly historyDepth: number;
  private lastView: GameView | null = null;
  // Ring buffer of pixel positions per enemy ID. Trimmed to historyDepth.
  private enemyHistory: Map<EntityId, { x: number; y: number }[]> = new Map();
  // Tick at which the last detailed report was emitted; null until first emit.
  private lastDetailedTick: number | null = null;

  constructor(team: Team, opts: EventTrackerOpts = {}) {
    this.team = team;
    this.detailedIntervalTicks = opts.detailedIntervalTicks ?? DEFAULT_DETAILED_INTERVAL_TICKS;
    this.staticThresholdCells = opts.staticThresholdCells ?? DEFAULT_STATIC_THRESHOLD_CELLS;
    this.historyDepth = opts.historyDepth ?? DEFAULT_HISTORY_DEPTH;
  }

  /**
   * Diff currView against the stashed lastView, returning brief always and
   * detailed only when the tick gate has elapsed. Must be called on the same
   * cadence as the LLM request (NOT every game tick) — the brief is "what
   * changed since the last LLM call", and the detailed cooldown is measured in
   * ticks at LLM-call cadence too.
   */
  update(view: GameView): EventUpdateResult {
    if (this.lastView === null) {
      // Cold start — seed history + baseline, emit no events. Also stamp
      // lastDetailedTick so the FIRST detailed report is gated by a full
      // interval from cold-start, not from null (which would fire immediately
      // on the second call).
      this.lastView = view;
      this.lastDetailedTick = view.tick;
      this.seedEnemyHistory(view);
      return { brief: 'no events' };
    }

    const prev = this.lastView;
    const prevById = indexById(prev.myEntities, prev.visibleEnemies);
    const currById = indexById(view.myEntities, view.visibleEnemies);

    const deaths: DeathRecord[] = [];
    const kills: DeathRecord[] = [];
    for (const [id, prevEnt] of prevById) {
      const curr = currById.get(id);
      if (curr !== undefined) continue;
      const attacker = resolveAttacker(prevEnt, prevById);
      const rec: DeathRecord = {
        id,
        kind: prevEnt.kind,
        cellX: cellOf(prevEnt, prev.mapInfo.cellPx).x,
        cellY: cellOf(prevEnt, prev.mapInfo.cellPx).y,
        attacker,
      };
      if (prevEnt.team === this.team) {
        deaths.push(rec);
      } else {
        kills.push(rec);
      }
    }

    this.advanceEnemyHistory(view);

    const ccPos = findOwnCC(view, this.team);
    const movements = classifyEnemyMovements(
      view,
      this.enemyHistory,
      ccPos,
      view.mapInfo.cellPx,
      this.staticThresholdCells,
    );

    const hostilesNearBaseCount = ccPos === null
      ? 0
      : countHostilesNear(view, ccPos, view.mapInfo.cellPx);

    const brief = formatBrief(deaths, kills, hostilesNearBaseCount, ccPos !== null);

    let detailed: string | undefined;
    // lastDetailedTick is non-null after cold-start (seeded in the early
    // return above), so this is a straight subtraction.
    const elapsedTicks = view.tick - (this.lastDetailedTick ?? view.tick);
    if (elapsedTicks >= this.detailedIntervalTicks) {
      detailed = formatDetailed(deaths, kills, view, movements, ccPos !== null);
      this.lastDetailedTick = view.tick;
    }

    this.lastView = view;
    return detailed === undefined ? { brief } : { brief, detailed };
  }

  private seedEnemyHistory(view: GameView): void {
    for (const e of view.visibleEnemies) {
      this.enemyHistory.set(e.id, [{ x: e.pos.x, y: e.pos.y }]);
    }
  }

  private advanceEnemyHistory(view: GameView): void {
    const liveIds = new Set<EntityId>();
    for (const e of view.visibleEnemies) {
      liveIds.add(e.id);
      const ring = this.enemyHistory.get(e.id);
      if (ring === undefined) {
        this.enemyHistory.set(e.id, [{ x: e.pos.x, y: e.pos.y }]);
        continue;
      }
      ring.push({ x: e.pos.x, y: e.pos.y });
      if (ring.length > this.historyDepth) ring.shift();
    }
    // Drop history for enemies no longer visible — keeps the map from growing
    // unboundedly across long games and stops stale samples reappearing if an
    // ID is re-used by the entity factory.
    for (const id of [...this.enemyHistory.keys()]) {
      if (!liveIds.has(id)) this.enemyHistory.delete(id);
    }
  }
}

function indexById(
  ...lists: readonly (readonly ViewEntity[])[]
): Map<EntityId, ViewEntity> {
  const out = new Map<EntityId, ViewEntity>();
  for (const list of lists) {
    for (const e of list) out.set(e.id, e);
  }
  return out;
}

function resolveAttacker(
  dead: ViewEntity,
  prevById: Map<EntityId, ViewEntity>,
): ViewEntity | null {
  if (dead.lastDamageBy === undefined) return null;
  return prevById.get(dead.lastDamageBy) ?? null;
}

function cellOf(e: ViewEntity, cellPx: number): { x: number; y: number } {
  if (e.cellX !== undefined && e.cellY !== undefined) {
    return { x: e.cellX, y: e.cellY };
  }
  return { x: Math.floor(e.pos.x / cellPx), y: Math.floor(e.pos.y / cellPx) };
}

function findOwnCC(view: GameView, team: Team): { x: number; y: number } | null {
  // Center-of-footprint for the first commandCenter we own (alive). When lost,
  // returns null and movement classification is skipped.
  for (const e of view.myEntities) {
    if (e.kind !== 'commandCenter') continue;
    if (e.team !== team) continue;
    if (e.cellX !== undefined && e.cellY !== undefined) {
      const cellPx = view.mapInfo.cellPx;
      // Hard-coded 4×4 footprint matches BUILDING_DEFS.commandCenter; using
      // pos directly would land at the (0,0) corner of the footprint.
      return {
        x: (e.cellX + 2) * cellPx,
        y: (e.cellY + 2) * cellPx,
      };
    }
    return { x: e.pos.x, y: e.pos.y };
  }
  return null;
}

function classifyEnemyMovements(
  view: GameView,
  history: Map<EntityId, { x: number; y: number }[]>,
  ccPos: { x: number; y: number } | null,
  cellPx: number,
  staticThresholdCells: number,
): EnemyMovementRecord[] {
  const out: EnemyMovementRecord[] = [];
  for (const e of view.visibleEnemies) {
    const ring = history.get(e.id);
    if (ring === undefined || ring.length < 2 || ccPos === null) {
      // Not enough samples to call direction; treat as static so we don't lie
      // to the LLM about a fresh sighting.
      out.push({ id: e.id, kind: e.kind, movement: 'static' });
      continue;
    }
    const oldest = ring[0];
    const newest = ring[ring.length - 1];
    const moveX = newest.x - oldest.x;
    const moveY = newest.y - oldest.y;
    const moveCells = Math.hypot(moveX, moveY) / cellPx;
    if (moveCells < staticThresholdCells) {
      out.push({ id: e.id, kind: e.kind, movement: 'static' });
      continue;
    }
    // Vector from sample → CC (target the enemy is approaching/leaving).
    const towardCcX = ccPos.x - oldest.x;
    const towardCcY = ccPos.y - oldest.y;
    const dot = moveX * towardCcX + moveY * towardCcY;
    out.push({
      id: e.id,
      kind: e.kind,
      movement: dot > 0 ? 'advancing' : 'retreating',
    });
  }
  return out;
}

function countHostilesNear(
  view: GameView,
  ccPos: { x: number; y: number },
  cellPx: number,
): number {
  const NEAR_BASE_CELLS = 16;
  let count = 0;
  for (const e of view.visibleEnemies) {
    const dxCells = (e.pos.x - ccPos.x) / cellPx;
    const dyCells = (e.pos.y - ccPos.y) / cellPx;
    if (Math.hypot(dxCells, dyCells) <= NEAR_BASE_CELLS) count++;
  }
  return count;
}

function formatBrief(
  deaths: readonly DeathRecord[],
  kills: readonly DeathRecord[],
  hostilesNearBase: number,
  hasCc: boolean,
): string {
  if (deaths.length === 0 && kills.length === 0 && hostilesNearBase === 0) {
    return 'no events';
  }
  const parts: string[] = [];
  if (deaths.length > 0) {
    parts.push(formatDeathSummary(deaths));
  }
  if (kills.length > 0) {
    parts.push(`+${kills.length} kill${kills.length === 1 ? '' : 's'}`);
  }
  if (hostilesNearBase > 0 && hasCc) {
    parts.push(`${hostilesNearBase} hostile${hostilesNearBase === 1 ? '' : 's'} near base`);
  }
  return parts.join(', ');
}

function formatDeathSummary(deaths: readonly DeathRecord[]): string {
  // Group by kind for the brief to keep the line short. e.g. "-2 marines (37,42)".
  const byKind = new Map<string, DeathRecord[]>();
  for (const d of deaths) {
    const existing = byKind.get(d.kind);
    if (existing === undefined) byKind.set(d.kind, [d]);
    else existing.push(d);
  }
  const segs: string[] = [];
  for (const [kind, list] of byKind) {
    const sample = list[0];
    const label = list.length === 1 ? kind : `${kind}s`;
    segs.push(`-${list.length} ${label} (${sample.cellX},${sample.cellY})`);
  }
  return segs.join(' ');
}

function formatDetailed(
  deaths: readonly DeathRecord[],
  kills: readonly DeathRecord[],
  view: GameView,
  movements: readonly EnemyMovementRecord[],
  hasCc: boolean,
): string {
  const lines: string[] = [];
  if (deaths.length === 0 && kills.length === 0) {
    lines.push('No deaths or kills in the last reporting window.');
  }
  for (const d of deaths) {
    lines.push(formatDeathLine('My', d, movements));
  }
  for (const k of kills) {
    lines.push(formatDeathLine('Enemy', k, movements));
  }
  lines.push(formatVisibleEnemiesAggregate(view, movements, hasCc));
  return lines.join('\n');
}

function formatDeathLine(
  side: 'My' | 'Enemy',
  d: DeathRecord,
  movements: readonly EnemyMovementRecord[],
): string {
  const head = `${side} ${d.kind} #${d.id} died at (${d.cellX},${d.cellY})`;
  if (d.attacker === null) {
    return `${head} — killed by unknown`;
  }
  const a = d.attacker;
  const movement = movements.find((m) => m.id === a.id);
  const tail = movement === undefined ? '' : ` [${a.kind} ${movement.movement}]`;
  return `${head} — killed by ${a.kind} #${a.id}${tail}`;
}

function formatVisibleEnemiesAggregate(
  view: GameView,
  movements: readonly EnemyMovementRecord[],
  hasCc: boolean,
): string {
  if (view.visibleEnemies.length === 0) return 'Visible enemies: none';
  const byKind = new Map<string, number>();
  for (const e of view.visibleEnemies) {
    byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);
  }
  const kindStr = [...byKind.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, n]) => `${n} ${k}${n === 1 ? '' : 's'}`)
    .join(', ');
  if (!hasCc) {
    return `Visible enemies: ${kindStr} — no CC reference, movement unknown`;
  }
  let advancing = 0;
  let retreating = 0;
  let staticCount = 0;
  for (const m of movements) {
    if (m.movement === 'advancing') advancing++;
    else if (m.movement === 'retreating') retreating++;
    else staticCount++;
  }
  return `Visible enemies: ${kindStr} — ${advancing} advancing, ${retreating} retreating, ${staticCount} static`;
}
