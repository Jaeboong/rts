import { renderWorld } from '../render/renderer';
import { drawHUD, type HUDState } from '../render/ui';
import { createCamera, panBy, setViewport, type Camera } from './camera';
import {
  activeDragBox,
  consumeFrame,
  createInput,
  type InputState,
} from './input';
import type { World } from './world';

export interface Game {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  world: World;
  camera: Camera;
  input: InputState;
  hud: HUDState;
  onUpdate?: (game: Game, dt: number) => void;
  onTick?: (game: Game) => void;
}

export const TICK_HZ = 20;
export const TICK_MS = 1000 / TICK_HZ;
export const TICK_DT = 1 / TICK_HZ;
const MAX_CATCHUP_MS = 250;

export function createGame(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  world: World,
): Game {
  return {
    ctx,
    canvas,
    world,
    camera: createCamera(),
    input: createInput(canvas),
    hud: { fps: 0, tickCount: 0, buttons: [] },
  };
}

export function startGame(game: Game): void {
  let last = performance.now();
  let acc = 0;
  let frames = 0;
  let fpsAcc = 0;

  const frame = (now: number): void => {
    const dt = now - last;
    last = now;

    setViewport(game.camera, game.canvas.clientWidth, game.canvas.clientHeight);

    panCameraFromKeys(game, dt);
    if (game.onUpdate) game.onUpdate(game, dt);
    consumeFrame(game.input);

    acc += dt;
    if (acc > MAX_CATCHUP_MS) acc = MAX_CATCHUP_MS;
    while (acc >= TICK_MS) {
      if (game.onTick) game.onTick(game);
      acc -= TICK_MS;
      game.world.tickCount++;
    }

    fpsAcc += dt;
    frames++;
    if (fpsAcc >= 500) {
      game.hud.fps = Math.round((frames * 1000) / fpsAcc);
      frames = 0;
      fpsAcc = 0;
    }
    game.hud.tickCount = game.world.tickCount;

    render(game);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function panCameraFromKeys(game: Game, dt: number): void {
  const k = game.input.keys;
  let dx = 0;
  let dy = 0;
  if (k.has('arrowleft') || k.has('a')) dx -= 1;
  if (k.has('arrowright') || k.has('d')) dx += 1;
  if (k.has('arrowup') || k.has('w')) dy -= 1;
  if (k.has('arrowdown') || k.has('s')) dy += 1;
  if (dx === 0 && dy === 0) return;
  const len = Math.hypot(dx, dy);
  const speed = game.camera.panSpeed * (dt / 1000);
  panBy(game.camera, (dx / len) * speed, (dy / len) * speed);
}

function render(game: Game): void {
  const { ctx, world, camera, hud, input } = game;
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, camera.viewW, camera.viewH);
  const drag = activeDragBox(input);
  renderWorld(ctx, world, camera, drag);
  drawHUD(ctx, world, hud, camera.viewW, camera.viewH);
}
