import type { World } from '../world';

const GAS_PER_SECOND = 5;

// Active refineries accumulate fractional gas; integer overflow is added to
// the owning team's gas pool each tick. Both teams produce — Phase 43 removed
// the player-only restriction so the AI must build a refinery to access gas.
export function runRefinerySystem(world: World, dt: number): void {
  for (const e of world.entities.values()) {
    if (e.kind !== 'refinery') continue;
    if (e.underConstruction) continue;
    const acc = (e.gasAccumulator ?? 0) + GAS_PER_SECOND * dt;
    const whole = Math.floor(acc);
    if (whole > 0) {
      world.gas[e.team] += whole;
      e.gasAccumulator = acc - whole;
    } else {
      e.gasAccumulator = acc;
    }
  }
}
