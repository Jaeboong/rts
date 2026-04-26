import type { Team } from '../../types';

import type { AICommand, GameView, Player } from './types';

/**
 * Phase 38 design decision: HumanPlayer is a no-op stub. The existing input
 * pipeline (handler.ts → commands.ts) already mutates world directly, and
 * porting it through the AICommand bus would be a large refactor with real
 * regression risk. Registering HumanPlayer therefore preserves existing
 * behaviour exactly while still slotting humans into the Player roster for
 * Phase 39+ uses (turn order, view debugging, replay).
 */
export class HumanPlayer implements Player {
  readonly team: Team;

  constructor(team: Team) {
    this.team = team;
  }

  tick(_view: GameView, _dt: number): readonly AICommand[] {
    return [];
  }
}
