import { describe, expect, it } from 'vitest';
import { UNIT_PRODUCTION, spawnBuilding } from '../entities';
import { createWorld } from '../world';
import { productionSystem } from './production';

const DT = 1 / 20;

describe('production system', () => {
  it('progresses queue and spawns unit', () => {
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const def = UNIT_PRODUCTION.worker!;
    cc.productionQueue!.push({
      produces: 'worker',
      totalSeconds: def.seconds,
      remainingSeconds: def.seconds,
    });
    const before = w.entities.size;

    const ticks = Math.ceil((def.seconds + 0.5) / DT);
    for (let i = 0; i < ticks; i++) productionSystem(w, DT);

    expect(cc.productionQueue!.length).toBe(0);
    expect(w.entities.size).toBe(before + 1);
    const newest = [...w.entities.values()].pop();
    expect(newest!.kind).toBe('worker');
    expect(newest!.team).toBe('player');
  });

  it('handles multiple queued items in order', () => {
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const def = UNIT_PRODUCTION.worker!;
    for (let i = 0; i < 3; i++) {
      cc.productionQueue!.push({
        produces: 'worker',
        totalSeconds: def.seconds,
        remainingSeconds: def.seconds,
      });
    }
    const ticks = Math.ceil((def.seconds * 3 + 1) / DT);
    for (let i = 0; i < ticks; i++) productionSystem(w, DT);
    expect(cc.productionQueue!.length).toBe(0);
    const workers = [...w.entities.values()].filter((e) => e.kind === 'worker');
    expect(workers.length).toBe(3);
  });
});
