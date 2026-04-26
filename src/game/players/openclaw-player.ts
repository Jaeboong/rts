import type { Team } from '../../types';

import type { BuildOrderPhase } from './build-order-tracker';
import { inferBuildOrderPhase } from './build-order-tracker';
import type { DecisionRecord } from './decision-history';
import { pushDecision } from './decision-history';
import { EventTracker } from './event-tracker';
import type { AIExchange } from './nanoclaw-player';
import { parseCommands } from './parser';
import { buildPrompt, type PromptContext } from './prompt';
import { RallyTracker } from './rally-tracker';
import type { StateSummary } from './state-summary';
import { summarizeState } from './state-summary';
import type { AICommand, CommandResult, GameView, Player } from './types';

export interface OpenClawPlayerOpts {
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
  /**
   * OpenClaw model id used in the chat-completions body. Default reads from
   * VITE_OPENCLAW_AGENT_ID and falls back to 'openclaw/default'. The gateway
   * resolves this to the agent (which carries the AGENTS.md system prompt)
   * AND the underlying provider (openai-codex/gpt-5.5).
   */
  readonly model?: string;
  /** Endpoint URL. Default '/api/openclaw' (Vite plugin proxies to OpenClaw host). */
  readonly endpoint?: string;
  /** Decision-history depth for prompt context. Default 5. */
  readonly historyDepth?: number;
}

interface OpenAIChatCompletion {
  readonly choices?: ReadonlyArray<{
    readonly message?: { readonly content?: string };
  }>;
  readonly error?: { readonly message?: string } | string;
}

// 120s ceiling: Codex GPT-5.5 cold-start can hit ~80s; warm calls land at
// 5–15s. NanoclawPlayer uses 60s but Claude Haiku has no comparable cold-start
// hump, so OpenClaw needs the fatter budget or the first real tick after a
// runtime swap reliably times out.
const REQUEST_TIMEOUT_MS = 120000;
// Warmup gets a separate, even larger budget — first OAuth-backed request
// occasionally pays the gateway boot AND the model spin in the same call.
const WARMUP_TIMEOUT_MS = 180000;

/**
 * Async OpenClaw-backed Player. Mirrors NanoclawPlayer's contract (non-blocking
 * tick, async fetch buffering, throttle + in-flight gate, decision history,
 * event tracker, exchange ring, warmup) but talks to the OpenClaw HTTP gateway
 * via the OpenAI Chat Completions wire format:
 *
 *   POST /v1/chat/completions
 *   { model, messages: [{role:'user', content:<prompt>}], stream:false }
 *
 * The agent's AGENTS.md (server-side, NOT in this prompt) carries the rules /
 * persona; we send only the dynamic per-tick state. Response shape:
 *
 *   { choices: [{ message: { content: '<JSON array>' } }] }
 *
 * `content` is fed verbatim into the existing parser so any reasoning prose,
 * markdown fences, or dropped IDs are filtered server-agnostically.
 */
export class OpenClawPlayer implements Player {
  readonly team: Team;
  private buffer: AICommand[] = [];
  private inFlight = false;
  private warming = false;
  private lastRequestMs = Number.NEGATIVE_INFINITY;
  private readonly intervalMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly nowFn: () => number;
  private readonly model: string;
  private readonly endpoint: string;
  private readonly historyDepth: number;
  private exchanges: AIExchange[] = [];
  private readonly historyCap = 10;
  private decisions: readonly DecisionRecord[] = [];
  private pendingDispatched: AICommand[] | null = null;
  private pendingDispatchedTick = 0;
  private inflightTickAtRequest = 0;
  private lastSummary: StateSummary | null = null;
  private lastPhase: BuildOrderPhase | null = null;
  private readonly eventTracker: EventTracker;
  // Phase 44 — same lifecycle as NanoclawPlayer.rallyTracker; see rally-tracker.ts.
  private readonly rallyTracker: RallyTracker;

  constructor(team: Team, opts: OpenClawPlayerOpts = {}) {
    this.team = team;
    this.intervalMs = opts.intervalMs ?? 5000;
    this.fetchFn = opts.fetchFn ?? defaultFetch();
    this.nowFn = opts.nowFn ?? (() => performance.now());
    this.model = opts.model ?? defaultModel();
    this.endpoint = opts.endpoint ?? '/api/openclaw';
    this.historyDepth = opts.historyDepth ?? 5;
    this.eventTracker = new EventTracker(team);
    this.rallyTracker = new RallyTracker(team);
  }

  tick(view: GameView, _dt: number): readonly AICommand[] {
    const now = this.nowFn();
    if (!this.inFlight && now - this.lastRequestMs >= this.intervalMs) {
      this.lastRequestMs = now;
      this.inflightTickAtRequest = view.tick;
      void this.requestCommands(view);
    }
    const drained = this.buffer;
    this.buffer = [];
    if (drained.length > 0) {
      this.pendingDispatched = drained.slice();
      this.pendingDispatchedTick = this.inflightTickAtRequest;
    }
    return drained;
  }

