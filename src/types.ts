export type EntityId = number;
export type Team = 'player' | 'enemy' | 'neutral';

export interface Vec2 {
  x: number;
  y: number;
}

export type UnitKind = 'worker' | 'marine' | 'tank' | 'tank-light' | 'medic' | 'enemyDummy';
export type BuildingKind =
  | 'commandCenter'
  | 'barracks'
  | 'turret'
  | 'refinery'
  | 'factory'
  | 'supplyDepot';
export type EntityKind = UnitKind | BuildingKind | 'mineralNode' | 'gasGeyser';

export type Command =
  | { type: 'move'; target: Vec2 }
  | { type: 'attackMove'; target: Vec2 }
  | { type: 'attack'; targetId: EntityId }
  | { type: 'gather'; nodeId: EntityId }
  | { type: 'build'; buildingId: EntityId };

export interface ProductionItem {
  produces: UnitKind;
  totalSeconds: number;
  remainingSeconds: number;
}

export type GatherSubState = 'toNode' | 'mining' | 'toDepot' | 'depositing';
export type HealSubState = 'idle' | 'following' | 'healing';

export interface Entity {
  id: EntityId;
  kind: EntityKind;
  team: Team;
  pos: Vec2;
  hp: number;
  hpMax: number;

  // Units
  speed?: number;
  radius?: number;
  command?: Command | null;
  path?: Vec2[] | null;
  pathTargetCell?: { x: number; y: number } | null;
  carrying?: number;
  gatherSubState?: GatherSubState;
  gatherTimer?: number;
  gatherHomeId?: EntityId | null;
  gatherNodeId?: EntityId | null;

  // Combatants (units + turret)
  attackTargetId?: EntityId | null;
  attackCooldown?: number;
  attackRange?: number;
  attackDamage?: number;
  attackInterval?: number;
  sightRange?: number;

  // Medic-only: heal AI tuning + runtime state.
  healRate?: number;
  healRange?: number;
  healSubState?: HealSubState;
  healTargetId?: EntityId | null;
  healTimer?: number;
  // Recent-fire visual signal (ms remaining); drives attack-pose sprite swap and any flash effect.
  attackEffectMs?: number;

  // Facing angle in radians, atan2(dy, dx) convention (east=0, south=+π/2, north=−π/2).
  // Set on units that visually rotate (worker, marine, tank). Buildings, enemyDummy, resources omit.
  facing?: number;

  // Buildings
  cellX?: number;
  cellY?: number;
  sizeW?: number;
  sizeH?: number;
  underConstruction?: boolean;
  buildTotalSeconds?: number;
  buildProgress?: number;
  productionQueue?: ProductionItem[];
  rallyPoint?: Vec2 | null;

  // Resource node
  remaining?: number;

  // Gas geyser claim (refineryId on the geyser when claimed)
  refineryId?: EntityId | null;
  // Mineral node claim (depotId on the node when claimed by a supplyDepot)
  depotId?: EntityId | null;
  // Refinery → underlying gas geyser (mirror); Supply depot → underlying mineral node.
  geyserId?: EntityId | null;
  mineralNodeId?: EntityId | null;
  // Refinery production accumulator (seconds of gas produced fractionally)
  gasAccumulator?: number;

  dead?: boolean;
}

export const CELL = 16;
export const GRID_W = 128;
export const GRID_H = 128;
export const WORLD_W = GRID_W * CELL;
export const WORLD_H = GRID_H * CELL;
