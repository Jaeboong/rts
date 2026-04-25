import { findButtonAt, findSpeedButtonAt, type UIAction } from '../render/ui';
import { screenToWorld } from './camera';
import {
  beginPlacementForWorker,
  cancelLastProductionOnAllSelected,
  enqueueProductionOnAllSelected,
  exitAttackMode,
  issueAttackModeClick,
  issueRightClick,
  issueUIAction,
  selectionHasAnyUnit,
  stopAllSelectedUnits,
  tryEnterAttackMode,
} from './commands';
import type { Game } from './loop';
import { applyClick, applyDragBox, clearSelection } from './selection';

export function runFrame(game: Game, _dt: number): void {
  const { input, hud, world, camera } = game;

  if (input.keys.has('escape')) {
    if (world.placement) {
      world.placement = null;
    } else if (world.attackMode) {
      exitAttackMode(world);
    } else if (input.keyDownEdges.has('escape')) {
      // Edge-only so holding Esc doesn't drain the queue in one frame
      cancelLastProductionOnAllSelected(world);
    }
  }

  if (input.keyDownEdges.has('a') && !world.placement) {
    tryEnterAttackMode(world);
  }

  // Production / build-placement hotkeys. Each re-checks mode so a successful 'b' on
  // the same frame as 'c' still suppresses 'c' rather than overwriting placement.
  const edges = input.keyDownEdges;
  if (edges.has('m') && !world.placement && !world.attackMode) {
    enqueueProductionOnAllSelected(world, 'marine');
  }
  if (edges.has('u') && !world.placement && !world.attackMode) {
    enqueueProductionOnAllSelected(world, 'medic');
  }
  if (edges.has('l') && !world.placement && !world.attackMode) {
    enqueueProductionOnAllSelected(world, 'tank-light');
  }
  if (edges.has('s') && !world.placement && !world.attackMode) {
    // Units in selection take priority — S = Stop. CC-only selection still produces.
    if (selectionHasAnyUnit(world)) {
      stopAllSelectedUnits(world);
    } else {
      enqueueProductionOnAllSelected(world, 'worker');
    }
  }
  if (edges.has('b') && !world.placement && !world.attackMode) {
    beginPlacementForWorker(world, 'barracks');
  }
  if (edges.has('c') && !world.placement && !world.attackMode) {
    beginPlacementForWorker(world, 'commandCenter');
  }
  if (edges.has('r') && !world.placement && !world.attackMode) {
    beginPlacementForWorker(world, 'refinery');
  }
  if (edges.has('f') && !world.placement && !world.attackMode) {
    beginPlacementForWorker(world, 'factory');
  }
  if (edges.has('d') && !world.placement && !world.attackMode) {
    beginPlacementForWorker(world, 'supplyDepot');
  }
  // Contextual T: Worker → Turret placement (if any worker selected). If no Worker but
  // a Factory is selected, T queues a Tank instead. Worker+Factory → Worker wins.
  if (edges.has('t') && !world.placement && !world.attackMode) {
    if (!beginPlacementForWorker(world, 'turret')) {
      enqueueProductionOnAllSelected(world, 'tank');
    }
  }

  for (const click of input.clicks) {
    const speed = findSpeedButtonAt(
      click.x,
      click.y,
      camera.viewW,
      camera.viewH,
    );
    if (speed !== null) {
      game.speedFactor = speed;
      continue;
    }

    const btn = findButtonAt(hud, click.x, click.y);
    if (btn) {
      if (btn.enabled) handleUI(game, btn.action);
      continue;
    }

    const wp = screenToWorld(camera, click.x, click.y);

    if (world.placement) {
      issueUIAction(game, {
        type: 'confirmPlacement',
        x: wp.x,
        y: wp.y,
      });
      continue;
    }

    if (world.attackMode) {
      issueAttackModeClick(game, wp.x, wp.y);
      exitAttackMode(world);
      continue;
    }

    applyClick(world, wp.x, wp.y, click.shift);
  }

  if (input.dragCommit) {
    const a = screenToWorld(camera, input.dragCommit.x0, input.dragCommit.y0);
    const b = screenToWorld(camera, input.dragCommit.x1, input.dragCommit.y1);
    if (world.placement || world.attackMode) {
      // Drag during placement / attack-mode is a no-op
    } else {
      applyDragBox(world, a.x, a.y, b.x, b.y, input.dragCommit.shift);
    }
  }

  for (const rc of input.rightClicks) {
    const wp = screenToWorld(camera, rc.x, rc.y);
    if (world.placement) {
      world.placement = null;
      continue;
    }
    if (world.attackMode) {
      exitAttackMode(world);
      continue;
    }
    issueRightClick(game, wp.x, wp.y, rc.shift);
  }

  // Click on empty (no shift, no entity) is handled inside applyClick by
  // detecting hit. If nothing hit, applyClick clears selection.
  void clearSelection;
}

function handleUI(game: Game, action: UIAction): void {
  issueUIAction(game, action);
}
