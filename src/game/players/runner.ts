import type { World } from '../world';

import { applyAICommand } from './command-applier';
import type { Player } from './types';
import { buildView } from './view';

/**
 * Drives every Player one tick: build a per-team view, call player.tick, apply
 * the returned commands. Errors thrown inside a player are caught + logged so
 * one rogue player can't crash the loop.
 */
export function runPlayers(
  world: World,
  players: readonly Player[],
  dt: number,
): void {
  for (const p of players) {
    let cmds: readonly ReturnType<Player['tick']>[number][];
    try {
      const view = buildView(world, p.team);
      cmds = p.tick(view, dt);
    } catch (err) {
      console.warn(`[runPlayers] ${p.team} tick threw`, err);
      continue;
    }
    for (const cmd of cmds) applyAICommand(world, p.team, cmd);
  }
}
