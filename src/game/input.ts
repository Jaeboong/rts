export interface InputState {
  keys: Set<string>;
  mouse: { x: number; y: number };
  mouseInside: boolean;
  // For drag selection
  leftDown: boolean;
  leftDownAt: { x: number; y: number } | null;
  // One-shot events consumed by the game each frame
  clicks: ClickEvent[];
  rightClicks: RightClickEvent[];
  keyDownEdges: Set<string>;
  // Drag box committed on left-up
  dragCommit: DragCommitEvent | null;
  // Double-click state. Persists ACROSS frames (consumeFrame does not reset).
  // The handler stamps these after each click so the next click can compare.
  // Using `number | null` would force null-checks at every comparison; 0 is a
  // safe sentinel because performance.now() is strictly positive.
  lastClickTime: number;
  lastClickedEntityId: number | null;
}

export interface ClickEvent {
  x: number;
  y: number;
  shift: boolean;
  ctrl: boolean;
  // Timestamp (performance.now() in production). Stamped at event creation so
  // the handler can detect double-click without re-reading the clock — also
  // lets tests fake time deterministically.
  time: number;
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
    mouseInside: false,
    leftDown: false,
    leftDownAt: null,
    clicks: [],
    rightClicks: [],
    keyDownEdges: new Set(),
    dragCommit: null,
    lastClickTime: 0,
    lastClickedEntityId: null,
  };

  window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    // F10 is the OS menu-bar focus key in most browsers/Windows; preventDefault
    // here keeps the press inside the canvas so our pause toggle sees it.
    if (key === 'f10') e.preventDefault();
    if (!state.keys.has(key)) state.keyDownEdges.add(key);
    state.keys.add(key);
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
    state.mouseInside = true;
  });

  canvas.addEventListener('mouseenter', () => {
    state.mouseInside = true;
  });

  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    state.mouse.x = x;
    state.mouse.y = y;
    state.mouseInside = true;
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
        state.clicks.push({
          x,
          y,
          shift: e.shiftKey,
          ctrl: e.ctrlKey,
          time: performance.now(),
        });
      }
      state.leftDown = false;
      state.leftDownAt = null;
    }
  });

  canvas.addEventListener('mouseleave', () => {
    state.leftDown = false;
    state.leftDownAt = null;
    state.mouseInside = false;
  });

  return state;
}

export function consumeFrame(input: InputState): void {
  input.clicks.length = 0;
  input.rightClicks.length = 0;
  input.keyDownEdges.clear();
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
