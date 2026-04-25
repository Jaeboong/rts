export interface InputState {
  keys: Set<string>;
  mouse: { x: number; y: number };
  // For drag selection
  leftDown: boolean;
  leftDownAt: { x: number; y: number } | null;
  // One-shot events consumed by the game each frame
  clicks: ClickEvent[];
  rightClicks: RightClickEvent[];
  // Drag box committed on left-up
  dragCommit: DragCommitEvent | null;
}

export interface ClickEvent {
  x: number;
  y: number;
  shift: boolean;
}

export interface RightClickEvent {
  x: number;
  y: number;
  shift: boolean;
}

export interface DragCommitEvent {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  shift: boolean;
}

const DRAG_THRESHOLD_PX = 4;

export function createInput(canvas: HTMLCanvasElement): InputState {
  const state: InputState = {
    keys: new Set(),
    mouse: { x: 0, y: 0 },
    leftDown: false,
    leftDownAt: null,
    clicks: [],
    rightClicks: [],
    dragCommit: null,
  };

  window.addEventListener('keydown', (e) => {
    state.keys.add(e.key.toLowerCase());
  });
  window.addEventListener('keyup', (e) => {
    state.keys.delete(e.key.toLowerCase());
  });
  window.addEventListener('blur', () => state.keys.clear());

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    state.mouse.x = e.clientX - rect.left;
    state.mouse.y = e.clientY - rect.top;
  });

  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    state.mouse.x = x;
    state.mouse.y = y;
    if (e.button === 0) {
      state.leftDown = true;
      state.leftDownAt = { x, y };
    } else if (e.button === 2) {
      state.rightClicks.push({ x, y, shift: e.shiftKey });
    }
  });

  canvas.addEventListener('mouseup', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (e.button === 0 && state.leftDown && state.leftDownAt) {
      const dx = x - state.leftDownAt.x;
      const dy = y - state.leftDownAt.y;
      const dragged = Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX;
      if (dragged) {
        state.dragCommit = {
          x0: state.leftDownAt.x,
          y0: state.leftDownAt.y,
          x1: x,
          y1: y,
          shift: e.shiftKey,
        };
      } else {
        state.clicks.push({ x, y, shift: e.shiftKey });
      }
      state.leftDown = false;
      state.leftDownAt = null;
    }
  });

  canvas.addEventListener('mouseleave', () => {
    state.leftDown = false;
    state.leftDownAt = null;
  });

  return state;
}

export function consumeFrame(input: InputState): void {
  input.clicks.length = 0;
  input.rightClicks.length = 0;
  input.dragCommit = null;
}

export function activeDragBox(
  input: InputState,
): { x0: number; y0: number; x1: number; y1: number } | null {
  if (!input.leftDown || !input.leftDownAt) return null;
  const dx = input.mouse.x - input.leftDownAt.x;
  const dy = input.mouse.y - input.leftDownAt.y;
  if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return null;
  return {
    x0: input.leftDownAt.x,
    y0: input.leftDownAt.y,
    x1: input.mouse.x,
    y1: input.mouse.y,
  };
}
