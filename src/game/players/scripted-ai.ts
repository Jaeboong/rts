import type { BuildingKind, Entity, EntityId, Team, UnitKind, Vec2 } from '../../types';
import { BUILDING_DEFS } from '../balance';
import { canPlace } from '../commands';
import { unclaimedMineralNodeAt } from '../placement';
import { inBounds, type World } from '../world';

import {
  TIER3_BUILD_ORDER,
  WAVE_MIN_SIZE,
  WAVE_REPEAT_TICKS,
  type BuildStep,
} from './build-orders';
import {
  averagePos,
  selectWaveMembers,
  selectWaveTarget,
  shouldDispatchWave,
} from './strategy';
import type { AICommand, GameView, Player } from './types';

export type ScriptedAITier = 1 | 3;

export interface ScriptedAIOpts {
  readonly tier?: ScriptedAITier;
}

const NO_WAVE = Number.NEGATIVE_INFINITY;

/**
 * ScriptedAI runs a pure-deterministic state machine off `view.tick` (no
 * Date.now / Math.random anywhere in this file). Tier 1 = workers gather only.
 * Tier 3 layers on the TIER3_BUILD_ORDER walk plus a periodic wave dispatcher.
 *
 * Idempotency: every tick we re-derive owned entities and queue/build state
 * before issuing commands; a step is "done" only when the world reflects it
 * (e.g. an owned barracks exists), and only then does `currentStep` advance.
 *
 * ScriptedAI peeks at `world` directly for command/state inspection (gather
 * sub-state, productionQueue, in-flight builds). The sanitized GameView is for
 * LLM-facing players where exposing internal state would be unfair.
 */
export class ScriptedAI implements Player {
  readonly team: Team;
  private readonly world: World;
  private readonly tier: ScriptedAITier;
  private currentStep = 0;
  private lastStepTick = 0;
  private lastWaveTick = NO_WAVE;

  constructor(team: Team, world: World, opts: ScriptedAIOpts = {}) {
    this.team = team;
    this.world = world;
    this.tier = opts.tier ?? 3;
  }

  tick(view: GameView, _dt: number): readonly AICommand[] {
    const cmds: AICommand[] = [];
    this.tickGather(cmds);
    if (this.tier >= 3) {
      this.tickBuildOrder(view, cmds);
      this.tickPeriodicWave(view, cmds);
    }
    return cmds;
  }

  // --- Tier 1 (gather) -----------------------------------------------------

  private tickGather(out: AICommand[]): void {
    const myWorkers = this.collectIdleWorkers();
    if (myWorkers.length === 0) return;
    const nodes = this.collectGatherableNodes();
    if (nodes.length === 0) return;
    for (const w of myWorkers) {
      const node = nearestNode(w, nodes);
      if (!node) continue;
      out.push({ type: 'gather', unitIds: [w.id], nodeId: node.id });
    }
  }

  private collectIdleWorkers(): Entity[] {
    const out: Entity[] = [];
    for (const e of this.world.entities.values()) {
      if (e.team !== this.team) continue;
      if (e.kind !== 'worker') continue;
      if (e.dead || e.hp <= 0) continue;
      // Already gathering / building — leave alone (idempotency).
      if (e.command && (e.command.type === 'gather' || e.command.type === 'build')) continue;
      out.push(e);
    }
    out.sort((a, b) => a.id - b.id);
    return out;
  }

  private collectGatherableNodes(): Entity[] {
    const out: Entity[] = [];
    for (const e of this.world.entities.values()) {
      if (e.kind !== 'mineralNode') continue;
      if (e.dead) continue;
      if ((e.remaining ?? 0) <= 0) continue;
      if (e.depotId === null || e.depotId === undefined) continue;
      // Restrict to depots owned by us — neutral nodes claimed by enemy don't count.
      const depot = this.world.entities.get(e.depotId);
      if (!depot || depot.dead || depot.team !== this.team) continue;
      out.push(e);
    }
    out.sort((a, b) => a.id - b.id);
    return out;
  }

  // --- Tier 3 (build order) ------------------------------------------------

