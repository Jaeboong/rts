import type { GameView, ViewEntity } from './types';

/**
 * Pure projection of a GameView into a denormalized "what does my base look
 * like right now" summary. Designed to feed a small, brittle LLM that gets
 * lost in the raw entity list — the summary collapses N entities into bucket
 * counts the model can use to make a single high-level decision.
 *
 * Determinism: same input → identical output. No clocks, no randomness, no
 * iteration over Map (we only consume the already-stable view arrays).
 */
export interface StateSummary {
  readonly team: string;
  readonly minerals: number;
  readonly gas: number;
  readonly workers: WorkerCounts;
  readonly army: ArmyCounts;
  readonly buildings: BuildingCounts;
  readonly threats: ThreatSummary;
  readonly visibleEnemies: VisibleEnemySummary;
  /**
   * Phase 43: explicit hoarding signal so the LLM stops sitting on resources.
   * Null = below the warn threshold; otherwise the strongest level matched.
   */
  readonly hoarding: HoardingFlags;
  // Phase 45 — armed units (marine/tank/tank-light/medic) with no active
  // command. Rally tracking lives on building state in World, not on
  // ViewEntity, so the >5s + "at base" qualifier from prompt rule A1 is the
  // LLM's job (decision history); the summary just exposes the count.
  readonly idleArmyCount: number;
  // Phase 45 — visible enemy armed units. Distinct from threats.combatUnits
  // (which includes enemyDummy/turret and excludes medic) — like-for-like
  // comparator against army.total for defensivePosture.
  readonly enemyArmySize: number;
  // Phase 45 — drives prompt rule A2. critical: visible combat enemy within
  // CRITICAL_CC_CELLS of any CC. behind: enemyArmySize > army.total. parity:
  // enemyArmySize*2 >= army.total. safe: anything else.
  readonly defensivePosture: DefensivePosture;
}

export type DefensivePosture = 'safe' | 'parity' | 'behind' | 'critical';

export interface HoardingFlags {
  readonly minerals: HoardingLevel;
  readonly gas: HoardingLevel;
}

export type HoardingLevel = null | 'warn' | 'critical';

export interface WorkerCounts {
  readonly total: number;
  readonly gathering: number;
  readonly building: number;
  readonly idle: number;
  /** Up to 5 idle worker IDs (sorted asc) — enough for the LLM to address them. */
  readonly idleIds: readonly number[];
}

export interface ArmyCounts {
  readonly marines: number;
  readonly tanks: number;
  readonly medics: number;
  readonly other: number;
  readonly total: number;
}

export interface BuildingCounts {
  readonly commandCenters: number;
  readonly supplyDepots: number;
  readonly barracks: number;
  readonly factories: number;
  readonly turrets: number;
  readonly refineries: number;
  /** Number of buildings still under construction (any kind). */
  readonly underConstruction: number;
}

export interface ThreatSummary {
  /** Closest visible enemy in cells, or null when none visible. */
  readonly nearestEnemyCells: number | null;
  /** Count of visible enemy combat units (anything with a damage role). */
  readonly combatUnits: number;
}

export interface VisibleEnemySummary {
  readonly workers: number;
  readonly marines: number;
  readonly tanks: number;
  readonly buildings: number;
  readonly other: number;
  readonly total: number;
}

const WORKER_KINDS: ReadonlySet<string> = new Set(['worker']);
const ARMY_KINDS: ReadonlySet<string> = new Set(['marine', 'tank', 'tank-light', 'medic']);
const BUILDING_KINDS: ReadonlySet<string> = new Set([
  'commandCenter',
  'supplyDepot',
  'barracks',
  'factory',
  'turret',
  'refinery',
]);
const COMBAT_ENEMY_KINDS: ReadonlySet<string> = new Set([
  'marine',
  'tank',
  'tank-light',
  'enemyDummy',
  'turret',
]);

