import { CELL, GRID_H, GRID_W, type Entity, type Team } from '../../types';
import type { World } from '../world';

import type { BuildViewOpts, GameView, ViewEntity } from './types';

const RESOURCE_KINDS = new Set(['mineralNode', 'gasGeyser']);

export function buildView(
  world: World,
  team: Team,
  opts: BuildViewOpts = {},
): GameView {
  const fog = opts.fog ?? false;
  const myEntities: ViewEntity[] = [];
  const visibleEnemies: ViewEntity[] = [];
  const visibleResources: ViewEntity[] = [];

  for (const e of world.entities.values()) {
    if (e.dead) continue;
    const ve = sanitize(e);
    if (e.team === team) {
      myEntities.push(ve);
      continue;
    }
    if (RESOURCE_KINDS.has(e.kind) || e.team === 'neutral') {
      // TODO(phase-fog): when fog=true, filter resources outside any owned sightRange.
      visibleResources.push(ve);
      continue;
    }
    // Hostile (any non-neutral team that isn't ours).
    // TODO(phase-fog): when fog=true, filter enemies outside any owned sightRange.
    visibleEnemies.push(ve);
  }

  // Suppress unused-var lint until fog filtering ships.
  void fog;

  return {
    tick: world.tickCount,
    resources: {
      minerals: world.resources[team] ?? 0,
      gas: team === 'player' ? world.gas : 0,
    },
    myEntities,
    visibleEnemies,
    visibleResources,
    mapInfo: { w: GRID_W, h: GRID_H, cellPx: CELL },
  };
}

function sanitize(e: Entity): ViewEntity {
  const out: ViewEntity = {
    id: e.id,
    kind: e.kind,
    team: e.team,
    pos: { x: e.pos.x, y: e.pos.y },
    hp: e.hp,
    maxHp: e.hpMax,
    cellX: e.cellX,
    cellY: e.cellY,
    underConstruction: e.underConstruction,
  };
  return out;
}
