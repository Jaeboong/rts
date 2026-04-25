import type { World } from '../world';

const GAS_PER_SECOND = 5;

// Active refineries accumulate fractional gas; integer overflow is added to world.gas each tick.
export function runRefinerySystem(world: World, dt: number): void {
  for (const e of world.entities.values()) {
    if (e.kind !== 'refinery') continue;
    if (e.underConstruction) continue;
    if (e.team !== 'player') continue;
    const acc = (e.gasAccumulator ?? 0) + GAS_PER_SECOND * dt;
    const whole = Math.floor(acc);
    if (whole > 0) {
      world.gas += whole;
      e.gasAccumulator = acc - whole;
    } else {
      e.gasAccumulator = acc;
    }
  }
}
