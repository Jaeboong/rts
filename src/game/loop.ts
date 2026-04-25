import { renderWorld } from '../render/renderer';
import type { SpriteAtlas } from '../render/sprites';
import { drawHUD, isPointOverHud, type HUDState } from '../render/ui';
import { createCamera, panBy, screenToWorld, setViewport, type Camera } from './camera';
import {
  activeDragBox,
  consumeFrame,
  createInput,
  type InputState,
} from './input';
import type { TileAtlas } from './map/tiles';
import type { World } from './world';

export const EDGE_PAN_THRESHOLD_PX = 20;

export type SpeedFactor = 1 | 2 | 4;

export interface Game {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  world: World;
  camera: Camera;
  input: InputState;
  hud: HUDState;
  speedFactor: SpeedFactor;
  atlas: SpriteAtlas | null;
  tileAtlas: TileAtlas | null;
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
  atlas: SpriteAtlas | null = null,
  tileAtlas: TileAtlas | null = null,
): Game {
  return {
    ctx,
    canvas,
    world,
    camera: createCamera(),
    input: createInput(canvas),
    hud: { fps: 0, tickCount: 0, buttons: [] },
    speedFactor: 1,
    atlas,
    tileAtlas,
  };
}

// Pure scheduler advance: scaled-dt accumulator + catch-up cap.
// Returns ticks to run and the new accumulator. Extracted for unit testing.
export function advanceTickAccumulator(
  acc: number,
  dt: number,
  speedFactor: number,
  tickMs: number,
  maxCatchupMs: number,
): { ticks: number; acc: number } {
  let next = acc + dt * speedFactor;
  if (next > maxCatchupMs) next = maxCatchupMs;
  let ticks = 0;
  while (next >= tickMs) {
    ticks++;
    next -= tickMs;
  }
  return { ticks, acc: next };
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
    panCameraFromMouseEdge(game, dt);
    if (game.onUpdate) game.onUpdate(game, dt);
    consumeFrame(game.input);

    const advance = advanceTickAccumulator(
      acc,
      dt,
      game.speedFactor,
      TICK_MS,
      MAX_CATCHUP_MS,
    );
    acc = advance.acc;
    for (let t = 0; t < advance.ticks; t++) {
      if (game.onTick) game.onTick(game);
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
  if (k.has('arrowleft')) dx -= 1;
  if (k.has('arrowright')) dx += 1;
  if (k.has('arrowup')) dy -= 1;
  if (k.has('arrowdown')) dy += 1;
  if (dx === 0 && dy === 0) return;
  const len = Math.hypot(dx, dy);
  const speed = game.camera.panSpeed * (dt / 1000);
  panBy(game.camera, (dx / len) * speed, (dy / len) * speed);
}

export function computeEdgePanVector(
  mouseX: number,
  mouseY: number,
  canvasW: number,
  canvasH: number,
  threshold: number,
): { x: number; y: number } {
  if (mouseX < 0 || mouseX > canvasW || mouseY < 0 || mouseY > canvasH) {
    return { x: 0, y: 0 };
  }
  let x = 0;
  let y = 0;
  if (mouseX < threshold) x = -1;
  else if (mouseX > canvasW - threshold) x = 1;
  if (mouseY < threshold) y = -1;
  else if (mouseY > canvasH - threshold) y = 1;
  return { x, y };
}

function panCameraFromMouseEdge(game: Game, dt: number): void {
  const { input, camera } = game;
  if (!input.mouseInside) return;
  const w = camera.viewW;
  const h = camera.viewH;
  if (isPointOverHud(input.mouse.x, input.mouse.y, w, h)) return;
  const v = computeEdgePanVector(
    input.mouse.x,
    input.mouse.y,
    w,
    h,
    EDGE_PAN_THRESHOLD_PX,
  );
  if (v.x === 0 && v.y === 0) return;
  const len = Math.hypot(v.x, v.y);
  const speed = camera.panSpeed * (dt / 1000);
  panBy(camera, (v.x / len) * speed, (v.y / len) * speed);
}

function render(game: Game): void {
  const { ctx, world, camera, hud, input, canvas } = game;
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, camera.viewW, camera.viewH);
  const drag = activeDragBox(input);
  // Suppress preview when mouse is over the HUD so it doesn't peek behind buttons.
  const showPreview =
    input.mouseInside &&
    !isPointOverHud(input.mouse.x, input.mouse.y, camera.viewW, camera.viewH);
  const mouseWorld = showPreview
    ? screenToWorld(camera, input.mouse.x, input.mouse.y)
    : null;
  renderWorld(ctx, world, camera, drag, mouseWorld, game.atlas, game.tileAtlas);
  const mouseScreen = input.mouseInside ? input.mouse : null;
  drawHUD(ctx, world, hud, camera.viewW, camera.viewH, game.speedFactor, mouseScreen);
  const desiredCursor = world.attackMode ? 'crosshair' : 'default';
  if (canvas.style.cursor !== desiredCursor) canvas.style.cursor = desiredCursor;
}
