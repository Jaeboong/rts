import {
  CELL,
  type BuildingKind,
  type Entity,
  type EntityId,
  type Team,
  type UnitKind,
  type Vec2,
} from '../../types';
import {
  BUILDING_DEFS,
  UNIT_DEFS,
  UNIT_PRODUCTION,
  canBuildingProduceUnits,
} from '../balance';
import { canPlace, clampMoveTargetToWalkable } from '../commands';
import { displaceUnitsFromFootprint } from '../displacement';
import { spawnBuilding } from '../entities';
import {
  canPlaceRefinery,
  canPlaceSupplyDepot,
  unclaimedGeyserAt,
  unclaimedMineralNodeAt,
} from '../placement';
import { inBounds, type World } from '../world';

import type { AICommand } from './types';

const UNIT_KINDS: ReadonlySet<string> = new Set([
  'worker',
  'marine',
  'tank',
  'tank-light',
  'medic',
  'enemyDummy',
]);

const BUILDING_KINDS: ReadonlySet<string> = new Set([
  'commandCenter',
  'barracks',
  'turret',
  'refinery',
  'factory',
  'supplyDepot',
]);

/**
 * Result of applying a single AICommand. `ok:true` means the command had at
 * least one effective per-target application (e.g. a `move` with one valid
 * unit out of three is still ok). `ok:false` carries a short human-readable
 * reason — the LLM-facing prompt re-shows these so the model can self-correct.
 */
export type ApplyResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Validates and applies a single AI command on behalf of `team`. Returns a
 * Result discriminated union — see ApplyResult. Never throws — LLM-emitted
 * commands routinely reference stale IDs, wrong teams, or out-of-bounds cells,
 * and the game must keep ticking regardless.
 *
 * Batch semantics for multi-target ops (move/attack/gather): if at least one
 * target succeeds the result is ok. Per-target rejections are warn-logged but
 * do not flip the outer result. Only an entirely-empty success set returns
 * `{ok:false}` with a summarizing reason.
 */
export function applyAICommand(
  world: World,
  team: Team,
  cmd: AICommand,
): ApplyResult {
  switch (cmd.type) {
    case 'move':
      return applyMove(world, team, cmd.unitIds, cmd.target, false);
    case 'attackMove':
      return applyMove(world, team, cmd.unitIds, cmd.target, true);
    case 'attack':
      return applyAttack(world, team, cmd.unitIds, cmd.targetId);
    case 'gather':
      return applyGather(world, team, cmd.unitIds, cmd.nodeId);
    case 'build':
      return applyBuild(world, team, cmd.workerId, cmd.building, cmd.cellX, cmd.cellY);
    case 'produce':
      return applyProduce(world, team, cmd.buildingId, cmd.unit);
    case 'setRally':
      return applySetRally(world, team, cmd.buildingId, cmd.pos);
    case 'cancel':
      return applyCancel(world, team, cmd.entityId);
  }
}

const OK: ApplyResult = { ok: true };

function reject(reason: string): ApplyResult {
  console.warn(`[ai-command] rejected: ${reason}`);
  return { ok: false, reason };
}

// Warn-and-continue helper for inner per-unit rejections inside a batch op.
// The outer call may still succeed if any other target is valid — this just
// surfaces the per-unit reason in the console for debugging.
function warnInvalid(reason: string): void {
  console.warn(`[ai-command] rejected: ${reason}`);
}

function isAliveUnit(e: Entity | undefined, team: Team): e is Entity {
  if (!e) return false;
  if (e.dead || e.hp <= 0) return false;
  if (e.team !== team) return false;
  return UNIT_KINDS.has(e.kind);
}

// Workers actively constructing a building must be left alone — re-issuing any
// other command (move/gather/attack/...) abandons the build and leaves the site
// stuck under construction (single-rate construction means no other worker auto
// resumes). Explicit `cancel` is the only escape hatch; new `build` overwrites
// (deliberate carve-out, see task spec). LLM-friendly: prompt now flags
// building workers with `[building]` so the model can see and skip them.
function isBusyBuilder(u: Entity): { busy: true; buildingId: EntityId } | { busy: false } {
  if (u.kind !== 'worker') return { busy: false };
  const cmd = u.command;
  if (!cmd || cmd.type !== 'build') return { busy: false };
  return { busy: true, buildingId: cmd.buildingId };
}

function isAliveBuilding(e: Entity | undefined, team: Team): e is Entity {
  if (!e) return false;
  if (e.dead || e.hp <= 0) return false;
  if (e.team !== team) return false;
  return BUILDING_KINDS.has(e.kind);
}

function inWorldPx(p: Vec2): boolean {
  const cellX = Math.floor(p.x / CELL);
  const cellY = Math.floor(p.y / CELL);
  return inBounds(cellX, cellY);
}

