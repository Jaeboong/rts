import { describe, expect, it } from 'vitest';
import { runFrame } from './handler';
import { type InputState } from './input';
import type { Game } from './loop';
import { spawnBuilding, spawnUnit } from './entities';
import { cellToPx, createWorld, type World } from './world';
import type { Camera } from './camera';
import type { HUDState } from '../render/ui';

function makeInput(): InputState {
  return {
    keys: new Set(),
    mouse: { x: 0, y: 0 },
    mouseInside: false,
    leftDown: false,
    leftDownAt: null,
    clicks: [],
    rightClicks: [],
    keyDownEdges: new Set(),
    dragCommit: null,
  };
}

function makeCamera(): Camera {
  return { x: 0, y: 0, viewW: 800, viewH: 600, panSpeed: 600 };
}

function makeHud(): HUDState {
  return { fps: 0, tickCount: 0, buttons: [] };
}

function makeGame(world: World, input: InputState): Game {
  const partial = {
    canvas: undefined,
    ctx: undefined,
    world,
    camera: makeCamera(),
    input,
    hud: makeHud(),
  };
  return partial as unknown as Game;
}

describe('Esc cancels last production queue item', () => {
  it('Building with empty productionQueue + Esc → no change, no error', () => {
    const w = createWorld();
    const bx = spawnBuilding(w, 'barracks', 'player', 10, 10);
    w.selection.add(bx.id);
    const before = w.resources.player;
    const input = makeInput();
    input.keys.add('escape');
    input.keyDownEdges.add('escape');
    runFrame(makeGame(w, input), 16);
    expect(bx.productionQueue!.length).toBe(0);
    expect(w.resources.player).toBe(before);
  });

  it('Building with 3 items + Esc → 2 items remain (last popped), refund applied', () => {
    const w = createWorld();
    const bx = spawnBuilding(w, 'barracks', 'player', 10, 10);
    w.selection.add(bx.id);
    for (let i = 0; i < 3; i++) {
      bx.productionQueue!.push({
        produces: 'marine',
        totalSeconds: 15,
        remainingSeconds: 15,
      });
    }
    const before = w.resources.player;
    const input = makeInput();
    input.keys.add('escape');
    input.keyDownEdges.add('escape');
    runFrame(makeGame(w, input), 16);
    expect(bx.productionQueue!.length).toBe(2);
    expect(w.resources.player).toBe(before + 50);
  });

  it('Esc 3 times → queue empty (after last Esc the queue is [])', () => {
    const w = createWorld();
    const bx = spawnBuilding(w, 'barracks', 'player', 10, 10);
    w.selection.add(bx.id);
    for (let i = 0; i < 3; i++) {
      bx.productionQueue!.push({
        produces: 'marine',
        totalSeconds: 15,
        remainingSeconds: 15,
      });
    }
    for (let i = 0; i < 3; i++) {
      const input = makeInput();
      input.keys.add('escape');
      input.keyDownEdges.add('escape');
      runFrame(makeGame(w, input), 16);
    }
    expect(bx.productionQueue!.length).toBe(0);
  });

  it('Two CCs each with 2 items + Esc → both end at 1 item (multi-target rule)', () => {
    const w = createWorld();
    // 20×20 CCs need 20-cell separation between TLs to avoid footprint overlap.
    const c1 = spawnBuilding(w, 'commandCenter', 'player', 5, 5);
    const c2 = spawnBuilding(w, 'commandCenter', 'player', 30, 30);
    w.selection.add(c1.id);
    w.selection.add(c2.id);
    for (let i = 0; i < 2; i++) {
      c1.productionQueue!.push({
        produces: 'worker',
        totalSeconds: 12,
        remainingSeconds: 12,
      });
      c2.productionQueue!.push({
        produces: 'worker',
        totalSeconds: 12,
        remainingSeconds: 12,
      });
    }
    const input = makeInput();
    input.keys.add('escape');
    input.keyDownEdges.add('escape');
    runFrame(makeGame(w, input), 16);
    expect(c1.productionQueue!.length).toBe(1);
    expect(c2.productionQueue!.length).toBe(1);
  });

  it('placement mode active + Esc → placement cancelled, queue untouched (priority)', () => {
    const w = createWorld();
    const bx = spawnBuilding(w, 'barracks', 'player', 10, 10);
    w.selection.add(bx.id);
    bx.productionQueue!.push({
      produces: 'marine',
      totalSeconds: 15,
      remainingSeconds: 15,
    });
    w.placement = { team: 'player', buildingKind: 'barracks' };
    const input = makeInput();
    input.keys.add('escape');
    input.keyDownEdges.add('escape');
    runFrame(makeGame(w, input), 16);
    expect(w.placement).toBeNull();
    expect(bx.productionQueue!.length).toBe(1);
  });

  it('attackMode active + Esc → attackMode false, queue untouched (priority)', () => {
    const w = createWorld();
    const bx = spawnBuilding(w, 'barracks', 'player', 10, 10);
    w.selection.add(bx.id);
    bx.productionQueue!.push({
      produces: 'marine',
      totalSeconds: 15,
      remainingSeconds: 15,
    });
    w.attackMode = true;
    const input = makeInput();
    input.keys.add('escape');
    input.keyDownEdges.add('escape');
    runFrame(makeGame(w, input), 16);
    expect(w.attackMode).toBe(false);
    expect(bx.productionQueue!.length).toBe(1);
  });

  it('Esc held without edge → no queue pop (only edge triggers cancellation)', () => {
    const w = createWorld();
    const bx = spawnBuilding(w, 'barracks', 'player', 10, 10);
    w.selection.add(bx.id);
    bx.productionQueue!.push({
      produces: 'marine',
      totalSeconds: 15,
      remainingSeconds: 15,
    });
    const input = makeInput();
    input.keys.add('escape'); // held, but no edge this frame
    runFrame(makeGame(w, input), 16);
    expect(bx.productionQueue!.length).toBe(1);
  });
});