const IDLE_IDS_MAX = 5;

// Phase 43 hoarding thresholds. > warn = the model is told to spend; > critical
// escalates to "fire multiple commands this call".
const HOARD_WARN = 200;
const HOARD_CRITICAL = 400;

// Phase 45 — distance (in grid cells) within which a visible enemy combat unit
// near any of my CCs counts as "incoming attack" → defensivePosture=critical.
// Picked at 1/3 of marine sightRange (240px / 16px = 15 cells) so the rule
// fires while the marine is still on the approach, not after it's already in
// the base. Also matches the 18-cell threshold used by build-order-tracker
// for its short-range defend pre-empt — staying coarser keeps the two signals
// roughly in sync without the LLM seeing a contradictory state.
const CRITICAL_CC_CELLS = 15;

// Phase 45 — surface "deploy them" guidance only when the count is meaningful.
// 3 matches A1's "≥3 armed units" threshold. Below this we suppress the line
// to keep the prompt quiet during early-game economy.
const IDLE_ARMY_DEPLOY_THRESHOLD = 3;

function classifyHoard(amount: number): HoardingLevel {
  if (amount > HOARD_CRITICAL) return 'critical';
  if (amount > HOARD_WARN) return 'warn';
  return null;
}

export function summarizeState(view: GameView): StateSummary {
  const workers = countWorkers(view.myEntities);
  const army = countArmy(view.myEntities);
  const buildings = countBuildings(view.myEntities);
  const threats = summarizeThreats(view);
  const visibleEnemies = summarizeVisibleEnemies(view.visibleEnemies);
  const idleArmyCount = countIdleArmy(view.myEntities);
  const enemyArmySize = countEnemyArmy(view.visibleEnemies);
  const defensivePosture = classifyPosture(view, army.total, enemyArmySize);
  // The view doesn't expose the requesting team directly — but the my/enemy
  // partition is already done by buildView, so we leave team as a label the
  // caller (NanoclawPlayer) can override. Default 'me' when unknown.
  const team = view.myEntities[0]?.team ?? 'me';
  return {
    team,
    minerals: view.resources.minerals,
    gas: view.resources.gas,
    workers,
    army,
    buildings,
    threats,
    visibleEnemies,
    hoarding: {
      minerals: classifyHoard(view.resources.minerals),
      gas: classifyHoard(view.resources.gas),
    },
    idleArmyCount,
    enemyArmySize,
    defensivePosture,
  };
}

// Armed = anything in ARMY_KINDS (marine/tank/tank-light/medic). "Idle" here is
// the strict view-level signal: command field is empty (commandType undefined).
// Worth noting we DO count medics — a medic with no follow target is a wasted
// support unit just like an idle marine.
function countIdleArmy(entities: readonly ViewEntity[]): number {
  let n = 0;
  for (const e of entities) {
    if (!ARMY_KINDS.has(e.kind)) continue;
    if (e.commandType !== undefined) continue;
    n++;
  }
  return n;
}

// Counts visible enemy units that match our own ARMY_KINDS bucket. Distinct
// from `threats.combatUnits` (which counts attackable hostiles incl. enemyDummy
// and turret) — this is the comparator against our `army.total` for posture.
function countEnemyArmy(enemies: readonly ViewEntity[]): number {
  let n = 0;
  for (const e of enemies) {
    if (ARMY_KINDS.has(e.kind)) n++;
  }
  return n;
}

