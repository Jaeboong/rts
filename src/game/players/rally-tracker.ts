import type { EntityId, Team, Vec2 } from '../../types';

import type { GameView, ViewEntity } from './types';

/**
 * Phase 44 — rally-postmortem tracker for the LLM-backed Player.
 *
 * Closes the empirical feedback loop on rally placement: setRally itself can
 * succeed at apply-time but still be lethal — produced units walk to the
 * rally on a path that crosses enemy fire arcs (or a static enemy strolls
 * into the rally cone after the fact). The tracker watches own-team deaths
 * within a small radius of every active rally and surfaces a one-line
 * warning to the next prompt when corpses pile up.
 *
 * Design pegs:
 *   - Updated on the SAME cadence as EventTracker (per LLM call, NOT per game
 *     tick). The 60s window is therefore measured in ticks (1200 @ 20Hz) so it
 *     respects pause + speedFactor identically.
 *   - Self-team is fixed at construction (NanoclawPlayer/OpenClawPlayer = the
 *     'enemy' team in rts2). Own-team deaths only — kills of the opponent are
 *     orthogonal and event-tracker's job.
 *   - 5-cell radius (80px @ CELL=16) is "rally cluster" not "rally cone". A
 *     unit dying 6 cells from rally was probably already on the move past the
 *     rally; below 5 cells we're confident the rally is the staging trap.
 *   - Pruning: a rally with zero deaths after 60s drops out (LLM likely moved
 *     it or stopped producing). A rally that bled units stays until a fresh
 *     60s window of NO new deaths elapses — keeps the warning visible across
 *     consecutive LLM calls so the model has multiple shots at relocating.
 */

// Same 20Hz × 60s convention as EventTracker.detailedIntervalTicks default.
const DEATH_WINDOW_TICKS = 1200;
// 5 cells × 16 px/cell = 80 px. Squared so the inner loop avoids sqrt.
const NEAR_RALLY_CELLS = 5;

interface DeathNearRally {
  readonly tick: number;
  readonly kind: string;
  readonly pos: Vec2;
}

interface RallyEntry {
  readonly buildingId: EntityId;
  readonly pos: Vec2;
  readonly setAtTick: number;
  // Mutated in place — keeping the entry readonly-shaped at the API surface
  // and the array internal lets us trim without rebuilding the wrapper.
  deaths: DeathNearRally[];
}

export interface RallyUpdateResult {
  readonly warnings: readonly string[];
}

export class RallyTracker {
  // Keyed by buildingId — at most one active rally per producer building. A
  // re-`setRally` on the same building overwrites (matches game-side rally
  // semantics) and resets the tracking for that key.
  private readonly active: Map<EntityId, RallyEntry> = new Map();
  // Last view we processed; used to diff for own-team deaths between calls.
  // Null until the first update() — cold-start emits no warnings (same shape
  // as event-tracker's seed-and-skip pattern).
  private lastView: GameView | null = null;

  // Constructor takes `team` for API symmetry with EventTracker, even though
  // we don't store it — view.myEntities is pre-filtered to this player's team
  // upstream in view.ts, so own-team death attribution is automatic.
  constructor(_team: Team) {
    // intentionally empty; param kept for forward-compat & call-site symmetry.
  }

  /**
   * Records a rally that the LLM just set. Called by the player when applying
   * the response cmds (one call per setRally that the apply-layer accepted).
   * Subsequent calls with the same buildingId overwrite — matches the in-game
   * rally rule that the building has at most one rally at a time.
   */
  recordRallySet(buildingId: EntityId, pos: Vec2, tick: number): void {
    this.active.set(buildingId, {
      buildingId,
      pos: { x: pos.x, y: pos.y },
      setAtTick: tick,
      deaths: [],
    });
  }

  /**
   * Diff currView against the stashed lastView, attribute new own-team deaths
   * to nearby rallies, prune stale rallies, and return warning strings for
   * any rally that has bled units in the active 60s window.
   *
   * Must be called on the same cadence as the LLM request (NOT every game
   * tick) — the death attribution between two views is "what changed since
   * the last prompt", and the 60s prune window is measured at LLM-call cadence
   * to stay consistent with EventTracker.
   */
  update(view: GameView): RallyUpdateResult {
    const cellPx = view.mapInfo.cellPx;
    const tick = view.tick;

    if (this.lastView !== null) {
      const prevById = indexById(this.lastView.myEntities);
      const currById = indexById(view.myEntities);
      // Detect own-team deaths: present last frame, absent this frame.
      for (const [id, prev] of prevById) {
        if (currById.has(id)) continue;
        // Skip building deaths — rally-staging is a unit concern, and a CC
        // dying near the rally is its own catastrophe (event-tracker handles).
        if (isBuildingKind(prev.kind)) continue;
        this.attributeDeath(prev, tick, cellPx);
      }
    }

    this.prune(tick);
    const warnings = this.buildWarnings();

    this.lastView = view;
    return { warnings };
  }

  private attributeDeath(dead: ViewEntity, tick: number, cellPx: number): void {
    // 5 cells in pixel units, squared for the inner compare.
    const radiusPx = NEAR_RALLY_CELLS * cellPx;
    const radiusSq = radiusPx * radiusPx;
    for (const entry of this.active.values()) {
      const dx = dead.pos.x - entry.pos.x;
      const dy = dead.pos.y - entry.pos.y;
      const distSq = dx * dx + dy * dy;
      if (distSq <= radiusSq) {
        entry.deaths.push({
          tick,
          kind: dead.kind,
          pos: { x: dead.pos.x, y: dead.pos.y },
        });
      }
    }
  }

  private prune(tick: number): void {
    const cutoff = tick - DEATH_WINDOW_TICKS;
    for (const [id, entry] of this.active) {
      // Drop deaths older than the window. We keep the entry around as long
      // as it has any in-window deaths OR it was set within the window (LLM
      // just placed it — give it time to attract / not-attract corpses).
      entry.deaths = entry.deaths.filter((d) => d.tick > cutoff);
      const recentlySet = entry.setAtTick > cutoff;
      const stillBleeding = entry.deaths.length > 0;
      if (!recentlySet && !stillBleeding) {
        this.active.delete(id);
      }
    }
  }

  private buildWarnings(): string[] {
    const out: string[] = [];
    for (const entry of this.active.values()) {
      if (entry.deaths.length === 0) continue;
      // Format pixel coords (matching how setRally/move targets are addressed
      // in prompts). LLM's setRally response carries pixel pos verbatim, so
      // showing pixels keeps the warning self-referencing without conversion.
      out.push(
        `⚠️ Rally at (${entry.pos.x}, ${entry.pos.y}) cost ${entry.deaths.length} unit${
          entry.deaths.length === 1 ? '' : 's'
        } in last 60s — relocate or units will keep dying`,
      );
    }
    return out;
  }
}

function indexById(list: readonly ViewEntity[]): Map<EntityId, ViewEntity> {
  const out = new Map<EntityId, ViewEntity>();
  for (const e of list) out.set(e.id, e);
  return out;
}

// ViewEntity carries no team-tagged building flag; this matches the kind-set
// approach used in command-applier.ts. Kept inline to avoid a shared exported
// constant that two unrelated modules would have to keep in sync.
const BUILDING_KINDS: ReadonlySet<string> = new Set([
  'commandCenter',
  'barracks',
  'turret',
  'refinery',
  'factory',
  'supplyDepot',
]);

function isBuildingKind(kind: string): boolean {
  return BUILDING_KINDS.has(kind);
}