function applyMove(
  world: World,
  team: Team,
  unitIds: readonly EntityId[],
  target: Vec2,
  attackMove: boolean,
): ApplyResult {
  if (!inWorldPx(target)) return reject(`move target out of bounds (${target.x},${target.y})`);
  const clamped = clampMoveTargetToWalkable(world, target);
  let any = false;
  for (const id of unitIds) {
    const u = world.entities.get(id);
    if (!isAliveUnit(u, team)) {
      warnInvalid(`move unit ${id} not owned by ${team} or dead`);
      continue;
    }
    const busy = isBusyBuilder(u);
    if (busy.busy) {
      warnInvalid(`worker ${id} is building (currently constructing #${busy.buildingId}); cancel first or wait for completion`);
      continue;
    }
    u.command = attackMove
      ? { type: 'attackMove', target: { x: clamped.x, y: clamped.y } }
      : { type: 'move', target: { x: clamped.x, y: clamped.y } };
    u.path = null;
    u.attackTargetId = null;
    u.attackEffectMs = 0;
    any = true;
  }
  if (!any) return reject(`${attackMove ? 'attackMove' : 'move'}: no valid owned units in [${unitIds.join(',')}]`);
  return OK;
}

function applyAttack(
  world: World,
  team: Team,
  unitIds: readonly EntityId[],
  targetId: EntityId,
): ApplyResult {
  const target = world.entities.get(targetId);
  if (!target || target.dead || target.hp <= 0) {
    return reject(`attack target ${targetId} missing or dead`);
  }
  if (target.team === team) return reject(`attack target ${targetId} is friendly`);
  let any = false;
  for (const id of unitIds) {
    const u = world.entities.get(id);
    if (!isAliveUnit(u, team)) {
      warnInvalid(`attack unit ${id} not owned by ${team} or dead`);
      continue;
    }
    const busy = isBusyBuilder(u);
    if (busy.busy) {
      warnInvalid(`worker ${id} is building (currently constructing #${busy.buildingId}); cancel first or wait for completion`);
      continue;
    }
    if (u.attackRange === undefined) {
      warnInvalid(`attack unit ${id} (${u.kind}) cannot attack`);
      continue;
    }
    u.command = { type: 'attack', targetId };
    u.path = null;
    u.attackTargetId = null;
    any = true;
  }
  if (!any) return reject(`attack: no valid attack-capable units in [${unitIds.join(',')}]`);
  return OK;
}

function applyGather(
  world: World,
  team: Team,
  unitIds: readonly EntityId[],
  nodeId: EntityId,
): ApplyResult {
  const node = world.entities.get(nodeId);
  if (!node || node.dead) return reject(`gather node ${nodeId} missing`);
  // Worker accepts either a mineralNode or a supplyDepot; gather system resolves.
  if (node.kind !== 'mineralNode' && node.kind !== 'supplyDepot') {
    return reject(`gather target ${nodeId} kind=${node.kind} not gatherable`);
  }
  let any = false;
  for (const id of unitIds) {
    const u = world.entities.get(id);
    if (!isAliveUnit(u, team)) {
      warnInvalid(`gather unit ${id} not owned by ${team} or dead`);
      continue;
    }
    if (u.kind !== 'worker') {
      warnInvalid(`gather unit ${id} (${u.kind}) is not a worker`);
      continue;
    }
    const busy = isBusyBuilder(u);
    if (busy.busy) {
      warnInvalid(`worker ${id} is building (currently constructing #${busy.buildingId}); cancel first or wait for completion`);
      continue;
    }
    u.command = { type: 'gather', nodeId };
    u.path = null;
    u.attackTargetId = null;
    // Reset any in-flight gather sub-state so the system reinitialises against the new target.
    u.gatherSubState = undefined;
    u.gatherTimer = 0;
    u.gatherNodeId = null;
    u.gatherHomeId = null;
    any = true;
  }
  if (!any) return reject(`gather: no valid worker units in [${unitIds.join(',')}]`);
  return OK;
}

