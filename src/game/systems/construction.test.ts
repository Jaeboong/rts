import { describe, expect, it } from 'vitest';
import { spawnBuilding, spawnUnit } from '../entities';
import { cellToPx, createWorld, type World } from '../world';
import { constructionSystem } from './construction';
import { movementSystem } from './movement';

const DT = 1;
const TICK = 1 / 20;

function step(w: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    constructionSystem(w, TICK);
    movementSystem(w, TICK);
  }
}

describe('constructionSystem (building-paced, single-rate)', () => {
  it('an under-construction building with no builders does NOT progress', () => {
    const w = createWorld();
    const site = spawnBuilding(w, 'barracks', 'player', 30, 30, false);
    expect(site.underConstruction).toBe(true);
    const before = site.buildProgress ?? 0;

    constructionSystem(w, DT);
    constructionSystem(w, DT);

    expect(site.buildProgress).toBe(before);
    expect(site.underConstruction).toBe(true);
  });

  it('a worker assigned to the site progresses construction once it is adjacent', () => {
    const w = createWorld();
    const site = spawnBuilding(w, 'barracks', 'player', 30, 30, false);
    // Place worker right next to the site (cell 29, 30 sits one cell west of cellX=30).
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(28, 30));
    worker.command = { type: 'build', buildingId: site.id };

    // First tick: requestPathAdjacent fires; movement drains the path.
    step(w, 200);

    // Construction should have advanced (barracks buildSeconds=20).
    expect((site.buildProgress ?? 0)).toBeGreaterThan(0);
  });

  it('two workers on the same site progress at SAME rate as one (single-rate)', () => {
    const w = createWorld();
    const siteA = spawnBuilding(w, 'barracks', 'player', 10, 10, false);
    const siteB = spawnBuilding(w, 'barracks', 'player', 60, 60, false);

    // Site A: one builder. Site B: two builders. Both placed adjacent.
    const wA = spawnUnit(w, 'worker', 'player', cellToPx(8, 12));
    wA.command = { type: 'build', buildingId: siteA.id };

    const wB1 = spawnUnit(w, 'worker', 'player', cellToPx(58, 62));
    wB1.command = { type: 'build', buildingId: siteB.id };
    const wB2 = spawnUnit(w, 'worker', 'player', cellToPx(58, 64));
    wB2.command = { type: 'build', buildingId: siteB.id };

    // Drive movement so each worker arrives adjacent to its respective site.
    step(w, 400);

    // Both sites should have advanced; critically, B should not be ahead.
    // Allow tiny float slack from path-arrival timing differences (≤ a few ticks).
    const pA = siteA.buildProgress ?? 0;
    const pB = siteB.buildProgress ?? 0;
    const delta = Math.abs(pA - pB);
    expect(delta).toBeLessThanOrEqual(0.5);
  });

  it('worker reassignment (clear command) stops progress on the site', () => {
    const w = createWorld();
    const site = spawnBuilding(w, 'barracks', 'player', 30, 30, false);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(28, 30));
    worker.command = { type: 'build', buildingId: site.id };

    // Run enough to land adjacent and accrue some progress.
    step(w, 200);
    const accrued = site.buildProgress ?? 0;
    expect(accrued).toBeGreaterThan(0);

    // Strip the worker's command.
    worker.command = null;
    worker.path = null;

    // Drive more ticks — site must NOT advance further.
    step(w, 200);
    expect(site.buildProgress).toBe(accrued);
  });

  it('a fresh worker right-clicking the site (build command) resumes progress', () => {
    const w = createWorld();
    const site = spawnBuilding(w, 'barracks', 'player', 30, 30, false);
    // First worker leaves partway.
    const w1 = spawnUnit(w, 'worker', 'player', cellToPx(28, 30));
    w1.command = { type: 'build', buildingId: site.id };
    step(w, 200);
    const accrued = site.buildProgress ?? 0;
    expect(accrued).toBeGreaterThan(0);
    w1.command = null;
    w1.path = null;

    // Second worker arrives and takes over.
    const w2 = spawnUnit(w, 'worker', 'player', cellToPx(28, 31));
    w2.command = { type: 'build', buildingId: site.id };

    step(w, 200);
    expect((site.buildProgress ?? 0)).toBeGreaterThan(accrued);
  });

  it('completes construction → clears worker command and flips underConstruction', () => {
    const w = createWorld();
    const site = spawnBuilding(w, 'barracks', 'player', 30, 30, false);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(28, 30));
    worker.command = { type: 'build', buildingId: site.id };

    // Force-set progress near completion to avoid driving ~400 ticks.
    site.buildProgress = (site.buildTotalSeconds ?? 0) - 0.05;

    // First tick: worker picks an adjacent path. Drive enough to reach + finish.
    step(w, 200);

    expect(site.underConstruction).toBe(false);
    expect(site.hp).toBe(site.hpMax);
    expect(worker.command).toBeNull();
  });

  it('dead site clears any builder command on next tick', () => {
    const w = createWorld();
    const site = spawnBuilding(w, 'barracks', 'player', 30, 30, false);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(28, 30));
    worker.command = { type: 'build', buildingId: site.id };
    site.dead = true;

    constructionSystem(w, TICK);

    expect(worker.command).toBeNull();
    expect(worker.path).toBeNull();
  });
});