describe('S = Stop for selected units', () => {
  it("Marine with command='move' + S → command null, path null", () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    m.command = { type: 'move', target: { x: 100, y: 100 } };
    m.path = [{ x: 50, y: 50 }];
    w.selection.add(m.id);
    const input = makeInput();
    input.keyDownEdges.add('s');
    runFrame(makeGame(w, input), 16);
    expect(m.command).toBeNull();
    expect(m.path).toBeNull();
  });

  it('Worker with active gatherSubState + S → gatherSubState undefined, command null', () => {
    const w = createWorld();
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(10, 10));
    worker.command = { type: 'gather', nodeId: 99 };
    worker.gatherSubState = 'mining';
    worker.gatherTimer = 1.5;
    worker.gatherNodeId = 99;
    worker.gatherHomeId = 88;
    w.selection.add(worker.id);
    const input = makeInput();
    input.keyDownEdges.add('s');
    runFrame(makeGame(w, input), 16);
    expect(worker.command).toBeNull();
    expect(worker.gatherSubState).toBeUndefined();
    expect(worker.gatherNodeId).toBeNull();
    expect(worker.gatherHomeId).toBeNull();
  });

  it("Marine + CC in selection + S → marine stopped, CC's productionQueue unchanged (no worker produced)", () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    m.command = { type: 'move', target: { x: 100, y: 100 } };
    const cc = spawnBuilding(w, 'commandCenter', 'player', 20, 20);
    w.selection.add(m.id);
    w.selection.add(cc.id);
    const before = w.resources.player;
    const input = makeInput();
    input.keyDownEdges.add('s');
    runFrame(makeGame(w, input), 16);
    expect(m.command).toBeNull();
    expect(cc.productionQueue!.length).toBe(0);
    expect(w.resources.player).toBe(before);
  });

  it('CC alone in selection + S → worker produced (Phase 16 regression check)', () => {
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    w.selection.add(cc.id);
    const before = w.resources.player;
    const input = makeInput();
    input.keyDownEdges.add('s');
    runFrame(makeGame(w, input), 16);
    expect(cc.productionQueue!.length).toBe(1);
    expect(cc.productionQueue![0].produces).toBe('worker');
    expect(w.resources.player).toBe(before - 50);
  });

  it('Two marines, both moving + S → both stopped', () => {
    const w = createWorld();
    const m1 = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    const m2 = spawnUnit(w, 'marine', 'player', cellToPx(15, 15));
    m1.command = { type: 'move', target: { x: 100, y: 100 } };
    m2.command = { type: 'move', target: { x: 200, y: 200 } };
    m1.path = [{ x: 50, y: 50 }];
    m2.path = [{ x: 60, y: 60 }];
    w.selection.add(m1.id);
    w.selection.add(m2.id);
    const input = makeInput();
    input.keyDownEdges.add('s');
    runFrame(makeGame(w, input), 16);
    expect(m1.command).toBeNull();
    expect(m2.command).toBeNull();
    expect(m1.path).toBeNull();
    expect(m2.path).toBeNull();
  });

  it('Idle marine (command null) + S → still null, no error', () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    w.selection.add(m.id);
    const input = makeInput();
    input.keyDownEdges.add('s');
    runFrame(makeGame(w, input), 16);
    expect(m.command).toBeNull();
  });

  it('Marine + S → attackTargetId cleared', () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    m.command = { type: 'attack', targetId: 42 };
    m.attackTargetId = 42;
    w.selection.add(m.id);
    const input = makeInput();
    input.keyDownEdges.add('s');
    runFrame(makeGame(w, input), 16);
    expect(m.command).toBeNull();
    expect(m.attackTargetId).toBeNull();
  });
});

describe('Esc cancel refunds gas for gas-cost items', () => {
  it('Factory with one queued Tank + Esc → refunds 250 min + 100 gas', () => {
    const w = createWorld();
    const fac = spawnBuilding(w, 'factory', 'player', 30, 30);
    w.selection.add(fac.id);
    fac.productionQueue!.push({
      produces: 'tank',
      totalSeconds: 30,
      remainingSeconds: 30,
    });
    w.resources.player = 0;
    w.gas = 0;
    const input = makeInput();
    input.keys.add('escape');
    input.keyDownEdges.add('escape');
    runFrame(makeGame(w, input), 16);
    expect(fac.productionQueue!.length).toBe(0);
    expect(w.resources.player).toBe(250);
    expect(w.gas).toBe(100);
  });

  it('Marine cancel does NOT touch gas (no gasCost)', () => {
    const w = createWorld();
    const bx = spawnBuilding(w, 'barracks', 'player', 10, 10);
    w.selection.add(bx.id);
    bx.productionQueue!.push({
      produces: 'marine',
      totalSeconds: 15,
      remainingSeconds: 15,
    });
    w.resources.player = 0;
    w.gas = 7;
    const input = makeInput();
    input.keys.add('escape');
    input.keyDownEdges.add('escape');
    runFrame(makeGame(w, input), 16);
    expect(bx.productionQueue!.length).toBe(0);
    expect(w.resources.player).toBe(50);
    expect(w.gas).toBe(7);
  });
});
