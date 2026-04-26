/// <reference types="vitest" />
import { resolve } from 'path';
import type { IncomingMessage } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import { configDefaults } from 'vitest/config';

// Multi-page entry: game (/) and admin (/admin.html). Test env is jsdom for DOM-based admin tests.
// Worktree directory is excluded so vitest doesn't pick up parallel agent test trees.
export default defineConfig({
  plugins: [nanoclawBridgePlugin()],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
    },
  },
  test: {
    environment: 'jsdom',
    exclude: [...configDefaults.exclude, '.claude/worktrees/**'],
  },
});

/**
 * Dev-only proxy that forwards browser-side requests to /api/nanoclaw onto the
 * Nanoclaw HTTP host. Token stays server-side so the client never sees it.
 * `apply: 'serve'` strips this from production builds — Phase 40-B is a dev /
 * demo feature, not a shipping API.
 */
function nanoclawBridgePlugin(): Plugin {
  return {
    name: 'nanoclaw-bridge',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/nanoclaw', (req, res) => {
        // Resolve env at request time so .env edits don't require a server restart.
        const url = process.env.NANOCLAW_URL;
        const token = process.env.NANOCLAW_TOKEN;
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

