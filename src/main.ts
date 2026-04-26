import { applyOverridesAtStartup } from './game/balance-overrides';
import { spawnBuilding, spawnUnit } from './game/entities';
import { applyMap, expansionFrontPreset, loadAutotileSheet } from './game/map';
import { panBy } from './game/camera';
import { createGame, startGame, type Game } from './game/loop';
import { runFrame } from './game/handler';
import { HumanPlayer } from './game/players/human-player';
import { NanoclawPlayer } from './game/players/nanoclaw-player';
import { NoOpPlayer } from './game/players/no-op-player';
import { OpenClawPlayer } from './game/players/openclaw-player';
import { ScriptedAI } from './game/players/scripted-ai';
import type { InspectableLLMPlayer, Player } from './game/players/types';
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
const { tiles, spawns } = expansionFrontPreset.generate(SEED);
applyMap(world, tiles, spawns);
// Expose for in-browser devtools probing — read-only inspection only.
(window as unknown as { __world?: World }).__world = world;

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

function centerCameraOnPlayerCC(g: Game, canvas: HTMLCanvasElement): void {
  const cc = findEntity(g.world, (e) => e.kind === 'commandCenter' && e.team === 'player');
  if (!cc) return;
  // Sync viewport to actual canvas dims first (resize() set canvas.width/height
  // in device px; camera holds CSS px, hence clientWidth/Height).
  g.camera.viewW = canvas.clientWidth;
  g.camera.viewH = canvas.clientHeight;
  g.camera.x = cc.pos.x - g.camera.viewW / 2;
  g.camera.y = cc.pos.y - g.camera.viewH / 2;
  // Clamp to world bounds — uses the same logic as panBy by passing zero delta.
  panBy(g.camera, 0, 0);
}

// Phase 42: runtime enemy AI selector.
// Four slots are pre-declared in a registry; the active one is held in
// `game.players[1]` and swapped in-place by `__swapEnemy(kind)` (HUD button or
// devtools). Lazy instantiation — only the initial default is constructed up
// front; clicking a button for the first time builds that player and warms it
// async (LLM kinds only). The discarded player's in-flight HTTP request just
// resolves into a buffer no one drains — JS GCs it.
//
// Phase 42-D: 'none' is the default startup state — NoOpPlayer sits in
// game.players[1] until the user clicks a HUD button. No enemy AI runs,
// no warmup fires. Three buttons render dim until selected.
type EnemyKind = 'none' | 'claude' | 'codex' | 'scripted';

interface EnemyRegistry {
  readonly factory: () => Player;
  player: Player | null;
}

function buildEnemyRegistry(world: World): Record<EnemyKind, EnemyRegistry> {
  return {
    none: { factory: () => new NoOpPlayer('enemy'), player: null },
    claude: { factory: () => new NanoclawPlayer('enemy'), player: null },
    codex: { factory: () => new OpenClawPlayer('enemy'), player: null },
    scripted: { factory: () => new ScriptedAI('enemy', world), player: null },
  };
}

function readDefaultEnemyKind(): EnemyKind {
  // VITE_USE_NANOCLAW=1 is the legacy switch — honor it for back-compat.
  if (import.meta.env.VITE_USE_NANOCLAW === '1') return 'claude';
  const raw = import.meta.env.VITE_DEFAULT_ENEMY;
  if (raw === 'claude' || raw === 'codex' || raw === 'scripted' || raw === 'none') {
    return raw;
  }
  return 'none';
}

function isLLMPlayer(p: Player): p is NanoclawPlayer | OpenClawPlayer {
  return p instanceof NanoclawPlayer || p instanceof OpenClawPlayer;
}

function setAiInspectHook(p: Player): void {
  // Only LLM players satisfy InspectableLLMPlayer. Non-LLM swaps null the hook
  // so the inspector panel renders its empty-state header.
  if (isLLMPlayer(p)) {
    (window as unknown as { __aiInspect?: InspectableLLMPlayer | null }).__aiInspect = p;
  } else {
    (window as unknown as { __aiInspect?: InspectableLLMPlayer | null }).__aiInspect = null;
  }
}

function setLoadingStatus(text: string): void {
  const el = document.getElementById('loading-status');
  if (el) el.textContent = text;
}
function hideLoading(): void {
  const el = document.getElementById('loading');
  if (el) el.remove();
}

