import type { Team } from '../../types';

import type { BuildOrderPhase } from './build-order-tracker';
import { inferBuildOrderPhase } from './build-order-tracker';
import type { DecisionRecord } from './decision-history';
import { pushDecision } from './decision-history';
import { EventTracker } from './event-tracker';
import { parseCommands } from './parser';
import { buildPrompt, type PromptContext } from './prompt';
import { RallyTracker } from './rally-tracker';
import type { StateSummary } from './state-summary';
import { summarizeState } from './state-summary';
import type { AICommand, CommandResult, GameView, Player } from './types';

export interface NanoclawPlayerOpts {
  /** Min ms between requests. Default 5000 (matches §4-2 throttle). */
  readonly intervalMs?: number;
  /**
   * Injectable fetch — tests pass a mock to keep the suite hermetic. Default
   * binds globalThis.fetch (must be bound or it throws "Illegal invocation"
   * in browsers).
   */
  readonly fetchFn?: typeof fetch;
  /** Injectable clock for deterministic throttle tests. Default performance.now. */
  readonly nowFn?: () => number;
  /** Nanoclaw group folder name. Default 'rts-ai'. */
  readonly groupFolder?: string;
  /** Endpoint URL. Default '/api/nanoclaw' (Vite plugin proxies to Nanoclaw host). */
  readonly endpoint?: string;
  /** Decision-history depth for prompt context. Default 5. */
  readonly historyDepth?: number;
}

interface NanoclawResponse {
  readonly success?: boolean;
  readonly output?: string;
  readonly error?: string;
}

export interface AIExchange {
  readonly tickAtRequest: number;
  readonly requestedAtMs: number;
  readonly respondedAtMs: number | null;
  readonly prompt: string;
  readonly rawResponse: string | null;
  readonly parsedCount: number;
  readonly status: 'pending' | 'ok' | 'error';
  readonly error?: string;
}

/**
 * Async LLM-backed Player. Buffers commands produced by Nanoclaw responses;
 * tick() drains the buffer synchronously and never awaits — the game loop
 * (50ms tick) cannot afford to block on a 5–15s LLM response.
 *
 * Throttling: a new HTTP request fires only if (a) no request is in flight
 * AND (b) `intervalMs` has elapsed since the last request started. Between
 * requests, tick() does nothing but drain whatever the most recent response
 * pushed in.
 *
 * Feedback loop (Phase 40-C): when commands drain on a tick, the player
 * stashes them as "pending dispatched"; runner.ts applies them and calls
 * `onCommandResults` with per-command outcomes. The player pairs the two
 * into a DecisionRecord and embeds the last N records in the next prompt
 * so the LLM can self-correct stale IDs / blocked sites.
 *
 * Failure modes (all non-fatal — game keeps ticking):
 *   - fetch rejects (network down, plugin off): warn, no buffer push.
 *   - response not ok / 5xx: warn, no buffer push.
 *   - response.success === false: warn, no buffer push.
 *   - parse failure / stale entity IDs: parser drops invalid commands silently.
 */
