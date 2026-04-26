import type { Entity } from '../types';
import { TICK_DT, type Game } from './loop';
import { runCollisionSystem } from './systems/collision';
import { combatSystem, hasHostileInAttackRange } from './systems/combat';
import { constructionSystem } from './systems/construction';
import { gatherSystem } from './systems/gather';
import { runHealingSystem } from './systems/healing';
import { idleAutoGatherSystem } from './systems/idle-auto-gather';
import { movementSystem, requestPath } from './systems/movement';
import { productionSystem } from './systems/production';
import { runRefinerySystem } from './systems/refinery';
import { tacticalSystem } from './systems/tactical';
import { removeEntity, setOccupancy, type World } from './world';

export function runTick(game: Game): void {
  const dt = TICK_DT;
  // Phase 49: scripted tactical/micro runs FIRST so retreat/chase decisions
  // can issue commands before driveCommands consumes them this tick. Order:
  //   tacticalSystem  → may set/clear command (retreat to CC, return to origin)
  //   driveCommands   → fresh command gets its path requested same tick
  //   movementSystem  → walks the path
  //   combatSystem    → fires (auto-acquire respects new attackTargetId rules)
  tacticalSystem(game.world);
  driveCommands(game.world);
  movementSystem(game.world, dt);
  // Auto-issues a gather command to long-idle workers BEFORE gatherSystem so
  // the freshly-set command is consumed in the same tick (init branch starts
  // the toNode walk immediately).
  idleAutoGatherSystem(game.world);
  gatherSystem(game.world, dt);
  runCollisionSystem(game.world);
  constructionSystem(game.world, dt);
  // Refinery runs after construction so a just-completed refinery starts producing the same tick.
  runRefinerySystem(game.world, dt);
  productionSystem(game.world, dt);
  combatSystem(game.world, dt);
  // Heal AFTER combat so a marine that took damage this tick still gets a same-tick "second wind".
  runHealingSystem(game.world, dt);
  cleanupDead(game.world);
}

function driveCommands(world: World): void {
  for (const e of world.entities.values()) {
    if (!isUnit(e) || !e.command) continue;
    const cmd = e.command;
    switch (cmd.type) {
      case 'move':
      case 'attackMove': {
        // attackMove engaged: hostile in fire range → let combat shoot, don't
        // re-request path. Otherwise the unit creeps forward each tick because
        // combat nullifies path after this runs.
        if (cmd.type === 'attackMove' && hasHostileInAttackRange(world, e)) {
          e.path = null;
          break;
        }
        if (e.path === null || e.path === undefined) {
          if (!requestPath(world, e, cmd.target)) {
            e.command = null;
            continue;
          }
        }
        if (e.path && e.path.length === 0) {
          e.command = null;
          e.path = null;
        }
        break;
      }
      case 'attack':
      case 'gather':
      case 'build':
        // handled by their respective systems
        break;
    }
  }
}

function cleanupDead(world: World): void {
  const toRemove: number[] = [];
  for (const e of world.entities.values()) {
    if (e.dead || e.hp <= 0) toRemove.push(e.id);
  }
  for (const id of toRemove) {
    const e = world.entities.get(id);
    if (e) releaseStampedResource(world, e);
    removeEntity(world, id);
    if (e) reapplyResourceOccupancy(world, e);
  }
}

// supplyDepot/refinery sit on top of mineralNode/gasGeyser sharing the same 5×5
// footprint. Before removing the dead building, null the back-pointer on the
// surviving resource so the renderer redraws it and gather treats it as raw again.
function releaseStampedResource(world: World, dead: Entity): void {
  if (dead.kind === 'supplyDepot' && dead.mineralNodeId !== null && dead.mineralNodeId !== undefined) {
    const node = world.entities.get(dead.mineralNodeId);
    if (node && !node.dead && node.kind === 'mineralNode') {
      node.depotId = null;
    }
  } else if (dead.kind === 'refinery' && dead.geyserId !== null && dead.geyserId !== undefined) {
    const geyser = world.entities.get(dead.geyserId);
    if (geyser && !geyser.dead && geyser.kind === 'gasGeyser') {
      geyser.refineryId = null;
    }
  }
}

// removeEntity zeros occupancy across the dead 5×5 footprint, which clobbers the
// surviving mineralNode/gasGeyser cells. Re-stamp them so pathfinding still
// treats the resource as a static obstacle.
function reapplyResourceOccupancy(world: World, dead: Entity): void {
  if (dead.kind === 'supplyDepot' && dead.mineralNodeId !== null && dead.mineralNodeId !== undefined) {
    const node = world.entities.get(dead.mineralNodeId);
    if (
      node &&
      !node.dead &&
      node.kind === 'mineralNode' &&
      node.cellX !== undefined &&
      node.cellY !== undefined &&
      node.sizeW &&
      node.sizeH
    ) {
      setOccupancy(world, node.cellX, node.cellY, node.sizeW, node.sizeH, node.id);
    }
  } else if (dead.kind === 'refinery' && dead.geyserId !== null && dead.geyserId !== undefined) {
    const geyser = world.entities.get(dead.geyserId);
    if (
      geyser &&
      !geyser.dead &&
      geyser.kind === 'gasGeyser' &&
      geyser.cellX !== undefined &&
      geyser.cellY !== undefined &&
      geyser.sizeW &&
      geyser.sizeH
    ) {
      setOccupancy(world, geyser.cellX, geyser.cellY, geyser.sizeW, geyser.sizeH, geyser.id);
    }
  }
}

function isUnit(e: Entity): boolean {
  return (
    e.kind === 'worker' ||
    e.kind === 'marine' ||
    e.kind === 'tank' ||
    e.kind === 'tank-light' ||
    e.kind === 'medic' ||
    e.kind === 'enemyDummy'
  );
}
