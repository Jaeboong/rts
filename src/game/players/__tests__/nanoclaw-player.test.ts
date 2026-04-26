import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NanoclawPlayer } from '../nanoclaw-player';
import type { GameView } from '../types';

function makeView(overrides: Partial<GameView> = {}): GameView {
  return {
    tick: 0,
    resources: { minerals: 500, gas: 0 },
    myEntities: [
      { id: 1, kind: 'worker', team: 'enemy', pos: { x: 0, y: 0 }, hp: 40, maxHp: 40 },
      { id: 2, kind: 'marine', team: 'enemy', pos: { x: 0, y: 0 }, hp: 60, maxHp: 60 },
    ],
    visibleEnemies: [
      { id: 99, kind: 'enemyDummy', team: 'player', pos: { x: 0, y: 0 }, hp: 100, maxHp: 100 },
    ],
    visibleResources: [],
    mapInfo: { w: 128, h: 128, cellPx: 16 },
    ...overrides,
  };
}

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function makeMockFetch(
  responder: (call: FetchCall) => Promise<Response>,
): { fn: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    return responder({ url, init });
  }) as typeof fetch;
  return { fn, calls };
}

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Drain pending microtasks so that fire-and-forget promise chains run.
function flushMicrotasks(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('NanoclawPlayer.tick — non-blocking', () => {
  it('returns synchronously without awaiting fetch', () => {
    let fetchResolved = false;
    const mock = makeMockFetch(
      () =>
        new Promise<Response>((resolve) => {
          // Never resolves during tick; tick must still return immediately.
          setTimeout(() => {
            fetchResolved = true;
            resolve(jsonResponse({ success: true, output: '[]' }));
          }, 50);
        }),
    );
    const p = new NanoclawPlayer('enemy', {
      intervalMs: 0,
      fetchFn: mock.fn,
      nowFn: () => 1000,
    });
    const result = p.tick(makeView(), 1 / 20);
    // tick returned during the open in-flight request.
    expect(result).toEqual([]);
    expect(fetchResolved).toBe(false);
    expect(mock.calls).toHaveLength(1);
  });
});

describe('NanoclawPlayer.tick — throttle', () => {
  it('does not fire a second request inside intervalMs', () => {
    let now = 0;
    const mock = makeMockFetch(async () =>
      jsonResponse({ success: true, output: '[]' }),
    );
    const p = new NanoclawPlayer('enemy', {
      intervalMs: 5000,
      fetchFn: mock.fn,
      nowFn: () => now,
    });
    p.tick(makeView(), 1 / 20);
    expect(mock.calls).toHaveLength(1);
    now = 1000;
    p.tick(makeView(), 1 / 20);
    p.tick(makeView(), 1 / 20);
    expect(mock.calls).toHaveLength(1);
    now = 4999;
    p.tick(makeView(), 1 / 20);
    expect(mock.calls).toHaveLength(1);
  });

  it('fires another request after intervalMs has elapsed and previous resolved', async () => {
    let now = 0;
    const mock = makeMockFetch(async () =>
      jsonResponse({ success: true, output: '[]' }),
    );
    const p = new NanoclawPlayer('enemy', {
      intervalMs: 5000,
      fetchFn: mock.fn,
      nowFn: () => now,
    });
    p.tick(makeView(), 1 / 20);
    await flushMicrotasks();
    now = 5000;
    p.tick(makeView(), 1 / 20);
    expect(mock.calls).toHaveLength(2);
  });

  it('inFlight guard suppresses overlapping requests even when intervalMs=0', () => {
    let now = 0;
    const mock = makeMockFetch(
      () => new Promise<Response>(() => { /* never resolves */ }),
    );
    const p = new NanoclawPlayer('enemy', {
      intervalMs: 0,
      fetchFn: mock.fn,
      nowFn: () => now,
    });
    p.tick(makeView(), 1 / 20);
    now = 100;
    p.tick(makeView(), 1 / 20);
    now = 1000;
    p.tick(makeView(), 1 / 20);
    expect(mock.calls).toHaveLength(1);
  });
});

describe('NanoclawPlayer.tick — buffer drain', () => {
  it('drains parsed commands on the tick after the response resolves', async () => {
    let now = 0;
    const mock = makeMockFetch(async () =>
      jsonResponse({
        success: true,
        output: '[{"type":"attack","unitIds":[2],"targetId":99}]',
      }),
    );
    const p = new NanoclawPlayer('enemy', {
      intervalMs: 5000,
      fetchFn: mock.fn,
      nowFn: () => now,
    });
    // First tick: kicks off the fetch, no commands yet.
    expect(p.tick(makeView(), 1 / 20)).toEqual([]);
    await flushMicrotasks();
    // Second tick (still within throttle window): drain only.
    const drained = p.tick(makeView(), 1 / 20);
    expect(drained).toEqual([
      { type: 'attack', unitIds: [2], targetId: 99 },
    ]);
    // Third tick: buffer is empty, throttle still holds, no second request.
    expect(p.tick(makeView(), 1 / 20)).toEqual([]);
    expect(mock.calls).toHaveLength(1);
  });
});

describe('NanoclawPlayer — failure modes (game must keep ticking)', () => {
  it('returns [] when fetch rejects', async () => {
    let now = 0;
    const mock = makeMockFetch(() => Promise.reject(new Error('econnrefused')));
    const p = new NanoclawPlayer('enemy', {
      intervalMs: 5000,
      fetchFn: mock.fn,
      nowFn: () => now,
    });
    p.tick(makeView(), 1 / 20);
    await flushMicrotasks();
    expect(p.tick(makeView(), 1 / 20)).toEqual([]);
  });

  it('returns [] when response status is 500', async () => {
    let now = 0;
    const mock = makeMockFetch(async () =>
      new Response('boom', { status: 500 }),
    );
    const p = new NanoclawPlayer('enemy', {
      intervalMs: 5000,
      fetchFn: mock.fn,
      nowFn: () => now,
    });
    p.tick(makeView(), 1 / 20);
    await flushMicrotasks();
    expect(p.tick(makeView(), 1 / 20)).toEqual([]);
  });

  it('returns [] when response.success is false', async () => {
    let now = 0;
    const mock = makeMockFetch(async () =>
      jsonResponse({ success: false, error: 'queue timeout' }),
    );
    const p = new NanoclawPlayer('enemy', {
      intervalMs: 5000,
      fetchFn: mock.fn,
      nowFn: () => now,
    });
    p.tick(makeView(), 1 / 20);
    await flushMicrotasks();
    expect(p.tick(makeView(), 1 / 20)).toEqual([]);
  });

  it('returns [] when output is junk that fails to parse', async () => {
    let now = 0;
    const mock = makeMockFetch(async () =>
      jsonResponse({ success: true, output: 'not json at all' }),
    );
    const p = new NanoclawPlayer('enemy', {
      intervalMs: 5000,
      fetchFn: mock.fn,
      nowFn: () => now,
    });
    p.tick(makeView(), 1 / 20);
    await flushMicrotasks();
    expect(p.tick(makeView(), 1 / 20)).toEqual([]);
  });

  it('survives stale entity IDs in response (parser drops them, no commands enter buffer)', async () => {
    let now = 0;
    const mock = makeMockFetch(async () =>
      jsonResponse({
        success: true,
        output: '[{"type":"attack","unitIds":[12345],"targetId":99}]',
      }),
    );
    const p = new NanoclawPlayer('enemy', {
      intervalMs: 5000,
      fetchFn: mock.fn,
      nowFn: () => now,
    });
    p.tick(makeView(), 1 / 20);
    await flushMicrotasks();
    expect(p.tick(makeView(), 1 / 20)).toEqual([]);
  });

  it('frees inFlight after a failure, allowing the next throttled window to retry', async () => {
    let now = 0;
    let reject = true;
    const mock = makeMockFetch(async () => {
      if (reject) throw new Error('down');
      return jsonResponse({ success: true, output: '[]' });
    });
    const p = new NanoclawPlayer('enemy', {
      intervalMs: 1000,
      fetchFn: mock.fn,
      nowFn: () => now,
    });
    p.tick(makeView(), 1 / 20);
    await flushMicrotasks();
    reject = false;
    now = 1000;
    p.tick(makeView(), 1 / 20);
    expect(mock.calls).toHaveLength(2);
  });
});

describe('NanoclawPlayer — request body', () => {
  it('POSTs to /api/nanoclaw with groupFolder and the prompt body', async () => {
    const mock = makeMockFetch(async () =>
      jsonResponse({ success: true, output: '[]' }),
    );
    const p = new NanoclawPlayer('enemy', {
      intervalMs: 0,
      fetchFn: mock.fn,
      nowFn: () => 0,
      groupFolder: 'rts-ai',
    });
    p.tick(makeView(), 1 / 20);
    expect(mock.calls).toHaveLength(1);
    const call = mock.calls[0];
    expect(call.url).toBe('/api/nanoclaw');
    expect(call.init?.method).toBe('POST');
    const bodyStr = call.init?.body;
    expect(typeof bodyStr).toBe('string');
    const body = JSON.parse(bodyStr as string) as { groupFolder: string; message: string };
    expect(body.groupFolder).toBe('rts-ai');
    expect(body.message).toContain('Tick: 0');
    expect(body.message).toContain('My units (2):');
    // Phase 40-C: prompt now includes synthesized state + build phase ctx.
    expect(body.message).toContain('--- Synthesized State ---');
    expect(body.message).toContain('--- Current Build Phase ---');
  });

  it('honors a custom endpoint and groupFolder', async () => {
    const mock = makeMockFetch(async () =>
      jsonResponse({ success: true, output: '[]' }),
    );
    const p = new NanoclawPlayer('enemy', {
      intervalMs: 0,
      fetchFn: mock.fn,
      nowFn: () => 0,
      endpoint: '/custom/path',
      groupFolder: 'other-group',
    });
    p.tick(makeView(), 1 / 20);
    expect(mock.calls[0].url).toBe('/custom/path');
    const body = JSON.parse(mock.calls[0].init?.body as string) as { groupFolder: string };
    expect(body.groupFolder).toBe('other-group');
  });
});

describe('NanoclawPlayer — decision history feedback (Phase 40-C)', () => {
  it('records a DecisionRecord when commands drained + onCommandResults fires', async () => {
    let now = 0;
    const mock = makeMockFetch(async () =>
      jsonResponse({
        success: true,
        output: '[{"type":"attack","unitIds":[2],"targetId":99}]',
      }),
    );
    const p = new NanoclawPlayer('enemy', {
      intervalMs: 5000,
      fetchFn: mock.fn,
      nowFn: () => now,
    });
    // First tick — fires fetch.
    p.tick(makeView(), 1 / 20);
    await flushMicrotasks();
    // Drain
    const drained = p.tick(makeView(), 1 / 20);
    expect(drained).toHaveLength(1);
    // Simulate runner feeding back outcomes.
    p.onCommandResults([{ cmd: drained[0], ok: true }]);
    const history = p.recentDecisions();
    expect(history).toHaveLength(1);
    expect(history[0].results[0].ok).toBe(true);
    expect(history[0].results[0].cmd.type).toBe('attack');
  });

  it('does not push a DecisionRecord on empty drain ticks', async () => {
    let now = 0;
    const mock = makeMockFetch(async () =>
      jsonResponse({ success: true, output: '[]' }),
    );
    const p = new NanoclawPlayer('enemy', {
      intervalMs: 5000,
      fetchFn: mock.fn,
      nowFn: () => now,
    });
    p.tick(makeView(), 1 / 20);
    await flushMicrotasks();
    p.tick(makeView(), 1 / 20); // drain []
    p.onCommandResults([]); // runner still calls
    expect(p.recentDecisions()).toHaveLength(0);
  });

  it('caps decision history at historyDepth', async () => {
    let now = 0;
    const mock = makeMockFetch(async () =>
      jsonResponse({
        success: true,
        output: '[{"type":"attack","unitIds":[2],"targetId":99}]',
      }),
    );
    const p = new NanoclawPlayer('enemy', {
      intervalMs: 100,
      fetchFn: mock.fn,
      nowFn: () => now,
      historyDepth: 3,
    });
    for (let i = 0; i < 7; i++) {
      p.tick(makeView(), 1 / 20);
      await flushMicrotasks();
      const drained = p.tick(makeView(), 1 / 20);
      p.onCommandResults(drained.map((cmd) => ({ cmd, ok: true })));
      // Advance past the throttle window so the next iteration fires a new request.
      now += 200;
    }
    expect(p.recentDecisions()).toHaveLength(3);
  });

  it('embeds decision history in the next prompt as feedback', async () => {
    let now = 0;
    const responses = [
      '[{"type":"attack","unitIds":[2],"targetId":99}]',
      '[]',
    ];
    let i = 0;
    const mock = makeMockFetch(async () =>
      jsonResponse({ success: true, output: responses[i++] ?? '[]' }),
    );
    const p = new NanoclawPlayer('enemy', {
      intervalMs: 1000,
      fetchFn: mock.fn,
      nowFn: () => now,
    });
    // Cycle 1: fetch fires at now=0 (sets lastRequestMs=0).
    p.tick(makeView(), 1 / 20);
    await flushMicrotasks();
    // Drain at now=0 — throttle still holds (now - lastRequestMs < 1000).
    const drained = p.tick(makeView(), 1 / 20);
    expect(mock.calls).toHaveLength(1); // sanity: no second fetch yet
    p.onCommandResults(drained.map((cmd) => ({ cmd, ok: false, reason: 'attack target 99 missing or dead' })));
    // Cycle 2: advance past throttle, next tick fires a new request whose prompt
    // MUST show decision history.
    now = 1500;
    p.tick(makeView({ tick: 100 }), 1 / 20);
    expect(mock.calls).toHaveLength(2);
    const body = JSON.parse(mock.calls[1].init?.body as string) as { message: string };
    expect(body.message).toContain('--- Your last 1 decisions ---');
    expect(body.message).toContain('attack target 99 missing or dead');
  });

  it('records the tick of the request that produced the cmds, not the tick they drained on', async () => {
    let now = 0;
    const mock = makeMockFetch(async () =>
      jsonResponse({
        success: true,
        output: '[{"type":"attack","unitIds":[2],"targetId":99}]',
      }),
    );
    const p = new NanoclawPlayer('enemy', {
      intervalMs: 5000,
      fetchFn: mock.fn,
      nowFn: () => now,
    });
    // Request fires at tick=42.
    p.tick(makeView({ tick: 42 }), 1 / 20);
    await flushMicrotasks();
    // Drain happens later at tick=50.
    const drained = p.tick(makeView({ tick: 50 }), 1 / 20);
    p.onCommandResults(drained.map((cmd) => ({ cmd, ok: true })));
    const history = p.recentDecisions();
    expect(history[0].tickAtRequest).toBe(42);
  });
});

describe('NanoclawPlayer — exposes summary + phase for inspector', () => {
  it('lastStateSummary returns null before first request', () => {
    const mock = makeMockFetch(async () => jsonResponse({ success: true, output: '[]' }));
    const p = new NanoclawPlayer('enemy', {
      intervalMs: 5000,
      fetchFn: mock.fn,
      nowFn: () => 0,
    });
    expect(p.lastStateSummary()).toBeNull();
    expect(p.lastBuildPhase()).toBeNull();
  });

  it('lastStateSummary populated after a request fires', async () => {
    const mock = makeMockFetch(async () => jsonResponse({ success: true, output: '[]' }));
    const p = new NanoclawPlayer('enemy', {
      intervalMs: 5000,
      fetchFn: mock.fn,
      nowFn: () => 0,
    });
    p.tick(makeView(), 1 / 20);
    expect(p.lastStateSummary()).not.toBeNull();
    expect(p.lastBuildPhase()).not.toBeNull();
  });
});