  onCommandResults(results: readonly CommandResult[]): void {
    if (this.pendingDispatched === null) return;
    const record: DecisionRecord = {
      tickAtRequest: this.pendingDispatchedTick,
      results: results.map((r) => ({ cmd: r.cmd, ok: r.ok, reason: r.reason })),
    };
    this.decisions = pushDecision(this.decisions, record, this.historyDepth);
    // Phase 44 — record accepted setRally cmds for rally-tracker attribution.
    // See nanoclaw-player.ts for the rationale on the rejected-skip behavior.
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

  isWarming(): boolean {
    return this.warming;
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
      const r = await this.fetchOpenClaw(prompt, REQUEST_TIMEOUT_MS);
      exchange.respondedAtMs = this.nowFn();
      if (!r.ok) {
        const detail = await safeReadText(r);
        console.warn(`[openclaw] HTTP ${r.status} — ${detail}`);
        exchange.status = 'error';
        exchange.error = `HTTP ${r.status}`;
        return;
      }
      const data = (await r.json()) as OpenAIChatCompletion;
      const errorMsg = extractErrorMessage(data);
      if (errorMsg !== null) {
        console.warn('[openclaw] response error', errorMsg);
        exchange.status = 'error';
        exchange.error = errorMsg;
        return;
      }
      const content = extractContent(data);
      exchange.rawResponse = content;
      if (content.length === 0) {
        exchange.status = 'ok';
        return;
      }
      const cmds = parseCommands(content, view);
      exchange.parsedCount = cmds.length;
      exchange.status = 'ok';
      if (cmds.length > 0) this.buffer.push(...cmds);
    } catch (err) {
      console.warn('[openclaw] request failed', err);
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

  recentExchanges(): readonly AIExchange[] {
    return this.exchanges;
  }

  recentDecisions(): readonly DecisionRecord[] {
    return [...this.decisions].reverse();
  }

  lastStateSummary(): StateSummary | null {
    return this.lastSummary;
  }

  lastBuildPhase(): BuildOrderPhase | null {
    return this.lastPhase;
  }

  /**
   * Cold-start handshake. Fires a minimal "respond [] when ready" prompt so
   * the gateway pays its boot cost (and the OAuth-backed Codex container
   * spins) before the first real tick. Sets `warming=true` for the duration
   * so the HUD can render a badge.
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
      const r = await this.fetchOpenClaw(
        'Warmup ping. The full game manual is in your AGENTS.md system prompt — confirm you have it loaded by replying with the empty JSON array `[]` ONLY (no fences, no commentary).',
        WARMUP_TIMEOUT_MS,
      );
      exchange.respondedAtMs = this.nowFn();
      const latencyMs = exchange.respondedAtMs - startedAt;
      if (!r.ok) {
        const detail = await safeReadText(r);
        exchange.status = 'error';
        exchange.error = `HTTP ${r.status}: ${detail}`;
        return { ok: false, latencyMs, error: exchange.error };
      }
      const data = (await r.json()) as OpenAIChatCompletion;
      const errorMsg = extractErrorMessage(data);
      if (errorMsg !== null) {
        exchange.status = 'error';
        exchange.error = errorMsg;
        return { ok: false, latencyMs, error: exchange.error };
      }
      exchange.rawResponse = extractContent(data);
      exchange.status = 'ok';
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

  private async fetchOpenClaw(prompt: string, timeoutMs: number): Promise<Response> {
    return this.fetchFn(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        // The bridge plugin honors this hint to widen its upstream timeout.
        // 120s/180s ceilings are documented at REQUEST_TIMEOUT_MS / WARMUP_TIMEOUT_MS.
        timeoutMs,
      }),
    });
  }

  private pushExchange(e: AIExchange): void {
    this.exchanges = [e, ...this.exchanges].slice(0, this.historyCap);
  }
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function defaultFetch(): typeof fetch {
  if (typeof globalThis.fetch !== 'function') {
    throw new Error('OpenClawPlayer: globalThis.fetch unavailable; pass opts.fetchFn');
  }
  return globalThis.fetch.bind(globalThis);
}

function defaultModel(): string {
  // VITE_-prefixed env vars are inlined at build time (see vite.config.ts).
  // Fall back to 'openclaw/default' so unconfigured dev runs still pick a
  // model the gateway recognizes — agents.json maps it to the active agent.
  const envModel =
    typeof import.meta !== 'undefined' &&
    typeof import.meta.env === 'object' &&
    import.meta.env !== null &&
    typeof import.meta.env.VITE_OPENCLAW_AGENT_ID === 'string'
      ? import.meta.env.VITE_OPENCLAW_AGENT_ID
      : '';
  return envModel.length > 0 ? envModel : 'openclaw/default';
}

function extractContent(data: OpenAIChatCompletion): string {
  const choice = data.choices?.[0];
  const content = choice?.message?.content;
  return typeof content === 'string' ? content : '';
}

function extractErrorMessage(data: OpenAIChatCompletion): string | null {
  if (!data.error) return null;
  if (typeof data.error === 'string') return data.error;
  if (typeof data.error.message === 'string') return data.error.message;
  return 'unknown error';
}

async function safeReadText(r: Response): Promise<string> {
  try {
    return (await r.text()).slice(0, 200);
  } catch {
    return '<unreadable>';
  }
}

/**
 * Mirror of nanoclaw-player's deriveNotes. Kept inline (not extracted) per
 * the "no base-class refactor" constraint — duplication is cheaper than the
 * coupling.
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
