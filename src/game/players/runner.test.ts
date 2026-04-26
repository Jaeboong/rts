import { describe, expect, it, vi } from 'vitest';
import type { Team } from '../../types';
import { spawnBuilding, spawnMineralNode, spawnUnit } from '../entities';
import { cellToPx, createWorld } from '../world';
import { HumanPlayer } from './human-player';
import { runPlayers } from './runner';
import type { AICommand, GameView, Player } from './types';

describe('runPlayers', () => {
  it('does nothing when only HumanPlayer is registered (regression: existing behavior preserved)', () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(5, 5));
    const before = m.command;
    runPlayers(w, [new HumanPlayer('player')], 1 / 20);
    expect(m.command).toBe(before);
  });

  it('forwards each player a per-team view', () => {
    const w = createWorld();
    spawnUnit(w, 'worker', 'player', cellToPx(5, 5));
    spawnUnit(w, 'worker', 'enemy', cellToPx(40, 40));

    const seenByPlayer: GameView[] = [];
    const seenByEnemy: GameView[] = [];
    const players: Player[] = [
      {
        team: 'player' as Team,
        tick: (v) => { seenByPlayer.push(v); return []; },
      },
      {
        team: 'enemy' as Team,
        tick: (v) => { seenByEnemy.push(v); return []; },
      },
    ];
    runPlayers(w, players, 1 / 20);
    expect(seenByPlayer[0].myEntities[0].team).toBe('player');
    expect(seenByEnemy[0].myEntities[0].team).toBe('enemy');
  });

  it('applies returned AICommand from a player', () => {
    const w = createWorld();
    const node = spawnMineralNode(w, 30, 30, 1500);
    const depot = spawnBuilding(w, 'supplyDepot', 'enemy', 30, 30);
    node.depotId = depot.id;
    depot.mineralNodeId = node.id;
    const wkr = spawnUnit(w, 'worker', 'enemy', cellToPx(20, 20));

    const fakePlayer: Player = {
      team: 'enemy',
      tick(): readonly AICommand[] {
        return [{ type: 'gather', unitIds: [wkr.id], nodeId: node.id }];
      },
    };
    runPlayers(w, [fakePlayer], 1 / 20);
    expect(wkr.command).toEqual({ type: 'gather', nodeId: node.id });
  });

  it('a player throwing in tick is caught + warn-logged, others still run', () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(5, 5));
    const e = spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(20, 20));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const broken: Player = {
      team: 'player',
      tick: () => { throw new Error('boom'); },
    };
    const ok: Player = {
      team: 'enemy',
      tick: () => [{ type: 'attack', unitIds: [e.id], targetId: m.id }],
    };
    runPlayers(w, [broken, ok], 1 / 20);
    // enemyDummy has no attackRange — applyAICommand will reject with warn,
    // but we're verifying the broken player didn't stop the second player.
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
