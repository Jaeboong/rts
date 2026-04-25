/// <reference types="vitest" />
import { resolve } from 'path';
import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';

// Multi-page entry: game (/) and admin (/admin.html). Test env is jsdom for DOM-based admin tests.
// Worktree directory is excluded so vitest doesn't pick up parallel agent test trees.
export default defineConfig({
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
