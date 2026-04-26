import { CELL } from '../types';
import { panBy, screenToWorld } from '../game/camera';
import {
  eraseAtCell,
  isInBounds,
  paintTile,
  placeSelectedEntity,
  type EditorState,
  type HoverCell,
} from './editor-state';

export interface EditorInputController {
  update(dtSeconds: number): void;
  dispose(): void;
}

export function setupEditorInput(
  canvas: HTMLCanvasElement,
  state: EditorState,
  onChange: () => void,
): EditorInputController {
  const keys = new Set<string>();
  let draggingPaint = false;
  let draggingErase = false;

  function updateHover(event: PointerEvent): HoverCell | null {
    const cell = eventToCell(canvas, state, event);
    state.hoverCell = cell;
    onChange();
    return cell;
  }

  function applyPrimary(cell: HoverCell): void {
    if (state.tool === 'paint') {
      paintTile(state, cell.cellX, cell.cellY);
      onChange();
      return;
    }
    if (state.tool === 'place') {
      placeSelectedEntity(state, cell.cellX, cell.cellY);
      onChange();
      return;
    }
    eraseAtCell(state, cell.cellX, cell.cellY);
    onChange();
  }

  function applyErase(cell: HoverCell): void {
    eraseAtCell(state, cell.cellX, cell.cellY);
    onChange();
  }

  function onPointerDown(event: PointerEvent): void {
    const cell = updateHover(event);
    if (!cell) return;
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
    if (event.button === 2) {
      draggingErase = true;
      applyErase(cell);
      return;
    }
    draggingPaint = state.tool === 'paint';
    draggingErase = state.tool === 'erase';
    applyPrimary(cell);
  }

  function onPointerMove(event: PointerEvent): void {
    const cell = updateHover(event);
    if (!cell) return;
    if (draggingPaint) {
      paintTile(state, cell.cellX, cell.cellY);
      onChange();
    } else if (draggingErase) {
      applyErase(cell);
    }
  }

  function onPointerUp(event: PointerEvent): void {
    draggingPaint = false;
    draggingErase = false;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  }

  function onPointerLeave(): void {
    state.hoverCell = null;
    onChange();
  }

  function onContextMenu(event: MouseEvent): void {
    event.preventDefault();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (isTypingTarget(event.target)) return;
    keys.add(event.key.toLowerCase());
  }

  function onKeyUp(event: KeyboardEvent): void {
    keys.delete(event.key.toLowerCase());
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  return {
    update(dtSeconds: number): void {
      const dx = axis(keys, 'arrowleft', 'a', 'arrowright', 'd');
      const dy = axis(keys, 'arrowup', 'w', 'arrowdown', 's');
      if (dx !== 0 || dy !== 0) {
        panBy(state.camera, dx * state.camera.panSpeed * dtSeconds, dy * state.camera.panSpeed * dtSeconds);
      }
    },
    dispose(): void {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    },
  };
}

function eventToCell(
  canvas: HTMLCanvasElement,
  state: EditorState,
  event: PointerEvent,
): HoverCell | null {
  const rect = canvas.getBoundingClientRect();
  const sx = event.clientX - rect.left;
  const sy = event.clientY - rect.top;
  if (sx < 0 || sy < 0 || sx >= rect.width || sy >= rect.height) return null;
  const world = screenToWorld(state.camera, sx, sy);
  const cellX = Math.floor(world.x / CELL);
  const cellY = Math.floor(world.y / CELL);
  if (!isInBounds(cellX, cellY)) return null;
  return { cellX, cellY };
}

function axis(keys: ReadonlySet<string>, lowArrow: string, lowWasd: string, highArrow: string, highWasd: string): number {
  let value = 0;
  if (keys.has(lowArrow) || keys.has(lowWasd)) value -= 1;
  if (keys.has(highArrow) || keys.has(highWasd)) value += 1;
  return value;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}
