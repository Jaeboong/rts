export type EntityId = number;
export type Team = 'player' | 'enemy' | 'neutral';

export interface Vec2 {
  x: number;
  y: number;
}

export type UnitKind = 'worker' | 'marine' | 'enemyDummy';
export type BuildingKind = 'commandCenter' | 'barracks' | 'turret';
export type EntityKind = UnitKind | BuildingKind | 'mineralNode';

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

  dead?: boolean;
}

export const CELL = 32;
export const GRID_W = 64;
export const GRID_H = 64;
export const WORLD_W = GRID_W * CELL;
export const WORLD_H = GRID_H * CELL;