function classifyPosture(
  view: GameView,
  ownArmy: number,
  enemyArmy: number,
): DefensivePosture {
  // Critical pre-empts everything: a visible enemy combat unit (anything in
  // COMBAT_ENEMY_KINDS) within CRITICAL_CC_CELLS of any of my CCs is an
  // imminent base attack. Use per-CC distance, NOT the entity centroid (the
  // threat-summary helper averages all my units, which is dragged around by
  // gathering workers and would mask a base poke).
  const ccs = ownCommandCenters(view.myEntities);
  if (ccs.length > 0) {
    const cellPx = view.mapInfo.cellPx;
    for (const enemy of view.visibleEnemies) {
      if (!COMBAT_ENEMY_KINDS.has(enemy.kind)) continue;
      for (const cc of ccs) {
        const dxCells = (enemy.pos.x - cc.pos.x) / cellPx;
        const dyCells = (enemy.pos.y - cc.pos.y) / cellPx;
        const distCells = Math.sqrt(dxCells * dxCells + dyCells * dyCells);
        if (distCells <= CRITICAL_CC_CELLS) return 'critical';
      }
    }
  }
  // No CCs left = posture is moot (we've lost), but pick something sensible
  // rather than throwing — the LLM still makes decisions in the death spiral.
  if (enemyArmy > ownArmy) return 'behind';
  // Half-rule keeps us out of false "safe" when we're slightly ahead but the
  // enemy still has a meaningful counter-force.
  if (enemyArmy * 2 >= ownArmy) return 'parity';
  return 'safe';
}

function ownCommandCenters(entities: readonly ViewEntity[]): readonly ViewEntity[] {
  return entities.filter((e) => e.kind === 'commandCenter');
}

function countWorkers(entities: readonly ViewEntity[]): WorkerCounts {
  let gathering = 0;
  let building = 0;
  let idle = 0;
  const idleIds: number[] = [];
  for (const e of entities) {
    if (!WORKER_KINDS.has(e.kind)) continue;
    if (e.commandType === 'gather') gathering++;
    else if (e.commandType === 'build') building++;
    else {
      idle++;
      if (idleIds.length < IDLE_IDS_MAX) idleIds.push(e.id);
    }
  }
  idleIds.sort((a, b) => a - b);
  return {
    total: gathering + building + idle,
    gathering,
    building,
    idle,
    idleIds,
  };
}

function countArmy(entities: readonly ViewEntity[]): ArmyCounts {
  let marines = 0;
  let tanks = 0;
  let medics = 0;
  let other = 0;
  for (const e of entities) {
    if (!ARMY_KINDS.has(e.kind)) continue;
    if (e.kind === 'marine') marines++;
    else if (e.kind === 'tank' || e.kind === 'tank-light') tanks++;
    else if (e.kind === 'medic') medics++;
    else other++;
  }
  return { marines, tanks, medics, other, total: marines + tanks + medics + other };
}

function countBuildings(entities: readonly ViewEntity[]): BuildingCounts {
  let commandCenters = 0;
  let supplyDepots = 0;
  let barracks = 0;
  let factories = 0;
  let turrets = 0;
  let refineries = 0;
  let underConstruction = 0;
  for (const e of entities) {
    if (!BUILDING_KINDS.has(e.kind)) continue;
    if (e.underConstruction) underConstruction++;
    switch (e.kind) {
      case 'commandCenter':
        commandCenters++;
        break;
      case 'supplyDepot':
        supplyDepots++;
        break;
      case 'barracks':
        barracks++;
        break;
      case 'factory':
        factories++;
        break;
      case 'turret':
        turrets++;
        break;
      case 'refinery':
        refineries++;
        break;
    }
  }
  return {
    commandCenters,
    supplyDepots,
    barracks,
    factories,
    turrets,
    refineries,
    underConstruction,
  };
}

function summarizeThreats(view: GameView): ThreatSummary {
  let combatUnits = 0;
  let nearestSqCells: number | null = null;
  // Use the centroid of my entities as the reference point. Falls back to
  // map center when we have nothing on the board.
  const ref = centroid(view.myEntities, view.mapInfo);
  const cellPx = view.mapInfo.cellPx;
  for (const e of view.visibleEnemies) {
    if (COMBAT_ENEMY_KINDS.has(e.kind)) combatUnits++;
    const dxCells = (e.pos.x - ref.x) / cellPx;
    const dyCells = (e.pos.y - ref.y) / cellPx;
    const d2 = dxCells * dxCells + dyCells * dyCells;
    if (nearestSqCells === null || d2 < nearestSqCells) nearestSqCells = d2;
  }
  const nearestEnemyCells =
    nearestSqCells === null ? null : Math.round(Math.sqrt(nearestSqCells));
  return { nearestEnemyCells, combatUnits };
}