function applyBuild(
  world: World,
  team: Team,
  workerId: EntityId,
  buildingKind: BuildingKind,
  cellX: number,
  cellY: number,
): ApplyResult {
  const def = BUILDING_DEFS[buildingKind];
  if (!def) return reject(`build kind ${buildingKind} unknown`);
  const worker = world.entities.get(workerId);
  if (!isAliveUnit(worker, team)) return reject(`build worker ${workerId} invalid`);
  if (worker.kind !== 'worker') return reject(`build worker ${workerId} is ${worker.kind}`);
  if (!inBounds(cellX, cellY) || !inBounds(cellX + def.w - 1, cellY + def.h - 1)) {
    return reject(`build footprint out of bounds at (${cellX},${cellY})`);
  }
  // refinery / supplyDepot snap onto a host resource; treat (cellX, cellY) as a
  // hint that may point at any cell *inside* the host footprint and resolve via
  // placement helpers (mirrors confirmPlacement in commands.ts).
  if (buildingKind === 'refinery') {
    return applyHostedBuild(world, team, worker, 'refinery', cellX, cellY);
  }
  if (buildingKind === 'supplyDepot') {
    return applyHostedBuild(world, team, worker, 'supplyDepot', cellX, cellY);
  }
  if (!canPlace(world, cellX, cellY, def.w, def.h)) {
    return reject(`build site (${cellX},${cellY}) blocked`);
  }
  if ((world.resources[team] ?? 0) < def.cost) return reject(`build ${buildingKind} insufficient minerals`);
  const gasCost = def.gasCost ?? 0;
  if (gasCost > 0 && (world.gas[team] ?? 0) < gasCost) {
    return reject(`build ${buildingKind} insufficient gas`);
  }
  world.resources[team] -= def.cost;
  if (gasCost > 0) world.gas[team] -= gasCost;
  const site = spawnBuilding(world, buildingKind, team, cellX, cellY, false);
  // Workers caught in the new footprint must be teleported clear or they
  // softlock construction (occupancy hides them but they can never path out).
  displaceUnitsFromFootprint(world, cellX, cellY, def.w, def.h);
  worker.command = { type: 'build', buildingId: site.id };
  worker.path = null;
  worker.attackTargetId = null;
  return OK;
}

/**
 * Refinery/supplyDepot build path. Looks up the host (geyser/mineralNode) at
 * (cellX, cellY), snaps the building footprint to the host's TL, validates via
 * the dedicated placement helper, links host↔building, displaces units, and
 * issues the worker's `build` command. Mirrors confirmPlacement in commands.ts.
 */
function applyHostedBuild(
  world: World,
  team: Team,
  worker: Entity,
  kind: 'refinery' | 'supplyDepot',
  cellX: number,
  cellY: number,
): ApplyResult {
  const def = BUILDING_DEFS[kind];
  const host =
    kind === 'refinery'
      ? unclaimedGeyserAt(world, cellX, cellY)
      : unclaimedMineralNodeAt(world, cellX, cellY);
  if (!host) return reject(`build ${kind} no unclaimed host at (${cellX},${cellY})`);
  if (host.cellX === undefined || host.cellY === undefined) {
    return reject(`build ${kind} host ${host.id} missing cell coords`);
  }
  const sx = host.cellX;
  const sy = host.cellY;
  const ok =
    kind === 'refinery'
      ? canPlaceRefinery(world, sx, sy, host.id)
      : canPlaceSupplyDepot(world, sx, sy, host.id);
  if (!ok) return reject(`build ${kind} site (${sx},${sy}) blocked`);
  if ((world.resources[team] ?? 0) < def.cost) {
    return reject(`build ${kind} insufficient minerals`);
  }
  const gasCost = def.gasCost ?? 0;
  if (gasCost > 0 && (world.gas[team] ?? 0) < gasCost) {
    return reject(`build ${kind} insufficient gas`);
  }
  world.resources[team] -= def.cost;
  if (gasCost > 0) world.gas[team] -= gasCost;
  const site = spawnBuilding(world, kind, team, sx, sy, false);
  if (kind === 'refinery') {
    host.refineryId = site.id;
    site.geyserId = host.id;
  } else {
    host.depotId = site.id;
    site.mineralNodeId = host.id;
  }
  displaceUnitsFromFootprint(world, sx, sy, def.w, def.h);
  worker.command = { type: 'build', buildingId: site.id };
  worker.path = null;
  worker.attackTargetId = null;
  return OK;
}

function applyProduce(
  world: World,
  team: Team,
  buildingId: EntityId,
  unit: UnitKind,
): ApplyResult {
  const b = world.entities.get(buildingId);
  if (!isAliveBuilding(b, team)) return reject(`produce building ${buildingId} invalid`);
  if (b.underConstruction) return reject(`produce building ${buildingId} under construction`);
  if (!canBuildingProduceUnits(b.kind as BuildingKind)) {
    return reject(`produce building ${buildingId} (${b.kind}) cannot produce`);
  }
  const def = UNIT_PRODUCTION[unit];
  if (!def) return reject(`produce unit ${unit} unknown`);
  if (b.kind !== def.producer) {
    return reject(`produce unit ${unit} requires ${def.producer}, got ${b.kind}`);
  }
  if (!UNIT_DEFS[unit]) return reject(`produce unit ${unit} has no def`);
  if ((world.resources[team] ?? 0) < def.cost) return reject(`produce ${unit} insufficient minerals`);
  const gasCost = def.gasCost ?? 0;
  if (gasCost > 0 && (world.gas[team] ?? 0) < gasCost) {
    return reject(`produce ${unit} insufficient gas`);
  }
  world.resources[team] -= def.cost;
  if (gasCost > 0) world.gas[team] -= gasCost;
  b.productionQueue!.push({
    produces: unit,
    totalSeconds: def.seconds,
    remainingSeconds: def.seconds,
  });
  return OK;
}