  private tickBuildOrder(view: GameView, out: AICommand[]): void {
    // Skip past already-satisfied steps (e.g. building owned, marine count met)
    // without issuing commands. Then issue at most one command-emitting step
    // per tick: emitting multiple build/produce commands in the same tick can
    // overrun resources (resources mutate in applier, not in AI tick) and
    // burn produces against a barracks queue that the AI thinks is empty.
    const cap = TIER3_BUILD_ORDER.length;
    for (let i = 0; i < cap; i++) {
      if (this.currentStep >= TIER3_BUILD_ORDER.length) return;
      const step = TIER3_BUILD_ORDER[this.currentStep];
      // Tick-debounce check still applies even for already-satisfied skips,
      // because tickAfterPrev is part of the readiness contract.
      if (step.tickAfterPrev !== undefined) {
        if (view.tick - this.lastStepTick < step.tickAfterPrev) return;
      }
      if (this.stepAlreadySatisfied(step)) {
        // Idempotent fast-forward: no command issued, but advance bookkeeping.
        if (step.action === 'produce') this.bumpCumulativeUnitGoal(step.kind);
        this.currentStep++;
        this.lastStepTick = view.tick;
        continue;
      }
      // Not already satisfied — try to issue. Resource gate applies here only.
      const minMin =
        step.action === 'wave' ? 0 : step.minMinerals ?? 0;
      if (view.resources.minerals < minMin) return;
      const issued = this.issueStep(view, step, out);
      if (!issued) return;
      this.currentStep++;
      this.lastStepTick = view.tick;
      // Stop after one command-emitting step. Next tick re-evaluates.
      return;
    }
  }

  private stepAlreadySatisfied(step: BuildStep): boolean {
    switch (step.action) {
      case 'build':
        return this.ownsBuildingOfKind(step.kind);
      case 'produce': {
        const desiredAfter = this.getCumulativeUnitGoal(step.kind) + 1;
        return this.countAliveOrQueued(step.kind) >= desiredAfter;
      }
      case 'wave':
        return false;
    }
  }

  private issueStep(view: GameView, step: BuildStep, out: AICommand[]): boolean {
    switch (step.action) {
      case 'build':
        return this.issueBuildStep(step.kind, out);
      case 'produce':
        return this.issueProduceStep(step.kind, step.producer, out);
      case 'wave':
        return this.issueWave(view, step.minMembers, out);
    }
  }

  private issueBuildStep(
    kind: BuildingKind,
    out: AICommand[],
  ): boolean {
    // Idempotent: if we already own one of this kind (under construction or
    // complete) the step is satisfied — advance without re-issuing.
    if (this.ownsBuildingOfKind(kind)) return true;

    const cc = this.findOwnedCC();
    if (!cc) return false;
    const worker = this.pickFreeWorker();
    if (!worker) return false;

    if (kind === 'supplyDepot') {
      const node = this.pickNearestUnclaimedMineralNode(cc);
      if (!node || node.cellX === undefined || node.cellY === undefined) return false;
      // Pass the host's TL — applyHostedBuild looks up via unclaimedMineralNodeAt.
      out.push({
        type: 'build',
        workerId: worker.id,
        building: 'supplyDepot',
        cellX: node.cellX,
        cellY: node.cellY,
      });
      return true;
    }

    if (kind === 'barracks') {
      const site = this.pickBarracksSite(cc);
      if (!site) return false;
      out.push({
        type: 'build',
        workerId: worker.id,
        building: 'barracks',
        cellX: site.x,
        cellY: site.y,
      });
      return true;
    }

    // Other building kinds aren't part of TIER3 yet; reject silently rather
    // than throw so adding a kind to the table doesn't crash here.
    return false;
  }

  private issueProduceStep(
    unit: UnitKind,
    producer: BuildingKind,
    out: AICommand[],
  ): boolean {
    // Caller (tickBuildOrder) already filtered out the already-satisfied case
    // via stepAlreadySatisfied. Here we only need to emit a single produce
    // command targeting a producer with an empty queue (so we don't stack
    // unaffordable orders against the same building in a tick burst).
    const building = this.findCompletedBuildingOfKind(producer);
    if (!building) return false;
    const queueLen = building.productionQueue?.length ?? 0;
    if (queueLen > 0) return false;
    out.push({ type: 'produce', buildingId: building.id, unit });
    this.bumpCumulativeUnitGoal(unit);
    return true;
  }

