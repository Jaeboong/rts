import type { EntityId, Vec2 } from '../../types';

import type { GameView, ViewEntity } from './types';

// Kinds that a wave should march toward — buildings first (fixed targets),
// then any visible enemy unit. enemyDummy counts because Phase 38 mains seed it.
const PRIORITY_BUILDING_KINDS: ReadonlySet<string> = new Set([
  'commandCenter',
  'barracks',
  'factory',
  'supplyDepot',
  'turret',
  'refinery',
]);

const VALID_MARINE_KINDS: ReadonlySet<string> = new Set(['marine']);

/**
 * Returns true when a fresh wave should be dispatched: cooldown expired AND
 * we have at least `minMembers` eligible marines.
 *
 * `lastWaveTick` is the world-tick on which the most recent wave was issued
 * (or a sentinel like -Infinity for "no wave yet"). Cooldown comparison uses
 * `view.tick` directly so the function is pure (no Date.now / random).
 */
export function shouldDispatchWave(
  view: GameView,
  lastWaveTick: number,
  cooldownTicks: number,
  minMembers: number,
): boolean {
  if (view.tick - lastWaveTick < cooldownTicks) return false;
  return countEligibleMarines(view) >= minMembers;
}

/**
 * Picks deterministic wave members: the lowest-`id` marines that are alive
 * and not already attack-moving. Selection is independent of map iteration
 * order because we explicitly sort by id.
 */
export function selectWaveMembers(
  view: GameView,
  count: number,
): EntityId[] {
  const eligible = view.myEntities.filter(isEligibleMarine);
  eligible.sort((a, b) => a.id - b.id);
  return eligible.slice(0, count).map((e) => e.id);
}

/**
 * Picks a wave target: nearest visible enemy entity (any kind). Buildings
 * are preferred over units because they're stationary — choosing a moving
 * target lets the wave wander. `from` is typically the average marine pos
 * (or the AI's CC) so the closest hostile structure to *our* base wins.
 *
 * Returns null when no visible enemy exists. Tie-break by entity id ascending.
 */
export function selectWaveTarget(view: GameView, from: Vec2): Vec2 | null {
  const buildings = view.visibleEnemies.filter((e) =>
    PRIORITY_BUILDING_KINDS.has(e.kind),
  );
  const candidates = buildings.length > 0 ? buildings : view.visibleEnemies.slice();
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const da = sqDist(a.pos, from);
    const db = sqDist(b.pos, from);
    if (da !== db) return da - db;
    return a.id - b.id;
  });
  const pick = candidates[0];
  return { x: pick.pos.x, y: pick.pos.y };
}

/**
 * Mean position of the supplied entity list. Returns null on empty input.
 * Used to compute "from where" the wave is launching for target selection.
 */
export function averagePos(entities: readonly ViewEntity[]): Vec2 | null {
  if (entities.length === 0) return null;
  let sx = 0;
  let sy = 0;
  for (const e of entities) {
    sx += e.pos.x;
    sy += e.pos.y;
  }
  return { x: sx / entities.length, y: sy / entities.length };
}

function countEligibleMarines(view: GameView): number {
  let n = 0;
  for (const e of view.myEntities) if (isEligibleMarine(e)) n++;
  return n;
}

function isEligibleMarine(e: ViewEntity): boolean {
  if (!VALID_MARINE_KINDS.has(e.kind)) return false;
  if (e.hp <= 0) return false;
  return true;
}

function sqDist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}