export class NanoclawPlayer implements Player {
  readonly team: Team;
  private buffer: AICommand[] = [];
  private inFlight = false;
  // Phase 42: HUD badge gate. Flipped in warmup() so the runtime swap can show
  // a "warming…" indicator while the cold-start container is grinding.
  private warming = false;
  private lastRequestMs = Number.NEGATIVE_INFINITY;
  private readonly intervalMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly nowFn: () => number;
  private readonly groupFolder: string;
  private readonly endpoint: string;
  private readonly historyDepth: number;
  // Ring buffer of recent exchanges for the in-game inspector panel.
  private exchanges: AIExchange[] = [];
  private readonly historyCap = 10;
  // Decision history (cmd + outcome). Embedded in next prompt as feedback.
  private decisions: readonly DecisionRecord[] = [];
  // Cmds drained on the current tick, paired with the source request's tick;
  // populated in tick(), consumed in onCommandResults to assemble a DecisionRecord.
  private pendingDispatched: AICommand[] | null = null;
  private pendingDispatchedTick = 0;
  // The tick of the GameView that drove the most recent in-flight request —
  // copied into pendingDispatchedTick when those cmds drain.
  private inflightTickAtRequest = 0;
  // Cache of the last summary/phase for inspector + idempotent ctx assembly.
  private lastSummary: StateSummary | null = null;
  private lastPhase: BuildOrderPhase | null = null;
  // Phase 41 — combat-feedback tracker. Updated once per LLM request, NOT per
  // game tick: the brief is "what changed since last LLM call" and the 30s
  // detailed gate is measured at LLM-call cadence.
  private readonly eventTracker: EventTracker;
  // Phase 44 — rally postmortem tracker. Same cadence as eventTracker; called
  // from buildPromptCtx (update) and from onCommandResults (recordRallySet,
  // for each setRally that the apply-layer accepted).
  private readonly rallyTracker: RallyTracker;

  constructor(team: Team, opts: NanoclawPlayerOpts = {}) {
    this.team = team;
    this.intervalMs = opts.intervalMs ?? 5000;
    // Bind to globalThis to avoid "Illegal invocation" in browser-style fetch.
    this.fetchFn = opts.fetchFn ?? defaultFetch();
    this.nowFn = opts.nowFn ?? (() => performance.now());
    this.groupFolder = opts.groupFolder ?? 'rts-ai';
    this.endpoint = opts.endpoint ?? '/api/nanoclaw';
    this.historyDepth = opts.historyDepth ?? 5;
    this.eventTracker = new EventTracker(team);
    this.rallyTracker = new RallyTracker(team);
  }

  tick(view: GameView, _dt: number): readonly AICommand[] {
    const now = this.nowFn();
    if (!this.inFlight && now - this.lastRequestMs >= this.intervalMs) {
      // Set inFlight + lastRequestMs synchronously here, BEFORE the await chain
      // begins inside requestCommands. JS runs the function body up to the
      // first await synchronously, so this prevents the next tick from
      // re-entering while the request is in flight.
      this.lastRequestMs = now;
      this.inflightTickAtRequest = view.tick;
      void this.requestCommands(view);
    }
    const drained = this.buffer;
    this.buffer = [];
    if (drained.length > 0) {
      // Stash for onCommandResults pairing. The tick stamped is the tick of
      // the prompt that produced these cmds (NOT the current tick) so the LLM
      // sees temporally correct decision provenance.
      this.pendingDispatched = drained.slice();
      this.pendingDispatchedTick = this.inflightTickAtRequest;
    }
    return drained;
  }

  /**
   * Runner-driven feedback. Pairs the cmds we returned from `tick()` with
   * their apply outcomes and stores a DecisionRecord. No-op when nothing was
   * dispatched (idle ticks).
   */
  onCommandResults(results: readonly CommandResult[]): void {
    if (this.pendingDispatched === null) return;
    // Defensive: the runner pairs results 1:1 with cmds in order, but if a
    // future runner change interleaves, we still record what we got.
    const record: DecisionRecord = {
      tickAtRequest: this.pendingDispatchedTick,
      results: results.map((r) => ({ cmd: r.cmd, ok: r.ok, reason: r.reason })),
    };
    this.decisions = pushDecision(this.decisions, record, this.historyDepth);
    // Phase 44 — record every accepted setRally so the rally-tracker can
    // attribute future deaths back to the rally point. Rejected setRally
    // (e.g. command-applier hard-rejects rallies inside enemy attackRange)
    // never installed a rallyPoint, so we deliberately skip those.
    for (const r of results) {
      if (r.ok && r.cmd.type === 'setRally') {
        this.rallyTracker.recordRallySet(
          r.cmd.buildingId,
          r.cmd.pos,
          this.pendingDispatchedTick,
        );
      }
    }
    this.pendingDispatched = null;
  }

