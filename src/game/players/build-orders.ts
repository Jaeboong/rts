import type { BuildingKind, UnitKind } from '../../types';

/**
 * Tier 3 build order steps. The state machine in scripted-ai.ts walks this
 * array in order; each step waits until both its precondition (resources +
 * `tickAfterPrev` debounce) is satisfied AND its effect (build/produce/wave)
 * has actually been issued before advancing to the next index.
 *
 * Time unit is tick (20Hz). Mixing seconds and ticks risks determinism drift,
 * so every timing constant in this file is in ticks.
 */
export interface BuildBuildingStep {
  readonly action: 'build';
  readonly kind: BuildingKind;
  readonly minMinerals?: number;
  readonly tickAfterPrev?: number;
}

export interface ProduceUnitStep {
  readonly action: 'produce';
  readonly kind: UnitKind;
  readonly producer: BuildingKind;
  readonly minMinerals?: number;
  readonly tickAfterPrev?: number;
}

export interface WaveStep {
  readonly action: 'wave';
  readonly composition: { readonly marine: number };
  readonly minMembers: number;
  readonly tickAfterPrev?: number;
  // Once the very first wave fires the state machine stops advancing; further
  // waves are scheduled by strategy.shouldDispatchWave on a periodic cadence.
  readonly repeatEveryTicks: number;
}

export type BuildStep = BuildBuildingStep | ProduceUnitStep | WaveStep;

// Tier-3 wave cadence (ticks). 30s at 20Hz.
export const WAVE_REPEAT_TICKS = 600;

// Min idle marines before we'll dispatch a wave.
export const WAVE_MIN_SIZE = 4;

export const TIER3_BUILD_ORDER: readonly BuildStep[] = [
  // Stamp the supplyDepot immediately (cost 0; gating is structural — needs an
  // unclaimed mineralNode near the CC). 10s buildSeconds means workers can keep
  // gathering against the new depot by the time minerals start flowing in.
  { action: 'build', kind: 'supplyDepot' },
  // Barracks costs 150 minerals + 20s build. With 250 starting + 2 workers
  // (~2 minerals/sec on a fresh node) we expect to clear the gate around
  // tick ~0 (already affordable) and the barracks to complete near tick ~400 (20s).
  { action: 'build', kind: 'barracks', minMinerals: 150 },
  // Queue first marine right after barracks goes up. Each marine costs 50.
  { action: 'produce', kind: 'marine', producer: 'barracks', minMinerals: 50 },
  { action: 'produce', kind: 'marine', producer: 'barracks', minMinerals: 50 },
  { action: 'produce', kind: 'marine', producer: 'barracks', minMinerals: 50 },
  { action: 'produce', kind: 'marine', producer: 'barracks', minMinerals: 50 },
  // First wave fires once we have 4 idle marines; subsequent waves scheduled
  // by strategy.shouldDispatchWave every WAVE_REPEAT_TICKS.
  {
    action: 'wave',
    composition: { marine: WAVE_MIN_SIZE },
    minMembers: WAVE_MIN_SIZE,
    repeatEveryTicks: WAVE_REPEAT_TICKS,
  },
];
