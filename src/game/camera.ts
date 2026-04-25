import { WORLD_H, WORLD_W, type Vec2 } from '../types';

export interface Camera {
  x: number;
  y: number;
  viewW: number;
  viewH: number;
  panSpeed: number;
}

export function createCamera(): Camera {
  return { x: 0, y: 0, viewW: 800, viewH: 600, panSpeed: 600 };
}

export function setViewport(cam: Camera, w: number, h: number): void {
  cam.viewW = w;
  cam.viewH = h;
  clamp(cam);
}

export function panBy(cam: Camera, dx: number, dy: number): void {
  cam.x += dx;
  cam.y += dy;
  clamp(cam);
}

function clamp(cam: Camera): void {
  const maxX = Math.max(0, WORLD_W - cam.viewW);
  const maxY = Math.max(0, WORLD_H - cam.viewH);
  if (cam.x < 0) cam.x = 0;
  if (cam.y < 0) cam.y = 0;
  if (cam.x > maxX) cam.x = maxX;
  if (cam.y > maxY) cam.y = maxY;
}

export function screenToWorld(cam: Camera, sx: number, sy: number): Vec2 {
  return { x: sx + cam.x, y: sy + cam.y };
}

export function worldToScreen(cam: Camera, wx: number, wy: number): Vec2 {
  return { x: wx - cam.x, y: wy - cam.y };
}
