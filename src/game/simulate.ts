import type { Entity } from '../types';
import { TICK_DT, type Game } from './loop';
import { runCollisionSystem } from './systems/collision';
import { combatSystem, hasHostileInAttackRange } from './systems/combat';
import { constructionSystem } from './systems/construction';
import { gatherSystem } from './systems/gather';
import { runHealingSystem } from './systems/healing';
import { movementSystem, requestPath } from './systems/movement';
import { productionSystem } from './systems/production';
import { runRefinerySystem } from './systems/refinery';
import { removeEntity, type World } from './world';

export function runTick(game: Game): void {
  const dt = TICK_DT;
  driveCommands(game.world);
  movementSystem(game.world, dt);
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
  for (const id of toRemove) removeEntity(world, id);
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
