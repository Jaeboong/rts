import {
  CELL,
  type Entity,
  type EntityKind,
  type Vec2,
} from '../../types';
import { ensureSpatialGrid } from './spatial-grid';
import type { World } from '../world';

// Phase 49 — engine-level scripted tactical/micro behaviors. Runs every tick at
// 20Hz, BEFORE driveCommands/combatSystem so a retreat-issued move command gets
// its path requested the same tick (driveCommands sees the fresh command and
// calls requestPath). Combat then sees the new command type and skips chase.
//
// All behaviors apply to ALL armed units regardless of who controls them
// (player, scripted-AI, LLM). LLM micro is bottlenecked by ~5-15s response
// time; scripted behavior runs natively at tick rate to fill the gap.
//
// Override semantics: an EXPLICIT `attack` command (issued by a player or LLM
// targeting a SPECIFIC entity) is treated as user intent and not overridden by
// chase-limit / hold-line. Auto-engage (no command, just sighted enemy) IS
// subject to the chase leash. Retreat is the one exception that overrides any
// command — saving a near-dead unit beats honoring a stale order.

// HP fraction below which a unit retreats. 0.30 chosen empirically: at 30% a
// marine (60 HP → 18 HP) survives ~3 marine shots (6 dmg each), enough time
// to walk a few cells before dying. Lower (0.20) → too late, unit dies en
// route. Higher (0.40) → over-cautious, units retreat from nuisance chip damage.
export const RETREAT_HP_PCT = 0.3;

// HP fraction at which a retreating unit re-engages. Hysteresis vs RETREAT_HP_PCT
// prevents oscillation: a unit that reaches 31% wouldn't immediately re-engage
// only to flee again at 29%. 0.60 = "comfortably above the panic line".
export const RECOVERY_HP_PCT = 0.6;

// Max distance (cells) an auto-engaging unit will chase a target from its
// engagement origin. 8 cells (~128px) ≈ marine attackRange (10 cells) — so a
// fleeing target that breaks line-of-sight by 1-2 cells past attackRange still
// gets chased, but a target dragging the marine across the map (worker feint,
// kiting) is dropped after a short pursuit. Returning to origin avoids
// dragging the whole army apart for one fleeing nuisance.
export const MAX_CHASE_CELLS = 8;

// Group centroid leash (cells) for units in attackMove. Centroid is computed
// from all friendly units currently in attackMove. K=12 cells (~192px) is
// roughly the diameter of a 6-marine clump in formation. Any further and the
// unit is out of fire-support range — yank it back instead of letting it solo
// engage. Same direction as MAX_CHASE_CELLS but applied at the group level.
export const HOLD_LINE_K_CELLS = 12;

// Origin equality threshold (px) — once a returning unit is within this range
// of its engagementOrigin, the return is considered complete and the
// 'returning' state clears. Smaller than CELL so the unit visibly settles back
// at the line rather than oscillating around it.
const ORIGIN_REACH_PX = CELL * 0.75;

// Workers don't fight, so they don't trigger any tactical logic. EnemyDummy is
// a static placeholder. Buildings (turret) are stationary so retreat/chase
// don't apply. This keeps the system focused on real combat units.
const ARMED_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>([
  'marine',
  'tank',
  'tank-light',
  'medic',
]);

export function tacticalSystem(world: World): void {
  ensureSpatialGrid(world);

  // Pre-compute group centroid for hold-line. We only need this when there's
  // at least one unit in attackMove — bail early so single-unit scenarios
  // don't pay for the iteration.
  const centroid = computeAttackMoveCentroid(world);

  for (const e of world.entities.values()) {
    if (e.dead) continue;
    if (!ARMED_KINDS.has(e.kind)) continue;
    if (e.underConstruction) continue;
    // Static defenders (turret in the future, or any speed=0 unit) can't
    // retreat or chase — skip them entirely. Medics have no attackRange but
    // CAN retreat, so we don't gate on attackRange.
    if (!e.speed || e.speed <= 0) continue;

    if (handleRetreat(world, e)) continue;
    handleChaseLeash(world, e);
    handleHoldLine(world, e, centroid);
  }
}

