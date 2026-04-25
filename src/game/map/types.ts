// Map module — TileKind enumerates every tile sprite, TileDef carries metadata
// (sprite path + walkability), SpawnSpec describes seedable initial-scene entities,
// and MapPreset is the top-level "named, deterministic generator" contract.

export type TileKind =
  | 'dirt-1'
  | 'dirt-2'
  | 'dirt-3'
  | 'dirt-4'
  | 'dirt-5'
  | 'grass-1'
  | 'grass-2'
  | 'grass-3'
  | 'grass-4'
  | 'grass-5'
  | 'wall-1'
  | 'wall-2'
  | 'wall-3'
  | 'wall-4'
  | 'wall-5'
  | 'prop-rocks'
  | 'prop-bush'
  | 'prop-tree'
  | 'prop-fire'
  | 'prop-well'
  | 'water-1'
  | 'water-2'
  | 'water-3'
  | 'water-4';

export interface TileDef {
  spritePath: string;
  walkable: boolean;
}

export type SpawnKind =
  | 'commandCenter'
  | 'mineralNode'
  | 'gasGeyser'
  | 'worker'
  | 'enemyDummy';

export type SpawnTeam = 'player' | 'enemy' | 'neutral';

export interface SpawnSpec {
  kind: SpawnKind;
  team?: SpawnTeam;
  cellX: number;
  cellY: number;
}

export interface GeneratedMap {
  tiles: TileKind[];
  spawns: SpawnSpec[];
}

export interface MapPreset {
  name: string;
  width: number;
  height: number;
  generate(seed: number): GeneratedMap;
}
