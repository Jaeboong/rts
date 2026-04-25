import type { Entity } from '../../types';
import { requestPathAdjacent } from './movement';
import type { World } from '../world';

export function constructionSystem(world: World, dt: number): void {
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
      // Already complete — clear command
      e.command = null;
      e.path = null;
      continue;
    }

    if (e.path === null || e.path === undefined) {
      if (!requestPathAdjacent(world, e, site)) {
        e.command = null;
        continue;
      }
    }

    // If still en route, do nothing this tick
    if (e.path && e.path.length > 0) continue;

    // Adjacent — contribute build progress
    progressBuild(site, dt);

    if (!site.underConstruction) {
      // Completed
      e.command = null;
      e.path = null;
    }
  }
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
