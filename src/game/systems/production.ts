import type { Entity, Vec2 } from '../../types';
import { spawnUnit } from '../entities';
import { CELL } from '../../types';
import { isCellBlocked, type World } from '../world';

export function productionSystem(world: World, dt: number): void {
  for (const e of world.entities.values()) {
    if (!e.productionQueue || e.productionQueue.length === 0) continue;
    if (e.underConstruction) continue;
    const head = e.productionQueue[0];
    head.remainingSeconds -= dt;
    if (head.remainingSeconds <= 0) {
      const spawnAt = findSpawnCell(world, e);
      if (!spawnAt) {
        // Hold at 0 until space opens up
        head.remainingSeconds = 0;
        continue;
      }
      const unit = spawnUnit(world, head.produces, e.team, spawnAt);
      if (e.rallyPoint) {
        unit.command = { type: 'move', target: { ...e.rallyPoint } };
      }
      e.productionQueue.shift();
    }
  }
}

function findSpawnCell(world: World, building: Entity): Vec2 | null {
  if (
    building.cellX === undefined ||
    building.cellY === undefined ||
    !building.sizeW ||
    !building.sizeH
  ) {
    return null;
  }
  const candidates: Array<{ x: number; y: number }> = [];
  for (
    let x = building.cellX - 1;
    x <= building.cellX + building.sizeW;
    x++
  ) {
    candidates.push({ x, y: building.cellY + building.sizeH });
    candidates.push({ x, y: building.cellY - 1 });
  }
  for (let y = building.cellY; y < building.cellY + building.sizeH; y++) {
    candidates.push({ x: building.cellX - 1, y });
    candidates.push({ x: building.cellX + building.sizeW, y });
  }
  for (const c of candidates) {
    if (!isCellBlocked(world, c.x, c.y)) {
      return { x: c.x * CELL + CELL / 2, y: c.y * CELL + CELL / 2 };
    }
  }
  return null;
}
