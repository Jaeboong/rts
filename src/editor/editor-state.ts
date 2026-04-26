import { CELL, GRID_H, GRID_W, type EntityKind, type Team } from '../types';
import { createCamera, type Camera } from '../game/camera';
import { expansionFrontPreset } from '../game/map/presets/expansion-front';
import { westernFrontPreset } from '../game/map/presets/western-front';
import type { MapPreset, SpawnSpec, TileKind } from '../game/map/types';

export const DEFAULT_TILE: TileKind = 'grass-1';
export const DEFAULT_MINERAL_REMAINING = 1500;

export type EditorTool = 'paint' | 'place' | 'erase';
export type PlaceableEntityKind = 'mineralNode' | 'gasGeyser' | 'commandCenter' | 'supplyDepot';
export type EditorEntityKind = EntityKind;
export type PresetId = 'western-front' | 'expansion-front';

export interface EditorEntity {
  kind: EditorEntityKind;
  team?: Team;
  cellX: number;
  cellY: number;
  remaining?: number;
}

export interface SelectedEntity {
  kind: PlaceableEntityKind;
  team?: Team;
}

export interface HoverCell {
  cellX: number;
  cellY: number;
}

export interface EditorState {
  name: string;
  tool: EditorTool;
  selectedTile: TileKind;
  selectedEntity: SelectedEntity;
  camera: Camera;
  tiles: TileKind[];
  entities: EditorEntity[];
  hoverCell: HoverCell | null;
}

export interface TilePaletteItem {
  label: string;
  kind: TileKind;
  swatch: string;
}

export interface EntityPaletteItem {
  label: string;
  entity: SelectedEntity;
}

export interface PresetOption {
  id: PresetId;
  label: string;
}

export interface EntityFootprint {
  cellX: number;
  cellY: number;
  w: number;
  h: number;
}

export const TILE_PALETTE: readonly TilePaletteItem[] = [
  { label: 'grass-1', kind: 'grass-1', swatch: '#3d6e2e' },
  { label: 'wall-stone', kind: 'wall-1', swatch: '#6b665a' },
  { label: 'water', kind: 'water-1', swatch: '#2e5a78' },
  { label: 'road-dirt', kind: 'dirt-1', swatch: '#7a5e3a' },
];

export const ENTITY_PALETTE: readonly EntityPaletteItem[] = [
  { label: 'mineralNode', entity: { kind: 'mineralNode' } },
  { label: 'gasGeyser', entity: { kind: 'gasGeyser' } },
  { label: 'CC (player)', entity: { kind: 'commandCenter', team: 'player' } },
  { label: 'CC (enemy)', entity: { kind: 'commandCenter', team: 'enemy' } },
  { label: 'supplyDepot', entity: { kind: 'supplyDepot', team: 'player' } },
];

export const PRESET_OPTIONS: readonly PresetOption[] = [
  { id: 'western-front', label: 'western-front' },
  { id: 'expansion-front', label: 'expansion-front' },
];

export const EDITOR_ENTITY_KINDS: readonly EditorEntityKind[] = [
  'worker',
  'marine',
  'tank',
  'tank-light',
  'medic',
  'enemyDummy',
  'commandCenter',
  'barracks',
  'turret',
  'refinery',
  'factory',
  'supplyDepot',
  'mineralNode',
  'gasGeyser',
];

export function createBlankTiles(): TileKind[] {
  const tiles: TileKind[] = [];
  for (let i = 0; i < GRID_W * GRID_H; i++) tiles.push(DEFAULT_TILE);
  return tiles;
}

export function createEditorState(): EditorState {
  return {
    name: 'untitled',
    tool: 'paint',
    selectedTile: DEFAULT_TILE,
    selectedEntity: { kind: 'mineralNode' },
    camera: createCamera(),
    tiles: createBlankTiles(),
    entities: [],
    hoverCell: null,
  };
}

export function resetEditorState(state: EditorState): void {
  state.name = 'untitled';
  state.tool = 'paint';
  state.selectedTile = DEFAULT_TILE;
  state.selectedEntity = { kind: 'mineralNode' };
  state.tiles = createBlankTiles();
  state.entities = [];
  state.hoverCell = null;
  state.camera.x = 0;
  state.camera.y = 0;
}

export function cellIndex(cellX: number, cellY: number): number {
  return cellY * GRID_W + cellX;
}

export function isInBounds(cellX: number, cellY: number): boolean {
  return cellX >= 0 && cellY >= 0 && cellX < GRID_W && cellY < GRID_H;
}

