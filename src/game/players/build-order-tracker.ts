import type { GameView } from './types';
import type { StateSummary } from './state-summary';

/**
 * Inferred build-order phase. Pure rule-based — see inferBuildOrderPhase
 * for the decision tree. Designed to be embedded directly in the LLM prompt
 * so the model has an explicit "what should I do next" anchor instead of
 * having to derive it from raw counts every call.
 */
export interface BuildOrderPhase {
  readonly currentStep: BuildStep;
  readonly nextGoal: string;
  readonly rationale: string;
}

export type BuildStep =
  | 'bootstrap'
  | 'early-econ'
  | 'tech-up-barracks'
  | 'army-build'
  | 'attack'
  | 'defend';

const TARGET_WORKERS = 8;
const BARRACKS_COST = 150;
const TARGET_MARINES = 4;
const ATTACK_TRIGGER_MARINES = 4;

/**
 * Walk a fixed priority ladder against the current summary and decide the
 * single most-pressing step. Order matters: defense pre-empts offense, attack
 * pre-empts production once the army is big enough, otherwise we cascade
 * down (bootstrap → econ → tech → army → attack).
 *
 * The branches are intentionally single-line `if`s with English rationale so
 * the LLM can read the same logic as the reader. No randomness, no hidden
 * state — same view → same phase, every call.
 */
export function inferBuildOrderPhase(
  view: GameView,
  summary: StateSummary,
): BuildOrderPhase {
  // 0a. Phase 45 — defensivePosture=critical and we are NOT obviously winning the
  // micro fight (enemy >= half our army). The state-summary classifier already
  // verified an enemy combat unit is within CRITICAL_CC_CELLS of a CC; here we
  // additionally gate on army balance so a 5v1 base poke doesn't yank a healthy
  // attacker back home. When BOTH conditions hold we demand max defensive
  // production AND active engagement — sitting on barracks while marines die at
  // the gate loses tempo regardless of step name.
  if (
    summary.defensivePosture === 'critical' &&
    summary.enemyArmySize * 2 >= summary.army.total
  ) {
    return {
      currentStep: 'defend',
      nextGoal: 'DEFEND: queue marines on EVERY barracks AND tank on every factory THIS call; attackMove all idle armed units onto the nearest enemy combat unit',
      rationale: `defensivePosture=critical (enemy at base; ${summary.enemyArmySize} enemy armed visible vs ${summary.army.total} ours). Spend every mineral on barracks-produced units and engage with everything — no rally hand-waving`,
    };
  }

  // 0b. Hard pre-empt: enemy combat unit at our doorstep — call defense.
  if (
    summary.threats.combatUnits > 0 &&
    summary.threats.nearestEnemyCells !== null &&
    summary.threats.nearestEnemyCells <= 18 &&
    summary.army.total < ATTACK_TRIGGER_MARINES
  ) {
    return {
      currentStep: 'defend',
      nextGoal: 'PULL workers + every army unit to the threat NOW; attackMove on the closest enemy combat unit',
      rationale: `${summary.threats.combatUnits} enemy combat unit(s) within ${summary.threats.nearestEnemyCells} cells, our army=${summary.army.total} below attack threshold — every idle unit is a wasted unit`,
    };
  }

  // 1. No CC at all — we have nothing to bootstrap from.
  if (summary.buildings.commandCenters === 0) {
    return {
      currentStep: 'bootstrap',
      nextGoal: 'SURVIVE — find any worker and gather; pray the CC respawns',
      rationale: 'no commandCenter detected; production gated',
    };
  }

  // 2. Worker count below target → make more workers (assumes a producing CC).
  if (summary.workers.total < TARGET_WORKERS) {
    return {
      currentStep: 'early-econ',
      nextGoal: `QUEUE 2+ workers immediately on the CC (have ${summary.workers.total}, target ${TARGET_WORKERS}); refinery should be up by tick 1200`,
      rationale: `worker count ${summary.workers.total} < ${TARGET_WORKERS}. Spend ALL idle minerals on workers + queue refinery on a gasGeyser before tank/medic gate; do not sit on minerals waiting for "later"`,
    };
  }

  // 3. Have workers, no barracks (and not under construction), enough minerals.
  if (
    summary.buildings.barracks === 0 &&
    summary.minerals >= BARRACKS_COST
  ) {
    return {
      currentStep: 'tech-up-barracks',
      nextGoal: 'BUILD barracks NOW near the CC; if a refinery is not up yet, schedule it on the next tick',
      rationale: `${summary.workers.total} workers gathered, ${summary.minerals}M >= ${BARRACKS_COST}M required. No barracks → no marines → no army. Issue the build this call.`,
    };
  }

  // 4. Barracks exists (any state) but army still small → keep producing.
  if (
    summary.buildings.barracks > 0 &&
    summary.army.marines < TARGET_MARINES
  ) {
    const built = summary.buildings.barracks - summary.buildings.underConstruction;
    if (built > 0) {
      return {
        currentStep: 'army-build',
        nextGoal: `QUEUE marines on EVERY ready barracks until army >= ${TARGET_MARINES} (have ${summary.army.marines})`,
        rationale: `${built} barracks ready; idle barracks = wasted seconds. Fill the queue this call.`,
      };
    }
    return {
      currentStep: 'tech-up-barracks',
      nextGoal: 'wait for barracks to finish construction (do NOT idle workers — keep gathering)',
      rationale: `${summary.buildings.underConstruction} barracks still under construction`,
    };
  }

  // 5. Army size >= attack threshold — march on the enemy base.
  if (summary.army.total >= ATTACK_TRIGGER_MARINES) {
    return {
      currentStep: 'attack',
      nextGoal: 'attackMove the marshalled army at the nearest visible enemy structure THIS call',
      rationale: `army=${summary.army.total} >= ${ATTACK_TRIGGER_MARINES}; press the attack — sitting on marines loses the tempo war`,
    };
  }

  // Fallback: keep gathering (we somehow have no work to do).
  void view;
  return {
    currentStep: 'early-econ',
    nextGoal: 'keep workers on minerals; if minerals > 200, BUILD something this call',
    rationale: 'no rule matched; default to econ — never let minerals pool',
  };
}

/**
 * Pretty-print the phase for prompt embedding.
 */
export function formatBuildOrderPhase(p: BuildOrderPhase): string {
  return [
    `Step: ${p.currentStep}`,
    `Next goal: ${p.nextGoal}`,
    `Rationale: ${p.rationale}`,
  ].join('\n');
}
