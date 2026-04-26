import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OpenClawPlayer } from '../openclaw-player';
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

function chatJson(content: string, init: { status?: number } = {}): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    {
      status: init.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

function flushMicrotasks(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('OpenClawPlayer.tick — non-blocking', () => {
  it('returns synchronously without awaiting fetch', () => {
    let fetchResolved = false;
    const mock = makeMockFetch(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => {
            fetchResolved = true;
            resolve(chatJson('[]'));
          }, 50);
        }),
    );
    const p = new OpenClawPlayer('enemy', {
      intervalMs: 0,
      fetchFn: mock.fn,
      nowFn: () => 1000,
    });
    const result = p.tick(makeView(), 1 / 20);
    expect(result).toEqual([]);
    expect(fetchResolved).toBe(false);
    expect(mock.calls).toHaveLength(1);
  });
});

describe('OpenClawPlayer.tick — throttle', () => {
  it('does not fire a second request inside intervalMs', () => {
    let now = 0;
    const mock = makeMockFetch(async () => chatJson('[]'));
    const p = new OpenClawPlayer('enemy', {
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

  it('inFlight guard suppresses overlapping requests even when intervalMs=0', () => {
    let now = 0;
    const mock = makeMockFetch(
      () => new Promise<Response>(() => { /* never resolves */ }),
    );
    const p = new OpenClawPlayer('enemy', {
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

describe('OpenClawPlayer.tick — buffer drain', () => {
  it('drains parsed commands on the tick after the response resolves', async () => {
    let now = 0;
    const mock = makeMockFetch(async () =>
      chatJson('[{"type":"attack","unitIds":[2],"targetId":99}]'),
    );
    const p = new OpenClawPlayer('enemy', {
      intervalMs: 5000,
      fetchFn: mock.fn,
      nowFn: () => now,
    });
    expect(p.tick(makeView(), 1 / 20)).toEqual([]);
    await flushMicrotasks();
    const drained = p.tick(makeView(), 1 / 20);
    expect(drained).toEqual([
      { type: 'attack', unitIds: [2], targetId: 99 },
    ]);
    expect(p.tick(makeView(), 1 / 20)).toEqual([]);
    expect(mock.calls).toHaveLength(1);
  });
});

describe('OpenClawPlayer — failure modes', () => {
  it('returns [] when fetch rejects', async () => {
    const mock = makeMockFetch(() => Promise.reject(new Error('econnrefused')));
    const p = new OpenClawPlayer('enemy', {
      intervalMs: 5000,
      fetchFn: mock.fn,
      nowFn: () => 0,
    });
    p.tick(makeView(), 1 / 20);
    await flushMicrotasks();
    expect(p.tick(makeView(), 1 / 20)).toEqual([]);
  });

  it('returns [] when response status is 500', async () => {
    const mock = makeMockFetch(async () => new Response('boom', { status: 500 }));
    const p = new OpenClawPlayer('enemy', {
      intervalMs: 5000,
      fetchFn: mock.fn,
      nowFn: () => 0,
    });
    p.tick(makeView(), 1 / 20);
    await flushMicrotasks();
    expect(p.tick(makeView(), 1 / 20)).toEqual([]);
  });

  it('returns [] when response carries an OpenAI-style error envelope', async () => {
    const mock = makeMockFetch(
      async () =>
        new Response(
          JSON.stringify({ error: { message: 'rate_limit' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    const p = new OpenClawPlayer('enemy', {
      intervalMs: 5000,
      fetchFn: mock.fn,
      nowFn: () => 0,
    });
    p.tick(makeView(), 1 / 20);
    await flushMicrotasks();
    expect(p.tick(makeView(), 1 / 20)).toEqual([]);
  });

  it('returns [] when message.content is junk that fails to parse', async () => {
    const mock = makeMockFetch(async () => chatJson('not json at all'));
    const p = new OpenClawPlayer('enemy', {
      intervalMs: 5000,
      fetchFn: mock.fn,
      nowFn: () => 0,
    });
    p.tick(makeView(), 1 / 20);
    await flushMicrotasks();
    expect(p.tick(makeView(), 1 / 20)).toEqual([]);
  });

  it('survives stale entity IDs (parser drops them, no commands enter buffer)', async () => {
    const mock = makeMockFetch(async () =>
      chatJson('[{"type":"attack","unitIds":[12345],"targetId":99}]'),
    );
    const p = new OpenClawPlayer('enemy', {
      intervalMs: 5000,
      fetchFn: mock.fn,
      nowFn: () => 0,
    });
    p.tick(makeView(), 1 / 20);
    await flushMicrotasks();
    expect(p.tick(makeView(), 1 / 20)).toEqual([]);
  });
});

describe('OpenClawPlayer — request body shape', () => {
  it('POSTs to /api/openclaw with the OpenAI Chat Completions wire format', async () => {
    const mock = makeMockFetch(async () => chatJson('[]'));
    const p = new OpenClawPlayer('enemy', {
      intervalMs: 0,
      fetchFn: mock.fn,
      nowFn: () => 0,
      model: 'openclaw/default',
    });
    p.tick(makeView(), 1 / 20);
    expect(mock.calls).toHaveLength(1);
    const call = mock.calls[0];
    expect(call.url).toBe('/api/openclaw');
    expect(call.init?.method).toBe('POST');
    const body = JSON.parse(call.init?.body as string) as {
      model: string;
      messages: ReadonlyArray<{ role: string; content: string }>;
      stream: boolean;
      timeoutMs: number;
    };
    expect(body.model).toBe('openclaw/default');
    expect(body.stream).toBe(false);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[0].content).toContain('Tick: 0');
    expect(body.messages[0].content).toContain('My units (2):');
    expect(body.messages[0].content).toContain('--- Synthesized State ---');
    expect(body.messages[0].content).toContain('--- Current Build Phase ---');
    // Codex cold-start can hit ~80s; budget MUST be >= the call ceiling.
    expect(body.timeoutMs).toBeGreaterThanOrEqual(120000);
  });

  it('honors a custom endpoint and model', async () => {
    const mock = makeMockFetch(async () => chatJson('[]'));
    const p = new OpenClawPlayer('enemy', {
      intervalMs: 0,
      fetchFn: mock.fn,
      nowFn: () => 0,
      endpoint: '/custom/path',
      model: 'openai-codex/gpt-5.5',
    });
    p.tick(makeView(), 1 / 20);
    expect(mock.calls[0].url).toBe('/custom/path');
    const body = JSON.parse(mock.calls[0].init?.body as string) as { model: string };
    expect(body.model).toBe('openai-codex/gpt-5.5');
  });
});

describe('OpenClawPlayer — decision history feedback', () => {
  it('records a DecisionRecord pairing dispatched cmds with results', async () => {
    let now = 0;
    const mock = makeMockFetch(async () =>
      chatJson('[{"type":"attack","unitIds":[2],"targetId":99}]'),
    );
    const p = new OpenClawPlayer('enemy', {
      intervalMs: 5000,
      fetchFn: mock.fn,
      nowFn: () => now,
    });
    p.tick(makeView({ tick: 42 }), 1 / 20);
    await flushMicrotasks();
    const drained = p.tick(makeView({ tick: 50 }), 1 / 20);
    p.onCommandResults(drained.map((cmd) => ({ cmd, ok: true })));
    const history = p.recentDecisions();
    expect(history).toHaveLength(1);
    expect(history[0].results[0].ok).toBe(true);
    expect(history[0].results[0].cmd.type).toBe('attack');
    // Tick recorded must be the request tick, not the drain tick.
    expect(history[0].tickAtRequest).toBe(42);
  });
});

describe('OpenClawPlayer — warming flag', () => {
  it('isWarming() flips true during warmup() and back to false on resolve', async () => {
    let resolveFetch: (() => void) | null = null;
    const mock = makeMockFetch(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = () => resolve(chatJson('[]'));
        }),
    );
    const p = new OpenClawPlayer('enemy', {
      intervalMs: 5000,
      fetchFn: mock.fn,
      nowFn: () => 0,
    });
    expect(p.isWarming()).toBe(false);
    const warmupPromise = p.warmup();
    expect(p.isWarming()).toBe(true);
    if (resolveFetch) (resolveFetch as () => void)();
    await warmupPromise;
    expect(p.isWarming()).toBe(false);
  });
});

describe('OpenClawPlayer — inspector accessors', () => {
  it('lastStateSummary / lastBuildPhase return null before first request', () => {
    const mock = makeMockFetch(async () => chatJson('[]'));
    const p = new OpenClawPlayer('enemy', {
      intervalMs: 5000,
      fetchFn: mock.fn,
      nowFn: () => 0,
    });
    expect(p.lastStateSummary()).toBeNull();
    expect(p.lastBuildPhase()).toBeNull();
  });

  it('populated after first tick fires', async () => {
    const mock = makeMockFetch(async () => chatJson('[]'));
    const p = new OpenClawPlayer('enemy', {
      intervalMs: 5000,
      fetchFn: mock.fn,
      nowFn: () => 0,
    });
    p.tick(makeView(), 1 / 20);
    expect(p.lastStateSummary()).not.toBeNull();
    expect(p.lastBuildPhase()).not.toBeNull();
  });
});