  private async requestCommands(view: GameView): Promise<void> {
    this.inFlight = true;
    const ctx = this.buildPromptCtx(view);
    const prompt = buildPrompt(view, ctx);
    const exchange: Mutable<AIExchange> = {
      tickAtRequest: view.tick,
      requestedAtMs: this.nowFn(),
      respondedAtMs: null,
      prompt,
      rawResponse: null,
      parsedCount: 0,
      status: 'pending',
    };
    this.pushExchange(exchange);
    try {
      const r = await this.fetchFn(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupFolder: this.groupFolder,
          message: prompt,
          // Sonnet 4.6 + tool-use mode + grown prompt (decision history /
          // event tracker) routinely hits 25-50s and occasionally 60s+ when
          // Anthropic API is under load. 120s matches OpenClawPlayer to stop
          // SIGKILL'ing valid responses mid-stream during sustained play.
          timeoutMs: 120000,
        }),
      });
      exchange.respondedAtMs = this.nowFn();
      if (!r.ok) {
        console.warn(`[nanoclaw] HTTP ${r.status}`);
        exchange.status = 'error';
        exchange.error = `HTTP ${r.status}`;
        return;
      }
      const data = (await r.json()) as NanoclawResponse;
      if (data.success === false) {
        console.warn('[nanoclaw] response.success=false', data.error);
        exchange.status = 'error';
        exchange.error = data.error ?? 'success=false';
        return;
      }
      const output = typeof data.output === 'string' ? data.output : '';
      exchange.rawResponse = output;
      if (output.length === 0) {
        exchange.status = 'ok';
        return;
      }
      const cmds = parseCommands(output, view);
      exchange.parsedCount = cmds.length;
      exchange.status = 'ok';
      if (cmds.length > 0) this.buffer.push(...cmds);
    } catch (err) {
      console.warn('[nanoclaw] request failed', err);
      exchange.respondedAtMs = this.nowFn();
      exchange.status = 'error';
      exchange.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.inFlight = false;
    }
  }

  private buildPromptCtx(view: GameView): PromptContext {
    const summary = summarizeState(view);
    const phase = inferBuildOrderPhase(view, summary);
    const events = this.eventTracker.update(view);
    const rally = this.rallyTracker.update(view);
    this.lastSummary = summary;
    this.lastPhase = phase;
    return {
      summary,
      phase,
      decisions: this.decisions,
      notes: deriveNotes(summary, phase, this.decisions),
      recentEventsBrief: events.brief,
      recentEventsDetailed: events.detailed,
      rallyWarnings: rally.warnings,
    };
  }

  /** Most-recent-first list of recent prompt/response cycles. */
  recentExchanges(): readonly AIExchange[] {
    return this.exchanges;
  }

  /** Most-recent-first list of recent decision cycles (cmd + outcome). */
  recentDecisions(): readonly DecisionRecord[] {
    // Internal storage is oldest→newest (so prompt reads chronologically);
    // inspector wants newest first for UI scroll.
    return [...this.decisions].reverse();
  }

  /** Latest synthesized summary (or null before the first request). */
  lastStateSummary(): StateSummary | null {
    return this.lastSummary;
  }

  /** Latest inferred build phase (or null before the first request). */
  lastBuildPhase(): BuildOrderPhase | null {
    return this.lastPhase;
  }

  /**
   * One-shot health check: sends a minimal "respond [] when ready" prompt and
   * resolves on the first successful round-trip. Lets the caller (main.ts)
   * gate game start on a working LLM connection — without this, the game runs
   * for 60s with the enemy frozen because the first real tick is stuck waiting
   * on the cold-start container.
   */
  async warmup(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const startedAt = this.nowFn();
    this.warming = true;
    const exchange: Mutable<AIExchange> = {
      tickAtRequest: -1,
      requestedAtMs: startedAt,
      respondedAtMs: null,
      prompt: '[warmup] Respond with [] only.',
      rawResponse: null,
      parsedCount: 0,
      status: 'pending',
    };
    this.pushExchange(exchange);
    try {
      const r = await this.fetchFn(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupFolder: this.groupFolder,
          message:
            'Warmup ping. The full game manual is in your CLAUDE.md system prompt — confirm you have it loaded by replying with the empty JSON array `[]` ONLY (no fences, no commentary).',
          // Match requestCommands' 120000 — Opus 504 diagnosis showed warmup
          // racing the queue at 91349ms cold-start, killed 1.3s before responding.
          timeoutMs: 120000,
        }),
      });
      exchange.respondedAtMs = this.nowFn();
      const latencyMs = exchange.respondedAtMs - startedAt;
      if (!r.ok) {
        exchange.status = 'error';
        exchange.error = `HTTP ${r.status}`;
        return { ok: false, latencyMs, error: exchange.error };
      }
      const data = (await r.json()) as NanoclawResponse;
      if (data.success === false) {
        exchange.status = 'error';
        exchange.error = data.error ?? 'success=false';
        return { ok: false, latencyMs, error: exchange.error };
      }
      exchange.rawResponse = data.output ?? '';
      exchange.status = 'ok';
      // Allow the next real tick to fire immediately rather than waiting another
      // intervalMs — the warmup already paid the throttle.
      this.lastRequestMs = Number.NEGATIVE_INFINITY;
      return { ok: true, latencyMs };
    } catch (err) {
      exchange.respondedAtMs = this.nowFn();
      exchange.status = 'error';
      exchange.error = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        latencyMs: exchange.respondedAtMs - startedAt,
        error: exchange.error,
      };
    } finally {
      this.warming = false;
    }
  }

  /** Phase 42 — HUD reads this to render a "warming…" badge during cold-start. */
  isWarming(): boolean {
    return this.warming;
  }

  private pushExchange(e: AIExchange): void {
    this.exchanges = [e, ...this.exchanges].slice(0, this.historyCap);
  }
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * Generate prompt-side notes that highlight blockers the model tends to miss
 * (idle workers, unaffordable pre-conditions met but no action, repeated
 * rejected commands). Pure function of the same data the prompt already
 * exposes — keeps the model from having to re-derive obvious facts.
 */
