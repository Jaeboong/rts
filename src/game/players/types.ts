import type {
  BuildingKind,
  EntityId,
  Team,
  UnitKind,
  Vec2,
} from '../../types';

import type { BuildOrderPhase } from './build-order-tracker';
import type { DecisionRecord } from './decision-history';
import type { StateSummary } from './state-summary';

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
  // Active command type for units (move/attack/gather/build/...) — used by the
  // state-summary helper to label workers as gathering/idle/etc. Omitted when
  // the entity has no command or is not a unit.
  readonly commandType?: string;
  // Last attacker entity ID. Surfaced from Entity.lastDamageBy so the
  // event-tracker can attribute deaths between two GameView snapshots.
  readonly lastDamageBy?: EntityId;
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

/**
 * Per-command apply outcome handed back to a Player after `runPlayers` has
 * applied that player's tick output. Pairs 1:1 with the cmds array the player
 * returned, in order. NanoclawPlayer uses these to feed back into the next
 * prompt so the LLM can self-correct stale IDs / blocked sites / etc.
 */
export interface CommandResult {
  readonly cmd: AICommand;
  readonly ok: boolean;
  readonly reason?: string;
}

export interface Player {
  readonly team: Team;
  // Must be non-blocking — game loop runs every 50ms; LLM-backed players buffer
  // async responses and drain on tick (see ClaudeCLIPlayer planned for Phase 40).
  tick(view: GameView, dt: number): readonly AICommand[];
  serialize?(view: GameView): string;
  /**
   * Called by runPlayers AFTER all players' commands have been applied this
   * cycle. The slice given here is THIS player's cmds + outcomes only. Players
   * that don't care (HumanPlayer, ScriptedAI) leave this undefined.
   */
  onCommandResults?(results: readonly CommandResult[]): void;
  /**
   * Phase 42: HUD reads this to render a "warming…" badge while an LLM player
   * is paying its cold-start cost after a runtime swap. Non-LLM players
   * (HumanPlayer, ScriptedAI) leave this undefined → HUD treats as "ready".
   */
  isWarming?(): boolean;
}

/**
 * Phase 42: structural surface used by the AI inspector panel and the
 * `__aiInspect` window pointer. Both NanoclawPlayer (Claude) and
 * OpenClawPlayer (Codex) satisfy this — typing the global as the structural
 * interface lets the inspector render either without a switch on concrete class.
 *
 * AIExchange lives in the LLM player files; we re-export the same shape via
 * `unknown`-shaped opaque ref + `readonly` accessors here would be lossier than
 * just letting the inspector consumers import AIExchange directly. So this
 * interface intentionally exposes accessor methods that ALREADY exist on both
 * players, keeping the dependency one-way (ui/inspector → players).
 */
export interface InspectableLLMPlayer {
  recentExchanges(): readonly LLMExchange[];
  recentDecisions(): readonly DecisionRecord[];
  lastBuildPhase(): BuildOrderPhase | null;
  lastStateSummary(): StateSummary | null;
}

/**
 * Subset of AIExchange shape consumed by the inspector panel — defined here
 * so both players' AIExchange exports can be widened to satisfy this without
 * a circular import. Field set MUST stay aligned with the panel's reads.
 */
export interface LLMExchange {
  readonly tickAtRequest: number;
  readonly requestedAtMs: number;
  readonly respondedAtMs: number | null;
  readonly prompt: string;
  readonly rawResponse: string | null;
  readonly parsedCount: number;
  readonly status: 'pending' | 'ok' | 'error';
  readonly error?: string;
}