// Multiplier on the offending enemy's attackRange used for rally-safety
// rejection. Rationale: produced units WALK to the rally on a path that may
// graze enemy fire arcs; we want a buffer so the rally itself isn't sitting
// just outside attack range while the path still crosses through it. 1.5×
// attackRange (pixels) is the smallest margin that empirically prevents the
// "rally at marine sight edge → produced units die en route" loop without
// rejecting reasonable forward rallies that are already a screen away.
const RALLY_ENEMY_RANGE_MULTIPLIER = 1.5;

function applySetRally(
  world: World,
  team: Team,
  buildingId: EntityId,
  pos: Vec2,
): ApplyResult {
  const b = world.entities.get(buildingId);
  if (!isAliveBuilding(b, team)) return reject(`setRally building ${buildingId} invalid`);
  if (!canBuildingProduceUnits(b.kind as BuildingKind)) {
    return reject(`setRally building ${buildingId} (${b.kind}) has no rally`);
  }
  if (!inWorldPx(pos)) return reject(`setRally pos out of bounds (${pos.x},${pos.y})`);
  // Reject rallies inside enemy attack envelopes. Without this, produced units
  // walk into fire and die en route — and the LLM has no signal that the rally
  // is the cause (setRally itself always succeeds in isolation, the deaths
  // appear in the next event-tracker brief detached from the prior decision).
  // Iterate ALL enemy entities (not just unit kinds) — turrets are buildings
  // with attackRange > 0 and matter as much as marines for rally safety.
  const danger = findEnemyAttackerNear(world, team, pos);
  if (danger !== null) {
    const cellX = Math.floor(danger.enemy.pos.x / CELL);
    const cellY = Math.floor(danger.enemy.pos.y / CELL);
    return reject(
      `setRally: rally point (${pos.x}, ${pos.y}) is within attackRange of enemy ${danger.enemy.kind}#${danger.enemy.id} at (${cellX}, ${cellY}) — produced units will die en route`,
    );
  }
  b.rallyPoint = { x: pos.x, y: pos.y };
  return OK;
}

interface RallyDanger {
  readonly enemy: Entity;
  readonly distSq: number;
}

// Returns the first enemy whose attack envelope contains `pos`, or null if the
// rally is safe. Uses squared distance to avoid sqrt in the hot path; the
// threshold is also squared accordingly.
function findEnemyAttackerNear(world: World, team: Team, pos: Vec2): RallyDanger | null {
  for (const e of world.entities.values()) {
    if (e.dead || e.hp <= 0) continue;
    if (e.team === team || e.team === 'neutral') continue;
    const range = e.attackRange;
    // attackRange===0 is treated identical to undefined: workers, CC, depot,
    // refinery — anything without a weapon — is not a rally hazard.
    if (range === undefined || range <= 0) continue;
    const dx = pos.x - e.pos.x;
    const dy = pos.y - e.pos.y;
    const distSq = dx * dx + dy * dy;
    const threshold = range * RALLY_ENEMY_RANGE_MULTIPLIER;
    if (distSq <= threshold * threshold) {
      return { enemy: e, distSq };
    }
  }
  return null;
}

function applyCancel(
  world: World,
  team: Team,
  entityId: EntityId,
): ApplyResult {
  const e = world.entities.get(entityId);
  if (!e || e.dead) return reject(`cancel entity ${entityId} missing`);
  if (e.team !== team) return reject(`cancel entity ${entityId} not owned by ${team}`);
  // Building → pop last queued production. Unit → stop current command.
  if (BUILDING_KINDS.has(e.kind)) {
    if (!e.productionQueue || e.productionQueue.length === 0) {
      return reject(`cancel building ${entityId} queue empty`);
    }
    const popped = e.productionQueue.pop();
    if (!popped) return reject(`cancel building ${entityId} queue empty after pop`);
    const def = UNIT_PRODUCTION[popped.produces];
    if (def) {
      world.resources[team] += def.cost;
      if (def.gasCost) world.gas[team] += def.gasCost;
    }
    return OK;
  }
  if (UNIT_KINDS.has(e.kind)) {
    e.command = null;
    e.path = null;
    e.pathTargetCell = null;
    e.attackTargetId = null;
    e.gatherSubState = undefined;
    e.gatherTimer = 0;
    e.gatherNodeId = null;
    e.gatherHomeId = null;
    return OK;
  }
  return reject(`cancel entity ${entityId} kind=${e.kind} not cancellable`);
}
