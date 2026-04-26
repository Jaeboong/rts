import { describe, expect, it } from 'vitest';
import { UNIT_DEFS } from '../balance';
import { spawnBuilding, spawnUnit } from '../entities';
import { cellToPx, createWorld } from '../world';
import { runCollisionSystem } from './collision';

const EPS = 1e-4;

function distance(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

describe('collision system — separation push', () => {
  it('two marines exactly overlapping separate to at least rA+rB', () => {
    const w = createWorld();
    const a = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    const b = spawnUnit(w, 'marine', 'player', { ...a.pos });
    const r = UNIT_DEFS.marine.radius;

    runCollisionSystem(w);

    const d = distance(a.pos.x, a.pos.y, b.pos.x, b.pos.y);
    expect(d).toBeGreaterThanOrEqual(r + r - EPS);
  });

  it('two marines slightly overlapping separate to exactly rA+rB', () => {
    const w = createWorld();
    const r = UNIT_DEFS.marine.radius;
    const a = spawnUnit(w, 'marine', 'player', { x: 100, y: 100 });
    // Place B so they overlap by 4 px along x-axis.
    const b = spawnUnit(w, 'marine', 'player', { x: 100 + 2 * r - 4, y: 100 });

    runCollisionSystem(w);

    const d = distance(a.pos.x, a.pos.y, b.pos.x, b.pos.y);
    expect(d).toBeCloseTo(2 * r, 5);
  });

  it('two marines straddling a bucket boundary still separate to exactly rA+rB (Phase 46.5 dedupe)', () => {
    // Spatial-grid bucket = 64 px. Both units' AABBs span the x=64 boundary,
    // so each is inserted into TWO buckets and appears twice in the other's
    // broad-phase candidate list. Without per-`a` dedupe this caused 2× overlap
    // application and units flew apart to ~2× the correct distance.
    const w = createWorld();
    const r = UNIT_DEFS.marine.radius;
    const a = spawnUnit(w, 'marine', 'player', { x: 60, y: 100 });
    const b = spawnUnit(w, 'marine', 'player', { x: 62, y: 100 });

    runCollisionSystem(w);

    const d = distance(a.pos.x, a.pos.y, b.pos.x, b.pos.y);
    expect(d).toBeCloseTo(2 * r, 5);
  });

  it('two marines at exactly rA+rB do not move', () => {
    const w = createWorld();
    const r = UNIT_DEFS.marine.radius;
    const a = spawnUnit(w, 'marine', 'player', { x: 100, y: 100 });
    const b = spawnUnit(w, 'marine', 'player', { x: 100 + 2 * r, y: 100 });
    const beforeA = { ...a.pos };
    const beforeB = { ...b.pos };

    runCollisionSystem(w);

    expect(a.pos.x).toBeCloseTo(beforeA.x, 9);
    expect(a.pos.y).toBeCloseTo(beforeA.y, 9);
    expect(b.pos.x).toBeCloseTo(beforeB.x, 9);
    expect(b.pos.y).toBeCloseTo(beforeB.y, 9);
  });

  it('two marines far apart do not move', () => {
    const w = createWorld();
    const a = spawnUnit(w, 'marine', 'player', cellToPx(5, 5));
    const b = spawnUnit(w, 'marine', 'player', cellToPx(40, 40));
    const beforeA = { ...a.pos };
    const beforeB = { ...b.pos };

    runCollisionSystem(w);

    expect(a.pos).toEqual(beforeA);
    expect(b.pos).toEqual(beforeB);
  });

  it('both active-gather workers overlapping do not separate (both exempt)', () => {
    const w = createWorld();
    const a = spawnUnit(w, 'worker', 'player', { x: 100, y: 100 });
    const b = spawnUnit(w, 'worker', 'player', { x: 105, y: 100 });
    a.gatherSubState = 'mining';
    b.gatherSubState = 'mining';
    const beforeA = { ...a.pos };
    const beforeB = { ...b.pos };

    runCollisionSystem(w);

    expect(a.pos).toEqual(beforeA);
    expect(b.pos).toEqual(beforeB);
  });

  it('idle worker + marine overlapping → symmetric separation (each moves overlap/2)', () => {
    const w = createWorld();
    const rW = UNIT_DEFS.worker.radius;
    const rM = UNIT_DEFS.marine.radius;
    const overlap = 4;
    const worker = spawnUnit(w, 'worker', 'player', { x: 100, y: 100 });
    const marine = spawnUnit(w, 'marine', 'player', {
      x: 100 + rW + rM - overlap,
      y: 100,
    });
    expect(worker.gatherSubState).toBeUndefined();
    const beforeW = { ...worker.pos };
    const beforeM = { ...marine.pos };

    runCollisionSystem(w);

    expect(worker.pos.x).toBeCloseTo(beforeW.x - overlap / 2, 5);
    expect(worker.pos.y).toBeCloseTo(beforeW.y, 5);
    expect(marine.pos.x).toBeCloseTo(beforeM.x + overlap / 2, 5);
    expect(marine.pos.y).toBeCloseTo(beforeM.y, 5);
  });

  it('active-gather worker + marine overlapping → worker stays, marine moves full overlap', () => {
    const w = createWorld();
    const rW = UNIT_DEFS.worker.radius;
    const rM = UNIT_DEFS.marine.radius;
    const overlap = 4;
    const worker = spawnUnit(w, 'worker', 'player', { x: 100, y: 100 });
    const marine = spawnUnit(w, 'marine', 'player', {
      x: 100 + rW + rM - overlap,
      y: 100,
    });
    worker.gatherSubState = 'toNode';
    const beforeW = { ...worker.pos };
    const beforeM = { ...marine.pos };

    runCollisionSystem(w);

    expect(worker.pos.x).toBeCloseTo(beforeW.x, 9);
    expect(worker.pos.y).toBeCloseTo(beforeW.y, 9);
    expect(marine.pos.x).toBeCloseTo(beforeM.x + overlap, 5);
    expect(marine.pos.y).toBeCloseTo(beforeM.y, 5);
    const d = distance(worker.pos.x, worker.pos.y, marine.pos.x, marine.pos.y);
    expect(d).toBeCloseTo(rW + rM, 5);
  });

  it('active-gather worker + idle worker overlapping → active stays, idle moves full', () => {
    const w = createWorld();
    const r = UNIT_DEFS.worker.radius;
    const overlap = 4;
    const active = spawnUnit(w, 'worker', 'player', { x: 200, y: 200 });
    const idle = spawnUnit(w, 'worker', 'player', {
      x: 200 + 2 * r - overlap,
      y: 200,
    });
    active.gatherSubState = 'depositing';
    expect(idle.gatherSubState).toBeUndefined();
    const beforeActive = { ...active.pos };
    const beforeIdle = { ...idle.pos };

    runCollisionSystem(w);

    expect(active.pos.x).toBeCloseTo(beforeActive.x, 9);
    expect(active.pos.y).toBeCloseTo(beforeActive.y, 9);
    expect(idle.pos.x).toBeCloseTo(beforeIdle.x + overlap, 5);
    expect(idle.pos.y).toBeCloseTo(beforeIdle.y, 5);
  });

  it('buildings do not participate in collision', () => {
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    // Place a marine on top of the CC center; building shouldn't move.
    const marine = spawnUnit(w, 'marine', 'player', { ...cc.pos });
    const beforeCC = { ...cc.pos };

    runCollisionSystem(w);

    expect(cc.pos).toEqual(beforeCC);
    // Marine also doesn't move because the CC isn't a participant.
    // Only verify the building stayed put — that's the contract.
    expect(marine.id).toBeDefined();
  });
});