// Returns true if retreat-related logic took control of this unit this tick
// (so the chase / hold-line passes can be skipped — they'd just fight retreat).
function handleRetreat(world: World, e: Entity): boolean {
  const ratio = e.hp / Math.max(1, e.hpMax);
  const isRetreating = e.tacticalState?.phase === 'retreating';

  // Recovery branch first — if we were retreating and HP is back, clear state
  // before any new retreat trigger has a chance to re-fire.
  if (isRetreating && ratio > RECOVERY_HP_PCT) {
    clearTacticalState(e);
    e.command = null;
    e.path = null;
    e.attackTargetId = null;
    return true;
  }

  if (isRetreating) {
    // Already retreating — make sure the move target is still valid. If the
    // CC died mid-retreat, redirect to the next-nearest CC; if none exist,
    // give up retreating (no safe haven). The unit continues with auto-acquire
    // logic in combat.
    const cc = findNearestOwnCC(world, e);
    if (!cc) {
      clearTacticalState(e);
      e.command = null;
      e.path = null;
      return true;
    }
    // Refresh the move target (cheap — combat doesn't repath move commands).
    e.command = { type: 'move', target: { x: cc.pos.x, y: cc.pos.y } };
    return true;
  }

  // Trigger branch. Don't retreat mid-shot — finishing the current attack is
  // both balanced (one more shot may finish off a wounded enemy) and avoids
  // breaking the visual fire animation. attackEffectMs > 0 means "fired within
  // the last 200ms" (see combatSystem).
  if (ratio >= RETREAT_HP_PCT) return false;
  if ((e.attackEffectMs ?? 0) > 0) return false;

  const cc = findNearestOwnCC(world, e);
  if (!cc) return false; // No safe haven — the player has already lost. Stay put.

  // Cancel any existing command (attack/gather/build), preserve original
  // tacticalState struct shape (engagementOrigin can stay; chase logic clears
  // it on its own once the unit recovers).
  ensureTacticalState(e).phase = 'retreating';
  e.command = { type: 'move', target: { x: cc.pos.x, y: cc.pos.y } };
  e.path = null;
  e.attackTargetId = null;
  return true;
}

// Chase leash — units that auto-engaged a target and have chased it past
// MAX_CHASE_CELLS from where they started are pulled back to engagementOrigin.
// Explicit attack commands bypass this (user intent wins).
function handleChaseLeash(world: World, e: Entity): void {
  const phase = e.tacticalState?.phase;

  // Returning home from a previous chase — check arrival.
  if (phase === 'returning') {
    const origin = e.tacticalState?.engagementOrigin;
    if (!origin) {
      clearTacticalState(e);
      return;
    }
    const dx = e.pos.x - origin.x;
    const dy = e.pos.y - origin.y;
    if (dx * dx + dy * dy <= ORIGIN_REACH_PX * ORIGIN_REACH_PX) {
      // Arrived. Drop the move command + state; auto-acquire takes over again.
      clearTacticalState(e);
      if (e.command && e.command.type === 'move') {
        e.command = null;
        e.path = null;
      }
    }
    return;
  }

  // Don't override an explicit player/LLM attack command — that's user intent.
  if (e.command && e.command.type === 'attack') return;
  // attackMove has its own group-leash via handleHoldLine; chase-leash here
  // applies only to no-command auto-engage (the case where a sighted enemy
  // pulled the unit out of formation).
  if (e.command) return;

  const targetId = e.attackTargetId;
  if (targetId === null || targetId === undefined) {
    // No engagement → forget the origin so next engagement re-anchors fresh.
    if (e.tacticalState?.engagementOrigin) {
      e.tacticalState.engagementOrigin = undefined;
    }
    return;
  }
  const target = world.entities.get(targetId);
  if (!target || target.dead) return;

  // Anchor on first engagement tick. Snapshot current pos — the line we should
  // return to if the chase wanders too far.
  if (!e.tacticalState?.engagementOrigin) {
    ensureTacticalState(e).engagementOrigin = { x: e.pos.x, y: e.pos.y };
    return;
  }

  const origin = e.tacticalState.engagementOrigin;
  const dx = e.pos.x - origin.x;
  const dy = e.pos.y - origin.y;
  const distSq = dx * dx + dy * dy;
  const maxPx = MAX_CHASE_CELLS * CELL;
  if (distSq <= maxPx * maxPx) return;

  // Past the leash AND target still beyond attackRange (i.e. we're being
  // dragged) → return to origin. If target is within attackRange, we're
  // committed to the kill — let the shot land.
  const tDist = entityDist(e, target);
  if (tDist <= (e.attackRange ?? 0)) return;

  ensureTacticalState(e).phase = 'returning';
  e.command = { type: 'move', target: { x: origin.x, y: origin.y } };
  e.path = null;
  e.attackTargetId = null;
}