  // Per-unit cumulative production goal — incremented once per produce-step
  // advance. Used to make a sequence of produce-steps for the same unit kind
  // idempotent: if N marines already exist (alive+queued), the first N produce
  // steps no-op-advance.
  private readonly producedGoals = new Map<UnitKind, number>();

  private getCumulativeUnitGoal(unit: UnitKind): number {
    return this.producedGoals.get(unit) ?? 0;
  }

  private bumpCumulativeUnitGoal(unit: UnitKind): void {
    this.producedGoals.set(unit, this.getCumulativeUnitGoal(unit) + 1);
  }

  private countAliveOrQueued(unit: UnitKind): number {
    let count = 0;
    for (const e of this.world.entities.values()) {
      if (e.team !== this.team) continue;
      if (e.dead) continue;
      if (e.kind === unit) {
        count++;
        continue;
      }
      if (e.productionQueue) {
        for (const item of e.productionQueue) {
          if (item.produces === unit) count++;
        }
      }
    }
    return count;
  }

  private issueWave(view: GameView, minMembers: number, out: AICommand[]): boolean {
    const memberIds = selectWaveMembers(view, minMembers);
    if (memberIds.length < minMembers) return false;
    const target = this.computeWaveTarget(view, memberIds);
    if (!target) return false;
    out.push({ type: 'attackMove', unitIds: memberIds, target });
    this.lastWaveTick = view.tick;
    return true;
  }

  private tickPeriodicWave(view: GameView, out: AICommand[]): void {
    // Periodic re-dispatch only kicks in once the build-order's first wave step
    // has already fired. Until then `lastWaveTick === NO_WAVE` so the cooldown
    // check still works (Infinity gap), but `selectWaveMembers` typically won't
    // have enough marines yet anyway — the build-order step gates the first wave.
    if (this.currentStep < TIER3_BUILD_ORDER.length) return;
    if (
      !shouldDispatchWave(view, this.lastWaveTick, WAVE_REPEAT_TICKS, WAVE_MIN_SIZE)
    ) {
      return;
    }
    const memberIds = selectWaveMembers(view, WAVE_MIN_SIZE);
    if (memberIds.length < WAVE_MIN_SIZE) return;
    const target = this.computeWaveTarget(view, memberIds);
    if (!target) return;
    out.push({ type: 'attackMove', unitIds: memberIds, target });
    this.lastWaveTick = view.tick;
  }

  private computeWaveTarget(view: GameView, memberIds: readonly EntityId[]): Vec2 | null {
    const memberSet = new Set(memberIds);
    const members = view.myEntities.filter((e) => memberSet.has(e.id));
    const from = averagePos(members);
    if (!from) return null;
    return selectWaveTarget(view, from);
  }

  // --- helpers -------------------------------------------------------------

  private ownsBuildingOfKind(kind: string): boolean {
    for (const e of this.world.entities.values()) {
      if (e.team !== this.team) continue;
      if (e.dead) continue;
      if (e.kind === kind) return true;
    }
    return false;
  }

  private findOwnedCC(): Entity | null {
    for (const e of this.world.entities.values()) {
      if (e.team !== this.team) continue;
      if (e.kind !== 'commandCenter') continue;
      if (e.dead) continue;
      return e;
    }
    return null;
  }

  private findCompletedBuildingOfKind(kind: string): Entity | null {
    let best: Entity | null = null;
    let bestId = Number.MAX_SAFE_INTEGER;
    for (const e of this.world.entities.values()) {
      if (e.team !== this.team) continue;
      if (e.kind !== kind) continue;
      if (e.dead || e.hp <= 0) continue;
      if (e.underConstruction) continue;
      if (e.id < bestId) {
        best = e;
        bestId = e.id;
      }
    }
    return best;
  }

