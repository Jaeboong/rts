import type { Entity } from '../../types';
import { requestPathAdjacent } from './movement';
import type { World } from '../world';

/**
 * Construction is building-paced, not worker-paced: a building under construction
 * progresses by `dt` once per tick if at least one alive player worker has
 * `command.type === 'build'` pointing at it AND is adjacent (path empty).
 *
 * Workers still own their walk-to-site logic — first pass requests an adjacent
 * path; subsequent passes are no-ops while pathing. Multiple workers on the
 * same site do NOT stack (single-rate); they wait. A worker that dies, gets
 * reassigned, or is moved away simply stops contributing — the site pauses
 * until another worker arrives. Another worker right-clicking the partially
 * built site (handled in commands.ts → chooseUnitCommand) re-issues a build
 * command and resumes progress on arrival.
 */
export function constructionSystem(world: World, dt: number): void {
  // Pass 1: workers request paths to their build target. No progress here —
  // progress is gated centrally in pass 2 so two workers can't double-rate.
  for (const e of world.entities.values()) {
    if (e.kind !== 'worker') continue;
    if (!e.command || e.command.type !== 'build') continue;

    const site = world.entities.get(e.command.buildingId);
    if (!site || site.dead) {
      e.command = null;
      e.path = null;
      continue;
    }
    if (!site.underConstruction) {
      e.command = null;
      e.path = null;
      continue;
    }
    if (e.path === null || e.path === undefined) {
      if (!requestPathAdjacent(world, e, site)) {
        e.command = null;
      }
    }
  }

  // Pass 2: per under-construction building, advance once if any builder is adjacent.
  for (const site of world.entities.values()) {
    if (!site.underConstruction) continue;
    if (site.dead) continue;
    if (!hasAdjacentBuilder(world, site)) continue;
    progressBuild(site, dt);
    if (!site.underConstruction) {
      // Completed — release any builder that was contributing.
      for (const e of world.entities.values()) {
        if (e.kind !== 'worker') continue;
        if (!e.command || e.command.type !== 'build') continue;
        if (e.command.buildingId !== site.id) continue;
        e.command = null;
        e.path = null;
      }
    }
  }
}

function hasAdjacentBuilder(world: World, site: Entity): boolean {
  for (const e of world.entities.values()) {
    if (e.kind !== 'worker') continue;
    if (e.dead || e.hp <= 0) continue;
    if (!e.command || e.command.type !== 'build') continue;
    if (e.command.buildingId !== site.id) continue;
    // "Adjacent" = path empty/null (the unit has arrived at its perimeter cell).
    if (e.path && e.path.length > 0) continue;
    return true;
  }
  return false;
}

function progressBuild(site: Entity, dt: number): void {
  const total = site.buildTotalSeconds ?? 0;
  if (total <= 0) {
    site.underConstruction = false;
    site.hp = site.hpMax;
    return;
  }
  site.buildProgress = (site.buildProgress ?? 0) + dt;
  const ratio = Math.min(1, site.buildProgress / total);
  site.hp = Math.max(1, Math.round(site.hpMax * ratio));
  if (site.buildProgress >= total) {
    site.buildProgress = total;
    site.underConstruction = false;
    site.hp = site.hpMax;
  }
}
