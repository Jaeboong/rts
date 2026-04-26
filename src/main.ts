import { applyOverridesAtStartup } from './game/balance-overrides';
import { spawnBuilding, spawnUnit } from './game/entities';
import { applyMap, loadAutotileSheet, westernFrontPreset } from './game/map';
import { createGame, startGame } from './game/loop';
import { runFrame } from './game/handler';
import { HumanPlayer } from './game/players/human-player';
import { ScriptedAI } from './game/players/scripted-ai';
import { runTick } from './game/simulate';
import { cellToPx, createWorld, type World } from './game/world';
import { loadSprites } from './render/sprites';
import type { Entity } from './types';

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

// Phase 38/39 — temporary enemy starter infra (workers + supplyDepot on a nearby
// mineralNode) so ScriptedAI has something to gather. Preset currently spawns
// only enemyDummy units for enemy mains; richer seeding belongs in the preset
// (or a separate fixture) in a future phase.
//
// Phase 39: enemy starts with 250 minerals so the Tier-3 build order can
// reach Barracks within the 60s budget — at 0 minerals + 2 workers (~1
// mineral/sec each on a fresh node) the 150-mineral Barracks gate alone takes
// 75s before the 20s build, blowing the 60s checklist target.
seedEnemyTier1Infra(world);
world.resources.enemy = 250;

function seedEnemyTier1Infra(w: World): void {
  const enemyCC = findEntity(w, (e) => e.kind === 'commandCenter' && e.team === 'enemy');
  if (!enemyCC || enemyCC.cellX === undefined || enemyCC.cellY === undefined) return;
  const ccCx = enemyCC.cellX + (enemyCC.sizeW ?? 15) / 2;
  const ccCy = enemyCC.cellY + (enemyCC.sizeH ?? 15) / 2;
  // Pick the nearest neutral, unclaimed mineralNode and stamp a fully-built supplyDepot on it.
  let bestNode: Entity | null = null;
  let bestD2 = Infinity;
  for (const e of w.entities.values()) {
    if (e.kind !== 'mineralNode') continue;
    if (e.depotId !== null && e.depotId !== undefined) continue;
    if (e.cellX === undefined || e.cellY === undefined) continue;
    const dx = (e.cellX + 2) - ccCx;
    const dy = (e.cellY + 2) - ccCy;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestNode = e;
      bestD2 = d2;
    }
  }
  if (bestNode && bestNode.cellX !== undefined && bestNode.cellY !== undefined) {
    const depot = spawnBuilding(w, 'supplyDepot', 'enemy', bestNode.cellX, bestNode.cellY);
    bestNode.depotId = depot.id;
    depot.mineralNodeId = bestNode.id;
  }
  // Spawn 4 enemy workers next to the CC (parity with player's 4 starting
  // workers; SE corner offset keeps them clear of the footprint).
  const sizeW = enemyCC.sizeW ?? 15;
  const sizeH = enemyCC.sizeH ?? 15;
  for (let i = 0; i < 4; i++) {
    spawnUnit(
      w,
      'worker',
      'enemy',
      cellToPx(enemyCC.cellX + sizeW + (i % 2), enemyCC.cellY + sizeH + Math.floor(i / 2)),
    );
  }
}

function findEntity(w: World, pred: (e: Entity) => boolean): Entity | null {
  for (const e of w.entities.values()) if (pred(e)) return e;
  return null;
}

// Phase 36 — load both unit/building sprites AND the 32 autotile slot PNGs.
// When loadAutotileSheet resolves, the renderer's autotile path activates; if
// either load fails the catch block aborts (no partial-asset start).
Promise.all([loadSprites(), loadAutotileSheet()])
  .then(([atlas, tileAtlas]) => {
    const game = createGame(canvas, ctx, world, atlas, tileAtlas);
    game.players = [
      new HumanPlayer('player'),
      new ScriptedAI('enemy', world),
    ];
    game.onUpdate = (g, dt) => runFrame(g, dt);
    game.onTick = (g) => runTick(g);
    startGame(game);
  })
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[rts2] asset load failed:', msg);
    throw err;
  });
