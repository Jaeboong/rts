import { setViewport } from '../game/camera';
import { loadSprites, type SpriteAtlas } from '../render/sprites';
import {
  applyEditorMap,
  downloadEditorState,
  loadEditorMapFile,
  saveEditorToProject,
} from './editor-io';
import { setupEditorInput } from './editor-input';
import { mountEditorPalette } from './editor-palette';
import { renderEditor } from './editor-render';
import { createEditorState, loadPresetIntoState, resetEditorState } from './editor-state';

const canvas = document.getElementById('editor-canvas');
const panel = document.getElementById('editor-panel');

if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('editor-canvas element is missing.');
}
if (!(panel instanceof HTMLElement)) {
  throw new Error('editor-panel element is missing.');
}

const editorCanvas = canvas;
const editorPanel = panel;
const ctx = editorCanvas.getContext('2d');
if (!ctx) throw new Error('2d canvas context is unavailable.');
const editorCtx = ctx;

const state = createEditorState();
let sprites: SpriteAtlas | null = null;
let lastFrameMs = performance.now();

const palette = mountEditorPalette(editorPanel, state, {
  onNewBlank(): void {
    resetEditorState(state);
  },
  onLoadPreset(presetId): void {
    loadPresetIntoState(state, presetId);
  },
  async onLoadJson(file): Promise<void> {
    applyEditorMap(state, await loadEditorMapFile(file));
  },
  onDownloadJson(): void {
    downloadEditorState(state);
  },
  async onSaveToProject(): Promise<{ ok: boolean; message: string }> {
    return saveEditorToProject(state);
  },
});

const input = setupEditorInput(editorCanvas, state, () => palette.update());

loadSprites()
  .then((atlas) => {
    sprites = atlas;
  })
  .catch((error: unknown) => {
    console.warn('Editor sprite load failed; using fallback shapes.', error);
  });

window.addEventListener('resize', resizeCanvas);
resizeCanvas();
requestAnimationFrame(frame);

function frame(nowMs: number): void {
  const dtSeconds = Math.min(0.05, (nowMs - lastFrameMs) / 1000);
  lastFrameMs = nowMs;
  resizeCanvas();
  input.update(dtSeconds);
  renderEditor(editorCtx, state, sprites);
  palette.update();
  requestAnimationFrame(frame);
}

function resizeCanvas(): void {
  const rect = editorCanvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const pixelWidth = Math.floor(width * dpr);
  const pixelHeight = Math.floor(height * dpr);
  if (editorCanvas.width !== pixelWidth) editorCanvas.width = pixelWidth;
  if (editorCanvas.height !== pixelHeight) editorCanvas.height = pixelHeight;
  setViewport(state.camera, width, height);
}
