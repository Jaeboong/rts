import type { TileKind } from '../game/map/types';
import {
  ENTITY_PALETTE,
  PRESET_OPTIONS,
  TILE_PALETTE,
  setSelectedEntity,
  type EditorState,
  type EditorTool,
  type PresetId,
  type SelectedEntity,
} from './editor-state';

export interface EditorPaletteCallbacks {
  onNewBlank(): void;
  onLoadPreset(presetId: PresetId): void;
  onLoadJson(file: File): Promise<void>;
  onDownloadJson(): void;
  // Phase 53: POST current state to /api/maps/save (vite dev plugin writes
  // public/maps/<state.name>.json). Resolves with the server's status text.
  onSaveToProject(): Promise<{ ok: boolean; message: string }>;
}

export interface EditorPaletteView {
  update(): void;
}

export function mountEditorPalette(
  root: HTMLElement,
  state: EditorState,
  callbacks: EditorPaletteCallbacks,
): EditorPaletteView {
  root.textContent = '';

  const title = document.createElement('h1');
  title.className = 'editor-title';
  title.textContent = 'Map Editor';
  root.append(title);

  const nameInput = document.createElement('input');
  nameInput.className = 'editor-input';
  nameInput.value = state.name;
  nameInput.addEventListener('input', () => {
    state.name = nameInput.value;
  });
  root.append(labeledBlock('Name', nameInput));

  const newButton = button('New blank', () => {
    callbacks.onNewBlank();
    view.update();
  });
  root.append(newButton);

  const presetSelect = document.createElement('select');
  presetSelect.className = 'editor-select';
  presetSelect.append(option('', 'Load preset'));
  for (const preset of PRESET_OPTIONS) presetSelect.append(option(preset.id, preset.label));
  presetSelect.addEventListener('change', () => {
    const presetId = readPresetId(presetSelect.value);
    if (!presetId) return;
    callbacks.onLoadPreset(presetId);
    presetSelect.value = '';
    view.update();
  });
  root.append(presetSelect);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.hidden = true;
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.item(0);
    if (file) {
      callbacks.onLoadJson(file)
        .then(() => view.update())
        .catch((error: unknown) => window.alert(String(error)));
    }
    fileInput.value = '';
  });
  root.append(fileInput);
  root.append(button('Load JSON...', () => fileInput.click()));

  const toolButtons = new Map<EditorTool, HTMLButtonElement>();
  const toolRow = document.createElement('div');
  toolRow.className = 'editor-row';
  for (const tool of toolValues()) {
    const toolButton = button(toolLabel(tool), () => {
      state.tool = tool;
      view.update();
    });
    toolButtons.set(tool, toolButton);
    toolRow.append(toolButton);
  }
  root.append(section('Tools', toolRow));

  const tileButtons = new Map<TileKind, HTMLButtonElement>();
  const tileStack = stack();
  for (const tile of TILE_PALETTE) {
    const tileButton = button('', () => {
      state.selectedTile = tile.kind;
      state.tool = 'paint';
      view.update();
    });
    tileButton.append(swatch(tile.swatch), document.createTextNode(tile.label));
    tileButtons.set(tile.kind, tileButton);
    tileStack.append(tileButton);
  }
  root.append(section('Tiles', tileStack));

  const entityButtons = new Map<string, HTMLButtonElement>();
  const entityStack = stack();
  for (const paletteEntity of ENTITY_PALETTE) {
    const entityButton = button(paletteEntity.label, () => {
      setSelectedEntity(state, paletteEntity.entity);
      state.tool = 'place';
      view.update();
    });
    entityButtons.set(entityKey(paletteEntity.entity), entityButton);
    entityStack.append(entityButton);
  }
  root.append(section('Entities', entityStack));

  const saveStack = stack();
  const saveStatus = document.createElement('div');
  saveStatus.className = 'editor-cell';
  saveStatus.style.minHeight = '1em';
  const saveProjectBtn = button('Save to project', () => {
    saveStatus.textContent = 'saving…';
    saveStatus.style.color = '#aaaaaa';
    callbacks
      .onSaveToProject()
      .then((r) => {
        saveStatus.textContent = r.message || (r.ok ? 'saved' : 'failed');
        saveStatus.style.color = r.ok ? '#7ed27e' : '#ff6060';
      })
      .catch((err: unknown) => {
        saveStatus.textContent = `error: ${String(err)}`;
        saveStatus.style.color = '#ff6060';
      });
  });
  saveStack.append(saveProjectBtn);
  saveStack.append(button('Download JSON', callbacks.onDownloadJson));
  saveStack.append(saveStatus);
  const cellText = document.createElement('div');
  cellText.className = 'editor-cell';
  saveStack.append(cellText);
  root.append(section('Save', saveStack));

  const view: EditorPaletteView = {
    update(): void {
      if (document.activeElement !== nameInput) nameInput.value = state.name;
      for (const [tool, toolButton] of toolButtons) {
        toolButton.dataset.active = String(state.tool === tool);
      }
      for (const [kind, tileButton] of tileButtons) {
        tileButton.dataset.active = String(state.selectedTile === kind);
      }
      const selectedKey = entityKey(state.selectedEntity);
      for (const [key, entityButton] of entityButtons) {
        entityButton.dataset.active = String(key === selectedKey);
      }
      cellText.textContent = state.hoverCell
        ? `Cell: (${state.hoverCell.cellX},${state.hoverCell.cellY})`
        : 'Cell: (-,-)';
    },
  };
  view.update();
  return view;
}

function section(label: string, child: HTMLElement): HTMLElement {
  const wrapper = document.createElement('section');
  wrapper.className = 'editor-section';
  const heading = document.createElement('span');
  heading.className = 'editor-label';
  heading.textContent = label;
  wrapper.append(heading, child);
  return wrapper;
}

function labeledBlock(label: string, child: HTMLElement): HTMLElement {
  const wrapper = document.createElement('label');
  wrapper.className = 'editor-section';
  const span = document.createElement('span');
  span.className = 'editor-label';
  span.textContent = label;
  wrapper.append(span, child);
  return wrapper;
}

function stack(): HTMLDivElement {
  const element = document.createElement('div');
  element.className = 'editor-stack';
  return element;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'editor-button';
  element.textContent = label;
  element.addEventListener('click', onClick);
  return element;
}

function option(value: string, label: string): HTMLOptionElement {
  const element = document.createElement('option');
  element.value = value;
  element.textContent = label;
  return element;
}

function swatch(color: string): HTMLSpanElement {
  const element = document.createElement('span');
  element.className = 'editor-swatch';
  element.style.backgroundColor = color;
  return element;
}

function toolValues(): readonly EditorTool[] {
  return ['paint', 'place', 'erase'];
}

function toolLabel(tool: EditorTool): string {
  switch (tool) {
    case 'paint':
      return 'Paint';
    case 'place':
      return 'Place';
    case 'erase':
      return 'Erase';
  }
}

function entityKey(entity: SelectedEntity): string {
  return `${entity.kind}:${entity.team ?? 'neutral'}`;
}

function readPresetId(value: string): PresetId | null {
  if (value === 'western-front' || value === 'expansion-front') return value;
  return null;
}
