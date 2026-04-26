import type {
  BuildingKind,
  EntityId,
  Team,
  UnitKind,
  Vec2,
} from '../../types';

export interface ViewEntity {
  readonly id: EntityId;
  readonly kind: string;
  readonly team: Team;
  readonly pos: Vec2;
  readonly hp: number;
  readonly maxHp: number;
  readonly cellX?: number;
  readonly cellY?: number;
  readonly underConstruction?: boolean;
}

export interface GameView {
  readonly tick: number;
  readonly resources: { readonly minerals: number; readonly gas: number };
  readonly myEntities: readonly ViewEntity[];
  readonly visibleEnemies: readonly ViewEntity[];
  readonly visibleResources: readonly ViewEntity[];
  readonly mapInfo: { readonly w: number; readonly h: number; readonly cellPx: number };
}

export type AICommand =
  | { type: 'move'; unitIds: readonly EntityId[]; target: Vec2 }
  | { type: 'attack'; unitIds: readonly EntityId[]; targetId: EntityId }
  | { type: 'attackMove'; unitIds: readonly EntityId[]; target: Vec2 }
  | { type: 'gather'; unitIds: readonly EntityId[]; nodeId: EntityId }
  | {
      type: 'build';
      workerId: EntityId;
      building: BuildingKind;
      cellX: number;
      cellY: number;
    }
  | { type: 'produce'; buildingId: EntityId; unit: UnitKind }
  | { type: 'setRally'; buildingId: EntityId; pos: Vec2 }
  | { type: 'cancel'; entityId: EntityId };

export interface BuildViewOpts {
  readonly fog?: boolean;
}

export interface Player {
  readonly team: Team;
  // Must be non-blocking — game loop runs every 50ms; LLM-backed players buffer
  // async responses and drain on tick (see ClaudeCLIPlayer planned for Phase 40).
  tick(view: GameView, dt: number): readonly AICommand[];
  serialize?(view: GameView): string;
}
