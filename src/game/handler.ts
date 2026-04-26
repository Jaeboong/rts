import {
  findButtonAt,
  findEnemyKindButtonAt,
  findSpeedButtonAt,
  isAiInspectButtonAt,
  type EnemyKind,
  type UIAction,
} from '../render/ui';
import {
  findEnemySelectOverlayKindAt,
  isEnemySelectOverlayActive,
} from '../render/enemy-select-overlay';
import {
  centerCameraOn,
  findMinimapClickWorldPos,
  isPointInMinimap,
} from '../render/minimap';
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
import {
  applyClick,
  applyDragBox,
  applySameKindExpand,
  clearSelection,
  pickEntityAt,
} from './selection';
import type { Entity } from '../types';

// Two clicks on the same entity within this window count as a double-click.
// 300ms matches the OS double-click default and is the StarCraft convention.
const DOUBLE_CLICK_MS = 300;

function isPlayerUnitForExpand(e: Entity): boolean {
  if (e.team !== 'player') return false;
  // enemyDummy is a 'unit' for hit-testing but is enemy-team — already filtered.
  return (
    e.kind === 'worker' ||
    e.kind === 'marine' ||
    e.kind === 'tank' ||
    e.kind === 'tank-light' ||
    e.kind === 'medic'
  );
}

export function runFrame(game: Game, _dt: number): void {
  const { input, hud, world, camera } = game;

  if (input.keyDownEdges.has('f10')) {
    game.paused = !game.paused;
  }

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
  if (edges.has('c') && !world.placement && !world.attackMode) {
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
  if (edges.has('v') && !world.placement && !world.attackMode) {
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
    // Modal startup overlay swallows all other clicks until user picks an AI.
    // Backdrop click = silent no-op; button click = swap + continue.
    if (isEnemySelectOverlayActive(hud)) {
      // In-flight start blocks further clicks until it resolves.
      if (hud.backendStartingKind !== undefined) {
        continue;
      }
      const overlayKind = findEnemySelectOverlayKindAt(
        click.x,
        click.y,
        camera.viewW,
        camera.viewH,
      );
      if (overlayKind === null) {
        continue;
      }
      const swap = (window as unknown as { __swapEnemy?: (k: EnemyKind) => string })
        .__swapEnemy;
      if (typeof swap !== 'function') {
        continue;
      }
      // Scripted = no backend → dismiss immediately. LLM kinds POST to the
      // dev plugin which spawns the backend ps1 and blocks until ready.
      if (overlayKind === 'scripted') {
        swap(overlayKind);
        hud.enemyOverlayDismissed = true;
      } else {
        hud.backendStartingKind = overlayKind;
        hud.backendStartError = undefined;
        void startBackend(overlayKind).then((result) => {
          hud.backendStartingKind = undefined;
          if (result.ok) {
            swap(overlayKind);
            hud.enemyOverlayDismissed = true;
          } else {
            hud.backendStartError = result.message || 'unknown error';
          }
        });
      }
      continue;
    }

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

    if (isAiInspectButtonAt(click.x, click.y, camera.viewW)) {
      hud.aiInspectorOpen = !hud.aiInspectorOpen;
      continue;
    }

    const enemyKind = findEnemyKindButtonAt(click.x, click.y, camera.viewW);
    if (enemyKind !== null) {
      // ui.ts is intentionally decoupled from main.ts — main.ts installs
      // __swapEnemy on window for both this handler AND devtools to call.
      const swap = (window as unknown as { __swapEnemy?: (k: EnemyKind) => string })
        .__swapEnemy;
      if (typeof swap === 'function') swap(enemyKind);
      continue;
    }

    const btn = findButtonAt(hud, click.x, click.y);
    if (btn) {
      if (btn.enabled) handleUI(game, btn.action);
      continue;
    }

    // Minimap click → pan camera to that world position. Center the viewport
    // on the corresponding world point and consume the click so it doesn't
    // also trigger world-coord selection beneath the minimap.
    const mmWorld = findMinimapClickWorldPos(
      click.x,
      click.y,
      camera.viewW,
      camera.viewH,
    );
    if (mmWorld) {
      centerCameraOn(camera, mmWorld);
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

    // Same-kind multi-select gestures (StarCraft-style):
    //   double-click on player unit         → replace with same-kind in radius
    //   ctrl+click on player unit           → replace with same-kind in radius
    //   ctrl+shift+click on player unit     → ADD same-kind in radius
    // Anything else (enemy unit, building, resource, empty) falls through to
    // existing single/shift-click logic so attack-target picking and building
    // selection don't regress.
    const hit = pickEntityAt(world, wp.x, wp.y);
    const isDoubleClick =
      hit !== null &&
      input.lastClickedEntityId === hit.id &&
      click.time - input.lastClickTime <= DOUBLE_CLICK_MS;
    const expandGesture =
      hit !== null &&
      isPlayerUnitForExpand(hit) &&
      (click.ctrl || isDoubleClick);

    if (expandGesture) {
      // ctrl+shift = additive; ctrl alone or double-click = replace
      applySameKindExpand(world, hit, click.ctrl && click.shift);
    } else {
      applyClick(world, wp.x, wp.y, click.shift);
    }

    // Stamp ALWAYS (not just on misses) so a double-click cycle resets cleanly.
    // Keep id even when null so empty-space clicks invalidate any pending double.
    input.lastClickTime = click.time;
    input.lastClickedEntityId = hit ? hit.id : null;
  }

  if (input.dragCommit) {
    // Suppress drag-select that originated inside the minimap so users can't
    // accidentally box-select underneath the panel. isPointOverHud already
    // gates edge-pan + cursor preview, but the dragCommit pipeline is
    // independent — we need an explicit guard here.
    const startedInMinimap = isPointInMinimap(
      input.dragCommit.x0,
      input.dragCommit.y0,
      camera.viewW,
      camera.viewH,
    );
    if (startedInMinimap) {
      // Treat as a single-click pan to the drag's release point — same UX as
      // SC where dragging on the minimap continuously re-centers the camera.
      const mmWorld = findMinimapClickWorldPos(
        input.dragCommit.x1,
        input.dragCommit.y1,
        camera.viewW,
        camera.viewH,
      );
      if (mmWorld) centerCameraOn(camera, mmWorld);
    } else {
      const a = screenToWorld(camera, input.dragCommit.x0, input.dragCommit.y0);
      const b = screenToWorld(camera, input.dragCommit.x1, input.dragCommit.y1);
      if (world.placement || world.attackMode) {
        // Drag during placement / attack-mode is a no-op
      } else {
        applyDragBox(world, a.x, a.y, b.x, b.y, input.dragCommit.shift);
      }
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

interface StartBackendResult {
  readonly ok: boolean;
  readonly message: string;
}

// POSTs to the vite dev plugin (vite.config.ts: aiBackendStarterPlugin) which
// spawns tools/start-{kind}.ps1 and blocks until the backend is verified live.
// Cold start can take ~90s for codex (acpx runtime warmup). Resolves with
// ok=true when the script exited 0; the caller decides what to do next.
async function startBackend(kind: 'claude' | 'codex'): Promise<StartBackendResult> {
  try {
    const res = await fetch('/api/start-backend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind }),
    });
    const data = (await res.json()) as { ok?: boolean; message?: string };
    return { ok: res.ok && data.ok === true, message: data.message ?? '' };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}