function summarizeVisibleEnemies(
  enemies: readonly ViewEntity[],
): VisibleEnemySummary {
  let workers = 0;
  let marines = 0;
  let tanks = 0;
  let buildings = 0;
  let other = 0;
  for (const e of enemies) {
    if (e.kind === 'worker') workers++;
    else if (e.kind === 'marine') marines++;
    else if (e.kind === 'tank' || e.kind === 'tank-light') tanks++;
    else if (BUILDING_KINDS.has(e.kind)) buildings++;
    else other++;
  }
  return {
    workers,
    marines,
    tanks,
    buildings,
    other,
    total: workers + marines + tanks + buildings + other,
  };
}

function centroid(
  entities: readonly ViewEntity[],
  mapInfo: GameView['mapInfo'],
): { x: number; y: number } {
  if (entities.length === 0) {
    return { x: (mapInfo.w * mapInfo.cellPx) / 2, y: (mapInfo.h * mapInfo.cellPx) / 2 };
  }
  let sx = 0;
  let sy = 0;
  for (const e of entities) {
    sx += e.pos.x;
    sy += e.pos.y;
  }
  return { x: sx / entities.length, y: sy / entities.length };
}

/**
 * Pretty-print the StateSummary as plain-text lines for prompt embedding.
 * The format is intentionally compact (one bullet per concept) so a small
 * model can scan it without losing place. Excludes empty zero-rows.
 */
export function formatStateSummary(s: StateSummary): string {
  const lines: string[] = [];
  lines.push(`team: ${s.team}`);
  lines.push(formatWorkers(s.workers));
  lines.push(formatArmy(s.army));
  lines.push(formatBuildings(s.buildings));
  lines.push(`minerals: ${s.minerals}`);
  if (s.gas > 0) lines.push(`gas: ${s.gas}`);
  lines.push(formatThreats(s.threats));
  lines.push(formatVisibleEnemies(s.visibleEnemies));
  // Phase 45: posture line goes BEFORE hoarding warnings so the LLM sees
  // "defend now" / "deploy now" before being told to spend on workers — the
  // spend directive should be answered with army production when behind.
  // Suppressed entirely when posture is 'safe' to avoid prompt noise.
  const postureLine = formatDefensivePosture(s);
  if (postureLine !== null) lines.push(postureLine);
  const idleArmyLine = formatIdleArmy(s);
  if (idleArmyLine !== null) lines.push(idleArmyLine);
  // Phase 43: appended last so the model sees the spend directive after
  // reading the rest of the picture. Aggressive tone is intentional — the
  // model otherwise hoards minerals while leaving barracks idle.
  for (const line of formatHoarding(s)) lines.push(line);
  return lines.join('\n');
}

function formatIdleArmy(s: StateSummary): string | null {
  if (s.idleArmyCount < IDLE_ARMY_DEPLOY_THRESHOLD) return null;
  return `army_idle: ${s.idleArmyCount} (deploy them — see Spend Rules §A1)`;
}

function formatDefensivePosture(s: StateSummary): string | null {
  switch (s.defensivePosture) {
    case 'safe':
      return null;
    case 'parity':
      return `defensive_posture: parity (you have ${s.army.total} armed vs ${s.enemyArmySize} enemy armed visible — hold production momentum)`;
    case 'behind':
      return `defensive_posture: BEHIND (you have ${s.army.total} armed vs ${s.enemyArmySize} enemy armed visible — max produce, see Spend Rules §A2)`;
    case 'critical':
      return `defensive_posture: CRITICAL (enemy combat unit within ${CRITICAL_CC_CELLS} cells of CC — defend now, queue marines/tanks on every barracks/factory, see Spend Rules §A2)`;
  }
}

