/// <reference types="vitest" />
import { resolve } from 'path';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { configDefaults } from 'vitest/config';

// Multi-page entry: game (/) and admin (/admin.html). Test env is jsdom for DOM-based admin tests.
// Worktree directory is excluded so vitest doesn't pick up parallel agent test trees.
export default defineConfig(({ mode }) => {
  // Vite does NOT auto-populate process.env from .env files for the config /
  // plugin layer — only VITE_ vars get inlined into client. We need NANOCLAW_URL
  // and NANOCLAW_TOKEN at request time inside the bridge plugin, so load them
  // explicitly here. Empty prefix '' = load all keys, not just VITE_*.
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [
      nanoclawBridgePlugin(env.NANOCLAW_URL, env.NANOCLAW_TOKEN),
      openclawBridgePlugin(env.OPENCLAW_URL, env.OPENCLAW_GATEWAY_TOKEN),
      aiBackendStarterPlugin(),
      mapsBridgePlugin(),
    ],
    server: {
      host: true,
      port: 5173,
      // HMR off — concurrent subagent edits otherwise reload the page mid-test
      // and trash the running game state (NanoclawPlayer warmup re-runs, world
      // resets). Manual F5 to pull in code changes.
      hmr: false,
    },
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          admin: resolve(__dirname, 'admin.html'),
          editor: resolve(__dirname, 'editor.html'),
        },
      },
    },
    test: {
      environment: 'jsdom',
      exclude: [...configDefaults.exclude, '.claude/worktrees/**'],
    },
  };
});

/**
 * Dev-only proxy that forwards browser-side requests to /api/nanoclaw onto the
 * Nanoclaw HTTP host. Token stays server-side so the client never sees it.
 * `apply: 'serve'` strips this from production builds — Phase 40-B is a dev /
 * demo feature, not a shipping API.
 */
function nanoclawBridgePlugin(url: string | undefined, token: string | undefined): Plugin {
  return {
    name: 'nanoclaw-bridge',
    apply: 'serve',
    configureServer(server) {
      // eslint-disable-next-line no-console
      console.info(
        `[nanoclaw-bridge] ${url ? `proxy → ${url}` : 'NANOCLAW_URL not set — /api/nanoclaw will 500'}`,
      );
      server.middlewares.use('/api/nanoclaw', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        if (!url) {
          res.statusCode = 500;
          return res.end(
            JSON.stringify({ success: false, error: 'NANOCLAW_URL not configured' }),
          );
        }
        readBody(req)
          .then(async (body) => {
            const headers: Record<string, string> = {
              'Content-Type': 'application/json',
            };
            if (token) headers['Authorization'] = `Bearer ${token}`;
            const upstream = await fetch(`${url}/api/agent-message`, {
              method: 'POST',
              headers,
              body,
            });
            const text = await upstream.text();
            res.statusCode = upstream.status;
            res.setHeader('Content-Type', 'application/json');
            res.end(text);
          })
          .catch((err: unknown) => {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({ success: false, error: String(err) }),
            );
          });
      });
    },
  };
}

/**
 * Phase 42: dev-only proxy that forwards browser-side requests to /api/openclaw
 * onto the OpenClaw gateway's OpenAI-compatible /v1/chat/completions endpoint.
 * Token stays server-side (no VITE_ prefix). `apply: 'serve'` strips this from
 * production builds.
 */
function openclawBridgePlugin(url: string | undefined, token: string | undefined): Plugin {
  return {
    name: 'openclaw-bridge',
    apply: 'serve',
    configureServer(server) {
      // eslint-disable-next-line no-console
      console.info(
        `[openclaw-bridge] ${url ? `proxy → ${url}` : 'OPENCLAW_URL not set — /api/openclaw will 500'}`,
      );
      server.middlewares.use('/api/openclaw', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        if (!url) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          return res.end(
            JSON.stringify({ error: { message: 'OPENCLAW_URL not configured' } }),
          );
        }
        readBody(req)
          .then(async (body) => {
            const headers: Record<string, string> = {
              'Content-Type': 'application/json',
            };
            if (token) headers['Authorization'] = `Bearer ${token}`;
            const upstream = await fetch(`${url}/v1/chat/completions`, {
              method: 'POST',
              headers,
              body,
            });
            const text = await upstream.text();
            res.statusCode = upstream.status;
            res.setHeader('Content-Type', 'application/json');
            res.end(text);
          })
          .catch((err: unknown) => {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({ error: { message: String(err) } }),
            );
          });
      });
    },
  };
}

/**
 * Phase 45: dev-only endpoint that spawns tools/start-{kind}.ps1 to bring up
 * the relevant AI backend on demand. The AI selector overlay POSTs here with
 * `{ kind: 'codex' | 'claude' }` and blocks on the response — by the time we
 * return 200, the script has verified chat-completions is live (codex) or the
 * Nanoclaw bridge is bound (claude). 'scripted' is handled client-side and
 * never reaches this endpoint. Windows-only (powershell.exe).
 */
