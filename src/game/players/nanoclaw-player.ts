import type { Team } from '../../types';

import { parseCommands } from './parser';
import { buildPrompt } from './prompt';
import type { AICommand, GameView, Player } from './types';

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
}

interface NanoclawResponse {
  readonly success?: boolean;
  readonly output?: string;
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
  private lastRequestMs = Number.NEGATIVE_INFINITY;
  private readonly intervalMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly nowFn: () => number;
  private readonly groupFolder: string;
  private readonly endpoint: string;

  constructor(team: Team, opts: NanoclawPlayerOpts = {}) {
    this.team = team;
    this.intervalMs = opts.intervalMs ?? 5000;
    // Bind to globalThis to avoid "Illegal invocation" in browser-style fetch.
    this.fetchFn = opts.fetchFn ?? defaultFetch();
    this.nowFn = opts.nowFn ?? (() => performance.now());
    this.groupFolder = opts.groupFolder ?? 'rts-ai';
    this.endpoint = opts.endpoint ?? '/api/nanoclaw';
  }

  tick(view: GameView, _dt: number): readonly AICommand[] {
    const now = this.nowFn();
    if (!this.inFlight && now - this.lastRequestMs >= this.intervalMs) {
      // Set inFlight + lastRequestMs synchronously here, BEFORE the await chain
      // begins inside requestCommands. JS runs the function body up to the
      // first await synchronously, so this prevents the next tick from
      // re-entering while the request is in flight.
      this.lastRequestMs = now;
      void this.requestCommands(view);
    }
    const drained = this.buffer;
    this.buffer = [];
    return drained;
  }

  private async requestCommands(view: GameView): Promise<void> {
    this.inFlight = true;
    try {
      const r = await this.fetchFn(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupFolder: this.groupFolder,
          message: buildPrompt(view),
        }),
      });
      if (!r.ok) {
        console.warn(`[nanoclaw] HTTP ${r.status}`);
        return;
      }
      const data = (await r.json()) as NanoclawResponse;
      if (data.success === false) {
        console.warn('[nanoclaw] response.success=false', data.error);
        return;
      }
      const output = typeof data.output === 'string' ? data.output : '';
      if (output.length === 0) return;
      const cmds = parseCommands(output, view);
      if (cmds.length > 0) this.buffer.push(...cmds);
    } catch (err) {
      console.warn('[nanoclaw] request failed', err);
    } finally {
      this.inFlight = false;
    }
  }
}

function defaultFetch(): typeof fetch {
  if (typeof globalThis.fetch !== 'function') {
    // Surface a clear error at construction-time rather than a cryptic one
    // mid-game. Node 18+ and modern browsers ship fetch; tests inject mocks.
    throw new Error('NanoclawPlayer: globalThis.fetch unavailable; pass opts.fetchFn');
  }
  return globalThis.fetch.bind(globalThis);
}