// Hold-line: a unit in attackMove that wandered > HOLD_LINE_K_CELLS from the
// group centroid gets its chase suppressed (path nulled). Combat will still
// fire if a hostile enters attackRange, but the unit won't path-chase a
// fleeing enemy out of formation. Once the group catches up, the leash
// releases naturally on the next tick.
function handleHoldLine(world: World, e: Entity, centroid: Vec2 | null): void {
  if (!centroid) return;
  if (!e.command || e.command.type !== 'attackMove') return;
  // Only kicks in when actively chasing (attackTargetId set) — units that are
  // walking the line normally shouldn't have their attackMove path nulled.
  if (e.attackTargetId === null || e.attackTargetId === undefined) return;
  const target = world.entities.get(e.attackTargetId);
  if (!target || target.dead) return;
  // If target is already within attackRange, finishing the shot is fine (the
  // unit stays roughly in place). Hold-line only matters when the unit would
  // path-chase past the line.
  if (entityDist(e, target) <= (e.attackRange ?? 0)) return;

  const dx = e.pos.x - centroid.x;
  const dy = e.pos.y - centroid.y;
  const maxPx = HOLD_LINE_K_CELLS * CELL;
  if (dx * dx + dy * dy <= maxPx * maxPx) return;

  // Out of formation — drop the chase target so combat won't request a path
  // toward it. The attackMove command stays intact, so driveCommands re-aims
  // back along the original march line.
  e.attackTargetId = null;
  e.path = null;
}

function ensureTacticalState(e: Entity): NonNullable<Entity['tacticalState']> {
  if (!e.tacticalState) e.tacticalState = {};
  return e.tacticalState;
}

function clearTacticalState(e: Entity): void {
  e.tacticalState = undefined;
}

// Centroid of all friendly units currently in attackMove, grouped by team.
// Returns null if no team has > 1 attackMove unit (single units have no
// formation to hold). Computed once per tick in tacticalSystem.
function computeAttackMoveCentroid(world: World): Vec2 | null {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const e of world.entities.values()) {
    if (e.dead) continue;
    if (!ARMED_KINDS.has(e.kind)) continue;
    if (!e.command || e.command.type !== 'attackMove') continue;
    sumX += e.pos.x;
    sumY += e.pos.y;
    count++;
  }
  if (count < 2) return null;
  return { x: sumX / count, y: sumY / count };
}

// Find the nearest own-team CC (alive, not under construction). Uses
// spatialGrid via a sufficiently-large radius scan — CCs are sparse so a
// global scan is also acceptable, but spatialGrid keeps it consistent with
// the rest of the system.
function findNearestOwnCC(world: World, unit: Entity): Entity | null {
  // CCs can be anywhere on the map; an entity-level scan is unavoidable here.
  // Spatial grid offers no help when the search radius approaches map size.
  let best: Entity | null = null;
  let bestSq = Infinity;
  for (const cc of world.entities.values()) {
    if (cc.kind !== 'commandCenter') continue;
    if (cc.team !== unit.team) continue;
    if (cc.dead) continue;
    if (cc.underConstruction) continue;
    const dx = cc.pos.x - unit.pos.x;
    const dy = cc.pos.y - unit.pos.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestSq) {
      best = cc;
      bestSq = d2;
    }
  }
  return best;
}

// AABB-edge distance — same shape as combat.ts's dist(). Duplicated here so
// tactical.ts has no inverse dependency on combat.ts (combat is the consumer
// of tactical's outputs, not the other way around).
function entityDist(a: Entity, b: Entity): number {
  const ar = entityRect(a);
  const br = entityRect(b);
  const dx = Math.max(0, ar.left - br.right, br.left - ar.right);
  const dy = Math.max(0, ar.top - br.bottom, br.top - ar.bottom);
  return Math.hypot(dx, dy);
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function entityRect(e: Entity): Rect {
  if (
    e.cellX !== undefined &&
    e.cellY !== undefined &&
    e.sizeW !== undefined &&
    e.sizeH !== undefined
  ) {
    return {
      left: e.cellX * CELL,
      top: e.cellY * CELL,
      right: (e.cellX + e.sizeW) * CELL,
      bottom: (e.cellY + e.sizeH) * CELL,
    };
  }
  return { left: e.pos.x, top: e.pos.y, right: e.pos.x, bottom: e.pos.y };
}