function formatHoarding(s: StateSummary): readonly string[] {
  const out: string[] = [];
  if (s.hoarding.minerals === 'critical') {
    out.push(
      `⚠️ MINERALS HOARDED CRITICAL (${s.minerals}) — fire MULTIPLE produce/build commands this call: workers, marines, barracks, refinery`,
    );
  } else if (s.hoarding.minerals === 'warn') {
    out.push(
      `⚠️ MINERALS HOARDED (${s.minerals}) — spend NOW: queue marines, build barracks/refinery`,
    );
  }
  if (s.hoarding.gas === 'critical') {
    out.push(
      `⚠️ GAS HOARDED CRITICAL (${s.gas}) — produce tank/medic NOW; gas hoarding is as bad as mineral hoarding`,
    );
  } else if (s.hoarding.gas === 'warn') {
    out.push(
      `⚠️ GAS HOARDED (${s.gas}) — produce tank/medic from factory/barracks`,
    );
  }
  return out;
}

function formatWorkers(w: WorkerCounts): string {
  if (w.total === 0) return 'workers: 0';
  const parts: string[] = [];
  if (w.gathering > 0) parts.push(`${w.gathering} gathering`);
  if (w.building > 0) parts.push(`${w.building} building`);
  if (w.idle > 0) {
    const idsStr = w.idleIds.length > 0 ? `: ${w.idleIds.join(',')}` : '';
    parts.push(`${w.idle} idle${idsStr}`);
  }
  const detail = parts.length === 0 ? '' : ` (${parts.join(', ')})`;
  return `workers: ${w.total}${detail}`;
}

function formatArmy(a: ArmyCounts): string {
  return `army: ${a.total} (${a.marines} marine, ${a.tanks} tank, ${a.medics} medic)`;
}

function formatBuildings(b: BuildingCounts): string {
  const segs: string[] = [];
  if (b.commandCenters > 0) segs.push(`${b.commandCenters} CC`);
  if (b.supplyDepots > 0) segs.push(`${b.supplyDepots} supplyDepot`);
  if (b.barracks > 0) segs.push(`${b.barracks} barracks`);
  if (b.factories > 0) segs.push(`${b.factories} factory`);
  if (b.turrets > 0) segs.push(`${b.turrets} turret`);
  if (b.refineries > 0) segs.push(`${b.refineries} refinery`);
  const list = segs.length > 0 ? segs.join(', ') : 'none';
  const inProg = b.underConstruction > 0 ? ` (${b.underConstruction} under construction)` : '';
  return `buildings: ${list}${inProg}`;
}

function formatThreats(t: ThreatSummary): string {
  if (t.combatUnits === 0 && t.nearestEnemyCells === null) return 'threats: none visible';
  const parts: string[] = [];
  if (t.combatUnits > 0) parts.push(`${t.combatUnits} combat unit${t.combatUnits === 1 ? '' : 's'}`);
  if (t.nearestEnemyCells !== null) parts.push(`nearest ${t.nearestEnemyCells} cells away`);
  return `threats: ${parts.join(', ')}`;
}

function formatVisibleEnemies(v: VisibleEnemySummary): string {
  if (v.total === 0) return 'visible enemies: none';
  const segs: string[] = [];
  if (v.workers > 0) segs.push(`${v.workers} worker`);
  if (v.marines > 0) segs.push(`${v.marines} marine`);
  if (v.tanks > 0) segs.push(`${v.tanks} tank`);
  if (v.buildings > 0) segs.push(`${v.buildings} building`);
  if (v.other > 0) segs.push(`${v.other} other`);
  return `visible enemies: ${segs.join(', ')}`;
}
