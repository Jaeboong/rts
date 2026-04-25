import { spawnBuilding, spawnMineralNode, spawnUnit } from './game/entities';
import { createGame, startGame } from './game/loop';
import { runFrame } from './game/handler';
import { runTick } from './game/simulate';
import { cellToPx, createWorld, type World } from './game/world';

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
buildInitialScene(world);

const game = createGame(canvas, ctx, world);
game.onUpdate = (g, dt) => runFrame(g, dt);
game.onTick = (g) => runTick(g);
startGame(game);

function buildInitialScene(w: World): void {
  spawnBuilding(w, 'commandCenter', 'player', 10, 10);

  spawnUnit(w, 'worker', 'player', cellToPx(15, 12));
  spawnUnit(w, 'worker', 'player', cellToPx(15, 13));
  spawnUnit(w, 'marine', 'player', cellToPx(16, 14));

  spawnMineralNode(w, 18, 8);
  spawnMineralNode(w, 19, 8);
  spawnMineralNode(w, 18, 9);
  spawnMineralNode(w, 19, 9);

  spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(50, 50));
  spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(51, 51));
}