function deriveNotes(
  summary: StateSummary,
  phase: BuildOrderPhase,
  decisions: readonly DecisionRecord[],
): string[] {
  const notes: string[] = [];
  if (summary.workers.idle > 0) {
    const ids = summary.workers.idleIds.length > 0 ? `: ${summary.workers.idleIds.join(',')}` : '';
    notes.push(
      `You have ${summary.workers.idle} idle worker(s)${ids}. Consider gathering them.`,
    );
  }
  if (
    phase.currentStep === 'tech-up-barracks' &&
    summary.minerals >= 150 &&
    summary.buildings.barracks === 0
  ) {
    notes.push(
      `You have ${summary.minerals}M and no barracks. Build phase says build barracks now.`,
    );
  }
  if (decisions.length > 0) {
    const last = decisions[decisions.length - 1];
    const repeated = last.results.filter((r) => !r.ok && r.reason !== undefined);
    if (repeated.length > 0) {
      notes.push(
        `Last cycle: ${repeated.length} command(s) rejected. Read the rejection reasons and avoid repeating.`,
      );
    }
  }
  return notes;
}

function defaultFetch(): typeof fetch {
  if (typeof globalThis.fetch !== 'function') {
    // Surface a clear error at construction-time rather than a cryptic one
    // mid-game. Node 18+ and modern browsers ship fetch; tests inject mocks.
    throw new Error('NanoclawPlayer: globalThis.fetch unavailable; pass opts.fetchFn');
  }
  return globalThis.fetch.bind(globalThis);
}