  private pickFreeWorker(): Entity | null {
    // Free = not currently building. (Gathering is fine — interrupting a
    // worker's gather to issue a `build` is the standard SC pattern.)
    let best: Entity | null = null;
    let bestId = Number.MAX_SAFE_INTEGER;
    for (const e of this.world.entities.values()) {
      if (e.team !== this.team) continue;
      if (e.kind !== 'worker') continue;
      if (e.dead || e.hp <= 0) continue;
      if (e.command && e.command.type === 'build') continue;
      if (e.id < bestId) {
        best = e;
        bestId = e.id;
      }
    }
    return best;
  }

  private pickNearestUnclaimedMineralNode(cc: Entity): Entity | null {
    const ccCx = (cc.cellX ?? 0) + (cc.sizeW ?? 0) / 2;
    const ccCy = (cc.cellY ?? 0) + (cc.sizeH ?? 0) / 2;
    let best: Entity | null = null;
    let bestD2 = Infinity;
    let bestId = Number.MAX_SAFE_INTEGER;
    for (const e of this.world.entities.values()) {
      if (e.kind !== 'mineralNode') continue;
      if (e.dead) continue;
      if (e.depotId !== null && e.depotId !== undefined) continue;
      if (e.cellX === undefined || e.cellY === undefined) continue;
      const cx = e.cellX + (e.sizeW ?? 0) / 2;
      const cy = e.cellY + (e.sizeH ?? 0) / 2;
      const dx = cx - ccCx;
      const dy = cy - ccCy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2 || (d2 === bestD2 && e.id < bestId)) {
        best = e;
        bestD2 = d2;
        bestId = e.id;
      }
    }
    // Sanity: re-check via placement helper using a cell inside the host.
    if (!best || best.cellX === undefined || best.cellY === undefined) return null;
    if (!unclaimedMineralNodeAt(this.world, best.cellX, best.cellY)) return null;
    return best;
  }

  /**
   * Spiral search for a barracks footprint anchored on the CC center. Returns
   * the TL (cellX, cellY) of the first ring cell where canPlace succeeds.
   * Ring iteration is deterministic — no ties to break.
   */
  private pickBarracksSite(cc: Entity): { x: number; y: number } | null {
    const def = BUILDING_DEFS.barracks;
    if (cc.cellX === undefined || cc.cellY === undefined) return null;
    const ccCx = cc.cellX + (cc.sizeW ?? 0) / 2;
    const ccCy = cc.cellY + (cc.sizeH ?? 0) / 2;
    const startX = Math.floor(ccCx - def.w / 2);
    const startY = Math.floor(ccCy - def.h / 2);
    const maxR = 30; // bounded — prevents pathological sweep on a packed map
    for (let r = 0; r <= maxR; r++) {
      const ring = collectRing(startX, startY, r);
      for (const c of ring) {
        if (!inBounds(c.x, c.y)) continue;
        if (!inBounds(c.x + def.w - 1, c.y + def.h - 1)) continue;
        if (canPlace(this.world, c.x, c.y, def.w, def.h)) return c;
      }
    }
    return null;
  }
}

function nearestNode(worker: Entity, nodes: readonly Entity[]): Entity | null {
  let best: Entity | null = null;
  let bestD2 = Infinity;
  let bestId: EntityId = Number.MAX_SAFE_INTEGER;
  for (const n of nodes) {
    const dx = n.pos.x - worker.pos.x;
    const dy = n.pos.y - worker.pos.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2 || (d2 === bestD2 && n.id < bestId)) {
      best = n;
      bestD2 = d2;
      bestId = n.id;
    }
  }
  return best;
}

// Deterministic ring around (cx, cy) at Chebyshev radius r. r=0 returns just
// the center cell. Iteration order: top row L→R, bottom row L→R, then left col
// + right col top→bottom (matches commands.ts:collectRing).
function collectRing(cx: number, cy: number, r: number): Array<{ x: number; y: number }> {
  if (r === 0) return [{ x: cx, y: cy }];
  const out: Array<{ x: number; y: number }> = [];
  for (let x = cx - r; x <= cx + r; x++) {
    out.push({ x, y: cy - r });
    out.push({ x, y: cy + r });
  }
  for (let y = cy - r + 1; y <= cy + r - 1; y++) {
    out.push({ x: cx - r, y });
    out.push({ x: cx + r, y });
  }
  return out;
}

