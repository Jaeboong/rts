import { applyOverridesAtStartup } from './game/balance-overrides';
import { applyMap, loadAutotileSheet, westernFrontPreset } from './game/map';
import { createGame, startGame } from './game/loop';
import { runFrame } from './game/handler';
import { runTick } from './game/simulate';
import { createWorld } from './game/world';
import { loadSprites } from './render/sprites';

// Mutates UNIT_DEFS / BUILDING_DEFS / UNIT_PRODUCTION before any spawn — must run before world build.
applyOverridesAtStartup();

const SEED = 42;

const canvas = document.getElementById('game') as HTMLCanvasElement | null;
if (!canvas) throw new Error('canvas#game not found');
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('2D context not available');

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas!.clientWidth;
  const h = canvas!.clientHeight;
  canvas!.width = Math.max(1, Math.floor(w * dpr));
  canvas!.height = Math.max(1, Math.floor(h * dpr));
  ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

const world = createWorld();
const { tiles, spawns } = westernFrontPreset.generate(SEED);
applyMap(world, tiles, spawns);

// Phase 36 — load both unit/building sprites AND the 32 autotile slot PNGs.
// When loadAutotileSheet resolves, the renderer's autotile path activates; if
// either load fails the catch block aborts (no partial-asset start).
Promise.all([loadSprites(), loadAutotileSheet()])
  .then(([atlas, tileAtlas]) => {
    const game = createGame(canvas, ctx, world, atlas, tileAtlas);
    game.onUpdate = (g, dt) => runFrame(g, dt);
    game.onTick = (g) => runTick(g);
    startGame(game);
  })
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[rts2] asset load failed:', msg);
    throw err;
  });
