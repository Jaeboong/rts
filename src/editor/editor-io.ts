import { GRID_H, GRID_W } from '../types';
import { ALL_TILE_KINDS } from '../game/map/tiles';
import type { TileKind } from '../game/map/types';
import {
  DEFAULT_MINERAL_REMAINING,
  EDITOR_ENTITY_KINDS,
  type EditorEntity,
  type EditorEntityKind,
  type EditorState,
} from './editor-state';

export interface EditorMapJson {
  version: 1;
  name: string;
  gridW: number;
  gridH: number;
  tiles: TileKind[];
  entities: EditorEntity[];
}

const TILE_KIND_NAMES = new Set<string>(ALL_TILE_KINDS);
const ENTITY_KIND_NAMES = new Set<string>(EDITOR_ENTITY_KINDS);

export function createEditorMapJson(state: EditorState): EditorMapJson {
  return {
    version: 1,
    name: normalizedName(state.name),
    gridW: GRID_W,
    gridH: GRID_H,
    tiles: state.tiles.slice(),
    entities: state.entities.map(copyEntity),
  };
}

export function serializeEditorState(state: EditorState): string {
  return JSON.stringify(createEditorMapJson(state), null, 2);
}

export function deserializeEditorMap(text: string): EditorMapJson {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) throw new Error('Map JSON must be an object.');
  if (parsed.version !== 1) throw new Error('Unsupported map JSON version.');
  if (parsed.gridW !== GRID_W || parsed.gridH !== GRID_H) {
    throw new Error(`Map grid must be ${GRID_W}x${GRID_H}.`);
  }
  if (!Array.isArray(parsed.tiles)) throw new Error('Map JSON tiles must be an array.');
  if (parsed.tiles.length !== GRID_W * GRID_H) {
    throw new Error(`Map JSON tiles length must be ${GRID_W * GRID_H}.`);
  }
  if (!Array.isArray(parsed.entities)) {
    throw new Error('Map JSON entities must be an array.');
  }
  return {
    version: 1,
    name: typeof parsed.name === 'string' ? parsed.name : 'untitled',
    gridW: GRID_W,
    gridH: GRID_H,
    tiles: parsed.tiles.map(readTileKind),
    entities: parsed.entities.map(readEntity),
  };
}

export function applyEditorMap(state: EditorState, map: EditorMapJson): void {
  state.name = normalizedName(map.name);
  state.tiles = map.tiles.slice();
  state.entities = map.entities.map(copyEntity);
  state.hoverCell = null;
  state.camera.x = 0;
  state.camera.y = 0;
}

export async function loadEditorMapFile(file: File): Promise<EditorMapJson> {
  return deserializeEditorMap(await file.text());
}

export interface SaveToProjectResult {
  readonly ok: boolean;
  readonly message: string;
}

// Allowed map filename pattern. Mirrors vite.config.ts MAP_NAME_RE so the
// editor surfaces the rule (and a useful error) before the round-trip.
const MAP_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

export async function saveEditorToProject(state: EditorState): Promise<SaveToProjectResult> {
  const name = normalizedName(state.name);
  if (!MAP_NAME_RE.test(name)) {
    return {
      ok: false,
      message: `name must match ${MAP_NAME_RE.source}`,
    };
  }
  const map = createEditorMapJson(state);
  try {
    const res = await fetch('/api/maps/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, map }),
    });
    const data = (await res.json()) as { ok?: boolean; message?: string };
    return { ok: res.ok && data.ok === true, message: data.message ?? '' };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}

export function downloadEditorState(state: EditorState): void {
  const blob = new Blob([serializeEditorState(state)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = mapDownloadName(state.name);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function mapDownloadName(name: string): string {
  const safe = normalizedName(name).replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-');
  return `${safe || 'map'}.json`;
}

function copyEntity(entity: EditorEntity): EditorEntity {
  const copy: EditorEntity = {
    kind: entity.kind,
    cellX: entity.cellX,
    cellY: entity.cellY,
  };
  if (entity.team) copy.team = entity.team;
  if (entity.kind === 'mineralNode') {
    copy.remaining = entity.remaining ?? DEFAULT_MINERAL_REMAINING;
  }
  return copy;
}

function normalizedName(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : 'untitled';
}

function readTileKind(value: unknown): TileKind {
  if (isTileKind(value)) return value;
  throw new Error(`Unknown tile kind: ${String(value)}`);
}

function readEntity(value: unknown): EditorEntity {
  if (!isRecord(value)) throw new Error('Entity must be an object.');
  if (!isEditorEntityKind(value.kind)) {
    throw new Error(`Unknown entity kind: ${String(value.kind)}`);
  }
  const cellX = readCellCoord(value.cellX, 'cellX');
  const cellY = readCellCoord(value.cellY, 'cellY');
  if (cellX < 0 || cellY < 0 || cellX >= GRID_W || cellY >= GRID_H) {
    throw new Error('Entity cell coordinates are out of bounds.');
  }
  const entity: EditorEntity = { kind: value.kind, cellX, cellY };
  if (value.team !== undefined) {
    if (!isTeam(value.team)) throw new Error(`Unknown entity team: ${String(value.team)}`);
    entity.team = value.team;
  }
  if (value.kind === 'mineralNode') {
    entity.remaining = readRemaining(value.remaining);
  }
  return entity;
}

function readRemaining(value: unknown): number {
  if (value === undefined) return DEFAULT_MINERAL_REMAINING;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error('Mineral remaining must be a non-negative number.');
  }
  return value;
}

function readCellCoord(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`Entity ${fieldName} must be an integer.`);
  }
  return value;
}

function isTileKind(value: unknown): value is TileKind {
  return typeof value === 'string' && TILE_KIND_NAMES.has(value);
}

function isEditorEntityKind(value: unknown): value is EditorEntityKind {
  return typeof value === 'string' && ENTITY_KIND_NAMES.has(value);
}

function isTeam(value: unknown): value is 'player' | 'enemy' | 'neutral' {
  return value === 'player' || value === 'enemy' || value === 'neutral';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
