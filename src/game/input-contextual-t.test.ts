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
    lastClickTime: 0,
    lastClickedEntityId: null,
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

describe('contextual T hotkey (Worker→Turret, Factory→Tank)', () => {
  it("Factory only selected + 't' edge → tank queued (no turret placement)", () => {
    const w = createWorld();
    const fac = spawnBuilding(w, 'factory', 'player', 30, 30);
    w.selection.add(fac.id);
    w.resources.player = 1000;
    w.gas.player = 200;
    const input = makeInput();
    input.keyDownEdges.add('t');
    runFrame(makeGame(w, input), 16);
    expect(w.placement).toBeNull();
    expect(fac.productionQueue!.length).toBe(1);
    expect(fac.productionQueue![0].produces).toBe('tank');
    expect(w.resources.player).toBe(1000 - 250);
    expect(w.gas.player).toBe(200 - 100);
  });

  it("Worker + Factory both selected + 't' → Worker wins (turret placement, no tank queued)", () => {
    const w = createWorld();
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(10, 10));
    const fac = spawnBuilding(w, 'factory', 'player', 30, 30);
    w.selection.add(worker.id);
    w.selection.add(fac.id);
    w.resources.player = 1000;
    w.gas.player = 200;
    const input = makeInput();
    input.keyDownEdges.add('t');
    runFrame(makeGame(w, input), 16);
    expect(w.placement).not.toBeNull();
    expect(w.placement!.buildingKind).toBe('turret');
    expect(fac.productionQueue!.length).toBe(0);
  });

  it("Factory selected + 't' but insufficient gas → no tank queued", () => {
    const w = createWorld();
    const fac = spawnBuilding(w, 'factory', 'player', 30, 30);
    w.selection.add(fac.id);
    w.resources.player = 1000;
    w.gas.player = 50;
    const input = makeInput();
    input.keyDownEdges.add('t');
    runFrame(makeGame(w, input), 16);
    expect(fac.productionQueue!.length).toBe(0);
    expect(w.resources.player).toBe(1000);
    expect(w.gas.player).toBe(50);
  });
});