export function paintTile(
  state: EditorState,
  cellX: number,
  cellY: number,
  tile: TileKind = state.selectedTile,
): boolean {
  if (!isInBounds(cellX, cellY)) return false;
  state.tiles[cellIndex(cellX, cellY)] = tile;
  return true;
}

export function placeSelectedEntity(
  state: EditorState,
  cellX: number,
  cellY: number,
): EditorEntity | null {
  if (!isInBounds(cellX, cellY)) return null;
  const entity = createEntityFromSelection(state.selectedEntity, cellX, cellY);
  state.entities.push(entity);
  return entity;
}

export function eraseAtCell(
  state: EditorState,
  cellX: number,
  cellY: number,
): 'entity' | 'tile' | 'none' {
  if (!isInBounds(cellX, cellY)) return 'none';
  const entityIndex = topmostEntityIndexAtCell(state.entities, cellX, cellY);
  if (entityIndex >= 0) {
    state.entities.splice(entityIndex, 1);
    return 'entity';
  }
  state.tiles[cellIndex(cellX, cellY)] = DEFAULT_TILE;
  return 'tile';
}

export function setSelectedEntity(state: EditorState, entity: SelectedEntity): void {
  state.selectedEntity = { ...entity };
}

export function loadPresetIntoState(
  state: EditorState,
  presetId: PresetId,
  seed: number = 1,
): void {
  const preset = presetForId(presetId);
  const generated = preset.generate(seed);
  state.name = presetId;
  state.tiles = normalizePresetTiles(generated.tiles, preset.width, preset.height);
  state.entities = generated.spawns.map(entityFromSpawn);
  state.hoverCell = null;
  state.camera.x = 0;
  state.camera.y = 0;
}

export function getEntityFootprint(entity: EditorEntity): EntityFootprint {
  const size = entitySize(entity.kind);
  return { cellX: entity.cellX, cellY: entity.cellY, w: size.w, h: size.h };
}

export function entityContainsCell(entity: EditorEntity, cellX: number, cellY: number): boolean {
  const foot = getEntityFootprint(entity);
  return (
    cellX >= foot.cellX &&
    cellY >= foot.cellY &&
    cellX < foot.cellX + foot.w &&
    cellY < foot.cellY + foot.h
  );
}

function createEntityFromSelection(
  selected: SelectedEntity,
  cellX: number,
  cellY: number,
): EditorEntity {
  const entity: EditorEntity = { kind: selected.kind, cellX, cellY };
  if (selected.team) entity.team = selected.team;
  if (selected.kind === 'mineralNode') entity.remaining = DEFAULT_MINERAL_REMAINING;
  return entity;
}

function topmostEntityIndexAtCell(
  entities: readonly EditorEntity[],
  cellX: number,
  cellY: number,
): number {
  for (let i = entities.length - 1; i >= 0; i--) {
    if (entityContainsCell(entities[i], cellX, cellY)) return i;
  }
  return -1;
}

function normalizePresetTiles(
  tiles: readonly TileKind[],
  width: number,
  height: number,
): TileKind[] {
  const out = createBlankTiles();
  const copyW = Math.min(width, GRID_W);
  const copyH = Math.min(height, GRID_H);
  for (let y = 0; y < copyH; y++) {
    for (let x = 0; x < copyW; x++) {
      out[cellIndex(x, y)] = tiles[y * width + x];
    }
  }
  return out;
}

function entityFromSpawn(spawn: SpawnSpec): EditorEntity {
  const entity: EditorEntity = {
    kind: spawn.kind,
    cellX: spawn.cellX,
    cellY: spawn.cellY,
  };
  if (spawn.team && spawn.team !== 'neutral') entity.team = spawn.team;
  if (spawn.kind === 'mineralNode') entity.remaining = DEFAULT_MINERAL_REMAINING;
  return entity;
}

function presetForId(presetId: PresetId): MapPreset {
  switch (presetId) {
    case 'western-front':
      return westernFrontPreset;
    case 'expansion-front':
      return expansionFrontPreset;
  }
}

function entitySize(kind: EditorEntityKind): { w: number; h: number } {
  switch (kind) {
    case 'commandCenter':
      return { w: 15, h: 15 };
    case 'barracks':
      return { w: 7, h: 14 };
    case 'factory':
      return { w: 10, h: 9 };
    case 'turret':
    case 'refinery':
    case 'supplyDepot':
    case 'mineralNode':
    case 'gasGeyser':
      return { w: 5, h: 5 };
    default:
      return { w: 1, h: 1 };
  }
}

export function entityCenterPx(entity: EditorEntity): { x: number; y: number } {
  const foot = getEntityFootprint(entity);
  return {
    x: (foot.cellX + foot.w / 2) * CELL,
    y: (foot.cellY + foot.h / 2) * CELL,
  };
}
