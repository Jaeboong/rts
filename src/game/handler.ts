import { findButtonAt, type UIAction } from '../render/ui';
import { screenToWorld } from './camera';
import { issueRightClick, issueUIAction } from './commands';
import type { Game } from './loop';
import { applyClick, applyDragBox, clearSelection } from './selection';

export function runFrame(game: Game, _dt: number): void {
  const { input, hud, world, camera } = game;

  // Escape cancels placement
  if (input.keys.has('escape') && world.placement) {
    world.placement = null;
  }

  for (const click of input.clicks) {
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

    applyClick(world, wp.x, wp.y, click.shift);
  }

  if (input.dragCommit) {
    const a = screenToWorld(camera, input.dragCommit.x0, input.dragCommit.y0);
    const b = screenToWorld(camera, input.dragCommit.x1, input.dragCommit.y1);
    if (world.placement) {
      // Drag during placement is a no-op
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
    issueRightClick(game, wp.x, wp.y, rc.shift);
  }

  // Click on empty (no shift, no entity) is handled inside applyClick by
  // detecting hit. If nothing hit, applyClick clears selection.
  void clearSelection;
}

function handleUI(game: Game, action: UIAction): void {
  issueUIAction(game, action);
}