function describeKind(k: EnemyKind): string {
  switch (k) {
    case 'none':
      return 'No enemy AI';
    case 'claude':
      return 'Claude (Nanoclaw)';
    case 'codex':
      return 'Codex (OpenClaw)';
    case 'scripted':
      return 'ScriptedAI Tier 3';
  }
}

// Phase 36 — load both unit/building sprites AND the 32 autotile slot PNGs.
// When loadAutotileSheet resolves, the renderer's autotile path activates; if
// either load fails the catch block aborts (no partial-asset start).
Promise.all([loadSprites(), loadAutotileSheet()])
  .then(async ([atlas, tileAtlas]) => {
    const registry = buildEnemyRegistry(world);
    const initialKind = readDefaultEnemyKind();
    const initialPlayer = registry[initialKind].factory();
    registry[initialKind].player = initialPlayer;
    let activeKind: EnemyKind = initialKind;
    setAiInspectHook(initialPlayer);

    const game = createGame(canvas, ctx, world, atlas, tileAtlas);
    game.players = [new HumanPlayer('player'), initialPlayer];
    game.onUpdate = (g, dt) => runFrame(g, dt);
    game.onTick = (g) => runTick(g);

    // Center camera on player's CommandCenter at startup. Default camera at
    // (0,0) shows the SW map corner — player's main is there at expansion-front
    // (~13,218) but we still want the CC dead-center, not at the screen edge.
    centerCameraOnPlayerCC(game, canvas);

    console.info(`[rts2] enemy player = ${describeKind(initialKind)} (initial)`);

    // The blocking warmup ONLY runs for the initial-default LLM player so
    // first-load doesn't ship a frozen enemy. Runtime swaps fire warmup async
    // (no await) so the user can keep playing while the new container spins.
    if (isLLMPlayer(initialPlayer)) {
      setLoadingStatus(
        `Pinging ${describeKind(initialKind)} with warmup. First container cold-start is the slow part — usually 30–90s.`,
      );
      const result = await initialPlayer.warmup();
      if (!result.ok) {
        setLoadingStatus(
          `AI warmup failed (${result.error ?? 'unknown'}) after ${Math.round(result.latencyMs)}ms — starting game anyway. Check the gateway service.`,
        );
        console.warn('[rts2] enemy warmup failed', result);
        await new Promise((r) => setTimeout(r, 1500));
      } else {
        console.info(
          `[rts2] enemy warmup ok in ${Math.round(result.latencyMs)}ms`,
        );
      }
    }

    // The runtime swap entry point — both the HUD button and devtools call this.
    // Returns a string so devtools shows a useful echo. Never throws on bad
    // input; the HUD button only sends valid kinds anyway.
    const swap = (kind: EnemyKind): string => {
      if (kind === activeKind) return `[rts2] already ${kind}`;
      const slot = registry[kind];
      if (slot.player === null) slot.player = slot.factory();
      const next = slot.player;
      activeKind = kind;
      game.players[1] = next;
      setAiInspectHook(next);
      console.info(`[rts2] enemy swapped → ${describeKind(kind)}`);
      // Async warmup for fresh LLM players. We fire-and-forget — the player's
      // tick loop will just see HTTP-not-ready until the warmup pings the
      // gateway awake, same as the cold-start path.
      if (isLLMPlayer(next) && typeof next.warmup === 'function') {
        void next.warmup().then((result) => {
          if (!result.ok) {
            console.warn(`[rts2] swap warmup ${kind} failed`, result);
          } else {
            console.info(
              `[rts2] swap warmup ${kind} ok in ${Math.round(result.latencyMs)}ms`,
            );
          }
        });
      }
      return `[rts2] enemy = ${describeKind(kind)}`;
    };

    const activeKindGetter = (): EnemyKind => activeKind;

    interface EnemyApi {
      __swapEnemy: (kind: EnemyKind) => string;
      __activeEnemyKind: () => EnemyKind;
    }
    const w = window as unknown as EnemyApi;
    w.__swapEnemy = swap;
    w.__activeEnemyKind = activeKindGetter;

    // The HUD draws three enemy-AI buttons; the UI layer can't import main.ts
    // to read activeKind (would create a cycle). Stash a getter on the game
    // object so loop.ts can mirror it onto HUDState before draw.
    game.activeEnemyKind = activeKindGetter;

    hideLoading();
    startGame(game);
  })
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[rts2] asset load failed:', msg);
    setLoadingStatus(`asset load failed: ${msg}`);
    throw err;
  });
