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

describe("'l' hotkey (Factory → tank-light)", () => {
  it("Factory selected + 'l' edge → tank-light queued (120 min + 30 gas deducted)", () => {
    const w = createWorld();
    const fac = spawnBuilding(w, 'factory', 'player', 30, 30);
    w.selection.add(fac.id);
    w.resources.player = 500;
    w.gas = 100;
    const input = makeInput();
    input.keyDownEdges.add('l');
    runFrame(makeGame(w, input), 16);
    expect(fac.productionQueue!.length).toBe(1);
    expect(fac.productionQueue![0].produces).toBe('tank-light');
    expect(w.resources.player).toBe(500 - 120);
    expect(w.gas).toBe(100 - 30);
  });

  it("Worker selected + 'l' edge → no-op (Worker is not a producer)", () => {
    const w = createWorld();
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(10, 10));
    w.selection.add(worker.id);
    const before = { min: w.resources.player, gas: w.gas };
    const input = makeInput();
    input.keyDownEdges.add('l');
    runFrame(makeGame(w, input), 16);
    expect(w.placement).toBeNull();
    expect(w.resources.player).toBe(before.min);
    expect(w.gas).toBe(before.gas);
  });

  it("Mixed (Factory + Marine) + 'l' edge → tank-light queued from Factory only", () => {
    const w = createWorld();
    const fac = spawnBuilding(w, 'factory', 'player', 30, 30);
    const marine = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    w.selection.add(fac.id);
    w.selection.add(marine.id);
    w.resources.player = 500;
    w.gas = 100;
    const input = makeInput();
    input.keyDownEdges.add('l');
    runFrame(makeGame(w, input), 16);
    expect(fac.productionQueue!.length).toBe(1);
    expect(fac.productionQueue![0].produces).toBe('tank-light');
    expect(w.resources.player).toBe(500 - 120);
    expect(w.gas).toBe(100 - 30);
  });

  it("placement-mode active + 'l' → no-op", () => {
    const w = createWorld();
    const fac = spawnBuilding(w, 'factory', 'player', 30, 30);
    w.selection.add(fac.id);
    w.placement = { team: 'player', buildingKind: 'barracks' };
    w.resources.player = 500;
    w.gas = 100;
    const input = makeInput();
    input.keyDownEdges.add('l');
    runFrame(makeGame(w, input), 16);
    expect(fac.productionQueue!.length).toBe(0);
    expect(w.resources.player).toBe(500);
    expect(w.gas).toBe(100);
    expect(w.placement).not.toBeNull();
  });

  it("attackMode active + 'l' → no-op", () => {
    const w = createWorld();
    const fac = spawnBuilding(w, 'factory', 'player', 30, 30);
    w.selection.add(fac.id);
    w.attackMode = true;
    w.resources.player = 500;
    w.gas = 100;
    const input = makeInput();
    input.keyDownEdges.add('l');
    runFrame(makeGame(w, input), 16);
    expect(fac.productionQueue!.length).toBe(0);
    expect(w.resources.player).toBe(500);
    expect(w.gas).toBe(100);
    expect(w.attackMode).toBe(true);
  });
});
