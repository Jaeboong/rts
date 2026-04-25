import type { Entity, EntityId, Vec2 } from '../../types';
import { spawnUnit } from '../entities';
import { CELL } from '../../types';
import { clampMoveTargetToWalkable } from '../commands';
import {
  cellIndex,
  inBounds,
  isCellBlocked,
  pxToCell,
  type World,
} from '../world';

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
        unit.command = chooseRallyCommand(world, unit, e.rallyPoint);
      }
      e.productionQueue.shift();
    }
  }
}

function chooseRallyCommand(
  world: World,
  unit: Entity,
  rally: Vec2,
):
  | { type: 'move'; target: Vec2 }
  | { type: 'gather'; nodeId: EntityId } {
  const cell = pxToCell(rally);
  const occupantId = cellOccupant(world, cell.x, cell.y);
  const occupant = occupantId !== null ? world.entities.get(occupantId) : null;

  if (occupant && occupant.kind === 'mineralNode' && unit.kind === 'worker') {
    return { type: 'gather', nodeId: occupant.id };
  }
  if (occupant) {
    return {
      type: 'move',
      target: clampMoveTargetToWalkable(world, { x: rally.x, y: rally.y }),
    };
  }
  return { type: 'move', target: { ...rally } };
}

function cellOccupant(world: World, cx: number, cy: number): EntityId | null {
  if (!inBounds(cx, cy)) return null;
  const id = world.occupancy[cellIndex(cx, cy)];
  return id === -1 ? null : id;
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
