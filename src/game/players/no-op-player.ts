import type { Team } from '../../types';

import type { AICommand, GameView, Player } from './types';

/**
 * Phase 42-D: placeholder enemy when the user has not yet picked an AI flavor.
 * Returns no commands so the enemy team sits idle while the human plays.
 * Swapped in via the registry's 'none' slot until the HUD button click
 * lazy-instantiates a real player (Claude / Codex / Scripted).
 */
export class NoOpPlayer implements Player {
  readonly team: Team;

  constructor(team: Team) {
    this.team = team;
  }

  tick(_view: GameView, _dt: number): readonly AICommand[] {
    return [];
  }
}
