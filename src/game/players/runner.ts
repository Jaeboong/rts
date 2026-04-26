import type { World } from '../world';

import { applyAICommand } from './command-applier';
import type { AICommand, CommandResult, Player } from './types';
import { buildView } from './view';

/**
 * Drives every Player one tick: build a per-team view, call player.tick, apply
 * the returned commands, then deliver per-command outcomes back to each player
 * via `onCommandResults` (after ALL players' commands are applied — never
 * interleaved). Errors thrown inside a player are caught + logged so one rogue
 * player can't crash the loop.
 */
export function runPlayers(
  world: World,
  players: readonly Player[],
  dt: number,
): void {
  // Bucket per player: keep insertion order matching `players` so
  // onCommandResults receives results in cmd-issue order.
  const buckets: Array<{ player: Player; results: CommandResult[] }> = [];
  for (const p of players) {
    let cmds: readonly AICommand[];
    try {
      const view = buildView(world, p.team);
      cmds = p.tick(view, dt);
    } catch (err) {
      console.warn(`[runPlayers] ${p.team} tick threw`, err);
      buckets.push({ player: p, results: [] });
      continue;
    }
    const results: CommandResult[] = [];
    for (const cmd of cmds) {
      const outcome = applyAICommand(world, p.team, cmd);
      results.push(
        outcome.ok ? { cmd, ok: true } : { cmd, ok: false, reason: outcome.reason },
      );
    }
    buckets.push({ player: p, results });
  }
  // Deliver feedback after all applies — players observing the world from
  // onCommandResults see a consistent post-cycle state.
  for (const { player, results } of buckets) {
    if (!player.onCommandResults) continue;
    try {
      player.onCommandResults(results);
    } catch (err) {
      console.warn(`[runPlayers] ${player.team} onCommandResults threw`, err);
    }
  }
}