function aiBackendStarterPlugin(): Plugin {
  return {
    name: 'ai-backend-starter',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      server.middlewares.use('/api/start-backend', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        readBody(req)
          .then((body) => {
            let kind: unknown;
            try {
              kind = (JSON.parse(body) as { kind?: unknown }).kind;
            } catch {
              respondJson(res, 400, { ok: false, message: 'invalid JSON body' });
              return;
            }
            const scriptName =
              kind === 'codex' ? 'start-codex.ps1' : kind === 'claude' ? 'start-claude.ps1' : null;
            if (!scriptName) {
              respondJson(res, 400, { ok: false, message: `unknown kind: ${String(kind)}` });
              return;
            }
            const scriptPath = resolve(root, 'tools', scriptName);
            // eslint-disable-next-line no-console
            console.info(`[ai-backend-starter] spawning ${scriptName} ...`);
            const ps = spawn(
              'powershell.exe',
              ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
              { windowsHide: true },
            );
            let buf = '';
            ps.stdout.on('data', (chunk: Buffer) => {
              buf += chunk.toString();
            });
            ps.stderr.on('data', (chunk: Buffer) => {
              buf += chunk.toString();
            });
            ps.on('error', (err: Error) => {
              // Spawn-level failure (e.g. powershell.exe not found on non-Windows).
              respondJson(res, 500, { ok: false, message: `spawn failed: ${err.message}` });
            });
            ps.on('close', (code) => {
              const ok = code === 0;
              // eslint-disable-next-line no-console
              console.info(`[ai-backend-starter] ${scriptName} exit=${code}`);
              respondJson(res, ok ? 200 : 500, { ok, message: buf.trim() });
            });
          })
          .catch((err: unknown) => {
            respondJson(res, 500, { ok: false, message: String(err) });
          });
      });
    },
  };
}

/**
 * Phase 53: dev-only endpoint pair backing the editor → game map workflow.
 *   GET  /api/maps          → list `public/maps/*.json` filenames (without .json)
 *   POST /api/maps/save     → write JSON body to `public/maps/<name>.json`
 *
 * The editor calls POST after the user clicks "Save to project"; the game's
 * AI-selector modal calls GET to populate its map dropdown. Maps live under
 * `public/` so they're already statically served at `/maps/<name>.json` for
 * the game to fetch+parse without going through this plugin again.
 *
 * Filename allowlist (`^[A-Za-z0-9_-]{1,64}$`) prevents path traversal — a dev
 * plugin runs with the dev box's permissions, so untrusted input must never
 * reach `path.join` directly.
 */
const MAP_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

function mapsBridgePlugin(): Plugin {
  return {
    name: 'rts2-maps-bridge',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      const mapsDir = resolve(root, 'public', 'maps');

      server.middlewares.use('/api/maps/save', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        readBody(req)
          .then(async (body) => {
            let parsed: unknown;
            try {
              parsed = JSON.parse(body);
            } catch {
              respondJson(res, 400, { ok: false, message: 'invalid JSON body' });
              return;
            }
            const obj = parsed as { name?: unknown; map?: unknown };
            if (typeof obj.name !== 'string' || !MAP_NAME_RE.test(obj.name)) {
              respondJson(res, 400, {
                ok: false,
                message: `invalid map name; allowed: ${MAP_NAME_RE.source}`,
              });
              return;
            }
            if (obj.map === undefined || obj.map === null) {
              respondJson(res, 400, { ok: false, message: 'missing "map" field' });
              return;
            }
            await fs.mkdir(mapsDir, { recursive: true });
            const target = resolve(mapsDir, `${obj.name}.json`);
            // Defense in depth: even with the regex, double-check the resolved
            // path stays inside mapsDir before writing.
            if (!target.startsWith(mapsDir)) {
              respondJson(res, 400, { ok: false, message: 'resolved path outside maps dir' });
              return;
            }
            const json = JSON.stringify(obj.map, null, 2);
            await fs.writeFile(target, json, 'utf8');
            // eslint-disable-next-line no-console
            console.info(`[rts2-maps] saved ${target} (${json.length} bytes)`);
            respondJson(res, 200, { ok: true, message: `saved ${obj.name}.json`, path: target });
          })
          .catch((err: unknown) => {
            // eslint-disable-next-line no-console
            console.error('[rts2-maps] save failed:', err);
            respondJson(res, 500, { ok: false, message: String(err) });
          });
      });

      server.middlewares.use('/api/maps', (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          return res.end();
        }
        // Filter: only the GET /api/maps root, not nested paths like /save.
        // Vite's middleware path matcher is prefix-based.
        if (req.url && req.url.split('?')[0] !== '/' && req.url.split('?')[0] !== '') {
          res.statusCode = 404;
          return res.end();
        }
        fs.readdir(mapsDir)
          .then((files) => {
            const names = files
              .filter((f) => f.endsWith('.json'))
              .map((f) => f.slice(0, -'.json'.length))
              .filter((n) => MAP_NAME_RE.test(n))
              .sort();
            respondJson(res, 200, { ok: true, maps: names });
          })
          .catch((err: NodeJS.ErrnoException) => {
            if (err.code === 'ENOENT') {
              respondJson(res, 200, { ok: true, maps: [] });
              return;
            }
            // eslint-disable-next-line no-console
            console.error('[rts2-maps] list failed:', err);
            respondJson(res, 500, { ok: false, message: String(err) });
          });
      });
    },
  };
}

function respondJson(
  res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (b: string) => void },
  status: number,
  body: unknown,
): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, rejectBody) => {
    let body = '';
    req.on('data', (chunk: Buffer | string) => {
      body += chunk.toString();
    });
    req.on('end', () => resolveBody(body));
    req.on('error', rejectBody);
  });
}

