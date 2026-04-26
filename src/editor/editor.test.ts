import { describe, expect, it } from 'vitest';
import { GRID_W } from '../types';
import {
  createEditorState,
  eraseAtCell,
  paintTile,
  placeSelectedEntity,
} from './editor-state';
import {
  applyEditorMap,
  deserializeEditorMap,
  serializeEditorState,
} from './editor-io';

describe('map editor logic', () => {
  it('paints a tile at the selected cell', () => {
    const state = createEditorState();
    state.selectedTile = 'wall-1';

    expect(paintTile(state, 3, 4)).toBe(true);

    expect(state.tiles[4 * GRID_W + 3]).toBe('wall-1');
  });

  it('places the selected entity at a cell', () => {
    const state = createEditorState();
    state.selectedEntity = { kind: 'commandCenter', team: 'enemy' };

    const entity = placeSelectedEntity(state, 13, 218);

    expect(entity).toEqual({ kind: 'commandCenter', team: 'enemy', cellX: 13, cellY: 218 });
    expect(state.entities).toHaveLength(1);
  });

  it('erases the topmost entity before resetting a tile', () => {
    const state = createEditorState();
    state.selectedEntity = { kind: 'mineralNode' };
    placeSelectedEntity(state, 17, 220);

    expect(eraseAtCell(state, 18, 221)).toBe('entity');
    expect(state.entities).toHaveLength(0);

    state.selectedTile = 'water-1';
    paintTile(state, 18, 221);
    expect(eraseAtCell(state, 18, 221)).toBe('tile');
    expect(state.tiles[221 * GRID_W + 18]).toBe('grass-1');
  });

  it('roundtrips editor JSON state', () => {
    const state = createEditorState();
    state.name = 'test map';
    state.selectedTile = 'dirt-1';
    paintTile(state, 5, 6);
    state.selectedEntity = { kind: 'mineralNode' };
    placeSelectedEntity(state, 17, 220);

    const parsed = deserializeEditorMap(serializeEditorState(state));
    const restored = createEditorState();
    applyEditorMap(restored, parsed);

    expect(restored.name).toBe('test map');
    expect(restored.tiles[6 * GRID_W + 5]).toBe('dirt-1');
    expect(restored.entities).toEqual([
      { kind: 'mineralNode', cellX: 17, cellY: 220, remaining: 1500 },
    ]);
  });
});
