// Public surface of the map module — re-exports types/catalog/loader/renderer/presets
// + an applyMap() helper main.ts uses to materialize a generated preset into the
// live world.

import { CELL } from '../../types';
import {
  spawnBuilding,
  spawnGasGeyser,
  spawnMineralNode,
  spawnUnit,
} from '../entities';
import type { World } from '../world';
import type { SpawnSpec, TileKind } from './types';

export { TILE_DEFS, ALL_TILE_KINDS, loadTileSprites } from './tiles';
export type { TileAtlas, TileImage } from './tiles';
export { drawTileBackground, getVisibleTileRange } from './tile-render';
export type { VisibleTileRange } from './tile-render';
export type {
  TileKind,
  TileDef,
  SpawnKind,
  SpawnTeam,
  SpawnSpec,
  GeneratedMap,
  MapPreset,
} from './types';
export { westernFrontPreset } from './presets/western-front';

// Push tiles into world.tiles in-place, then realize each SpawnSpec via the
// existing entity factories. CellX/cellY for unit spawns is interpreted as the
// cell whose center the unit's pos points to (matches main.ts's old cellToPx).
// Defensive team fallbacks: presets currently never emit neutral CC/worker/
// dummy specs, but a 'neutral' team would be invalid for those kinds — fall
// back to a sensible default rather than throw at scene load.
export function applyMap(
  world: World,
  tiles: readonly TileKind[],
  spawns: readonly SpawnSpec[],
): void {
  for (let i = 0; i < tiles.length; i++) world.tiles[i] = tiles[i];
  for (const s of spawns) {
    const team = s.team ?? 'neutral';
    switch (s.kind) {
      case 'commandCenter':
        spawnBuilding(
          world,
          'commandCenter',
          team === 'neutral' ? 'player' : team,
          s.cellX,
          s.cellY,
        );
        break;
      case 'mineralNode':
        spawnMineralNode(world, s.cellX, s.cellY);
        break;
      case 'gasGeyser':
        spawnGasGeyser(world, s.cellX, s.cellY);
        break;
      case 'worker':
        spawnUnit(world, 'worker', team === 'neutral' ? 'player' : team, {
          x: s.cellX * CELL + CELL / 2,
          y: s.cellY * CELL + CELL / 2,
        });
        break;
      case 'enemyDummy':
        spawnUnit(world, 'enemyDummy', team === 'neutral' ? 'enemy' : team, {
          x: s.cellX * CELL + CELL / 2,
          y: s.cellY * CELL + CELL / 2,
        });
        break;
    }
  }
}
