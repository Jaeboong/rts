import { describe, expect, it } from 'vitest';
import { runFrame } from './handler';
import { consumeFrame, type InputState } from './input';
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

// runFrame doesn't read ctx/canvas; provide a stub Game keeping only the fields
// runFrame actually uses, while satisfying the Game interface via `unknown`.
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

describe('input keyDownEdges', () => {
  it('consumeFrame clears edges', () => {
    const input = makeInput();
    input.keyDownEdges.add('a');
    input.clicks.push({ x: 1, y: 2, shift: false, ctrl: false, time: 0 });
    consumeFrame(input);
    expect(input.keyDownEdges.size).toBe(0);
    expect(input.clicks.length).toBe(0);
  });
});

describe('attack-mode flow via runFrame', () => {
  it("'a' edge with selection >= 1 enters attackMode", () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    w.selection.add(m.id);
    const input = makeInput();
    input.keyDownEdges.add('a');
    runFrame(makeGame(w, input), 16);
    expect(w.attackMode).toBe(true);
  });

  it("'a' edge with empty selection does NOT enter attackMode", () => {
    const w = createWorld();
    const input = makeInput();
    input.keyDownEdges.add('a');
    runFrame(makeGame(w, input), 16);
    expect(w.attackMode).toBe(false);
  });

  it("'a' edge while placement is active is ignored", () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    w.selection.add(m.id);
    w.placement = { team: 'player', buildingKind: 'barracks' };
    const input = makeInput();
    input.keyDownEdges.add('a');
    runFrame(makeGame(w, input), 16);
    expect(w.attackMode).toBe(false);
  });

  it('Esc while attackMode true → exits mode', () => {
    const w = createWorld();
    w.attackMode = true;
    const input = makeInput();
    input.keys.add('escape');
    runFrame(makeGame(w, input), 16);
    expect(w.attackMode).toBe(false);
  });

  it('right-click while attackMode true → exits mode without issuing command', () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    w.selection.add(m.id);
    w.attackMode = true;
    const input = makeInput();
    input.rightClicks.push({ x: 200, y: 200, shift: false });
    runFrame(makeGame(w, input), 16);
    expect(w.attackMode).toBe(false);
    expect(m.command).toBeNull();
  });

  it('left-click in attackMode issues attackMove on empty ground and exits mode', () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    w.selection.add(m.id);
    w.attackMode = true;
    const input = makeInput();
    input.clicks.push({ x: 400, y: 400, shift: false, ctrl: false, time: 0 });
    runFrame(makeGame(w, input), 16);
    expect(w.attackMode).toBe(false);
    expect(m.command).not.toBeNull();
    expect(m.command!.type).toBe('attackMove');
    if (m.command && m.command.type === 'attackMove') {
      expect(m.command.target.x).toBe(400);
      expect(m.command.target.y).toBe(400);
    }
  });

  it('left-click on enemy in attackMode issues attack with target id', () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    const enemy = spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(20, 20));
    w.selection.add(m.id);
    w.attackMode = true;
    const input = makeInput();
    input.clicks.push({ x: enemy.pos.x, y: enemy.pos.y, shift: false, ctrl: false, time: 0 });
    runFrame(makeGame(w, input), 16);
    expect(w.attackMode).toBe(false);
    expect(m.command).not.toBeNull();
    if (m.command && m.command.type === 'attack') {
      expect(m.command.targetId).toBe(enemy.id);
    } else {
      throw new Error('expected attack command');
    }
  });

  it('left-click on ally in attackMode issues attackMove (position-only)', () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    const ally = spawnUnit(w, 'marine', 'player', cellToPx(15, 15));
    w.selection.add(m.id);
    w.attackMode = true;
    const input = makeInput();
    input.clicks.push({ x: ally.pos.x, y: ally.pos.y, shift: false, ctrl: false, time: 0 });
    runFrame(makeGame(w, input), 16);
    expect(w.attackMode).toBe(false);
    expect(m.command).not.toBeNull();
    expect(m.command!.type).toBe('attackMove');
  });

  it('drag in attackMode is ignored (does not change selection or exit mode)', () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    w.selection.add(m.id);
    w.attackMode = true;
    const input = makeInput();
    input.dragCommit = { x0: 0, y0: 0, x1: 100, y1: 100, shift: false };
    runFrame(makeGame(w, input), 16);
    expect(w.attackMode).toBe(true);
    expect(w.selection.has(m.id)).toBe(true);
  });
});

describe('build placement hotkeys via runFrame', () => {
  it("Worker selected + 'b' edge → placement mode = barracks", () => {
    const w = createWorld();
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(10, 10));
    w.selection.add(worker.id);
    const input = makeInput();
    input.keyDownEdges.add('b');
    runFrame(makeGame(w, input), 16);
    expect(w.placement).not.toBeNull();
    expect(w.placement!.buildingKind).toBe('barracks');
    expect(w.placement!.team).toBe('player');
  });

  it("Worker selected + 'v' edge → placement mode = commandCenter", () => {
    const w = createWorld();
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(10, 10));
    w.selection.add(worker.id);
    const input = makeInput();
    input.keyDownEdges.add('v');
    runFrame(makeGame(w, input), 16);
    expect(w.placement).not.toBeNull();
    expect(w.placement!.buildingKind).toBe('commandCenter');
  });

  it("Worker selected + 't' edge → placement mode = turret", () => {
    const w = createWorld();
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(10, 10));
    w.selection.add(worker.id);
    const input = makeInput();
    input.keyDownEdges.add('t');
    runFrame(makeGame(w, input), 16);
    expect(w.placement).not.toBeNull();
    expect(w.placement!.buildingKind).toBe('turret');
  });

  it("Marine selected (no Worker) + 'b' edge → no-op", () => {
    const w = createWorld();
    const marine = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    w.selection.add(marine.id);
    const input = makeInput();
    input.keyDownEdges.add('b');
    runFrame(makeGame(w, input), 16);
    expect(w.placement).toBeNull();
  });

  it("No selection + any build hotkey → no-op", () => {
    const w = createWorld();
    const input = makeInput();
    input.keyDownEdges.add('b');
    runFrame(makeGame(w, input), 16);
    expect(w.placement).toBeNull();
  });
});

describe('production hotkeys via runFrame', () => {
  it("Barracks selected + 'm' edge → Marine queued on that Barracks", () => {
    const w = createWorld();
    const bx = spawnBuilding(w, 'barracks', 'player', 10, 10);
    w.selection.add(bx.id);
    const before = w.resources.player;
    const input = makeInput();
    input.keyDownEdges.add('m');
    runFrame(makeGame(w, input), 16);
    expect(bx.productionQueue!.length).toBe(1);
    expect(bx.productionQueue![0].produces).toBe('marine');
    expect(w.resources.player).toBe(before - 50);
  });

  it("CommandCenter selected + 's' edge → Worker queued on that CC", () => {
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

  it("CommandCenter selected + 'm' edge → no-op (CC doesn't produce Marines)", () => {
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    w.selection.add(cc.id);
    const before = w.resources.player;
    const input = makeInput();
    input.keyDownEdges.add('m');
    runFrame(makeGame(w, input), 16);
    expect(cc.productionQueue!.length).toBe(0);
    expect(w.resources.player).toBe(before);
  });

  it("Two Barracks selected + 'm' edge → Marine queued on each", () => {
    const w = createWorld();
    // Two Marines @ 50 each = 100 = starting mineral, both should queue.
    // 15×15 barracks need 15-cell separation between TLs.
    const b1 = spawnBuilding(w, 'barracks', 'player', 10, 10);
    const b2 = spawnBuilding(w, 'barracks', 'player', 30, 10);
    w.selection.add(b1.id);
    w.selection.add(b2.id);
    const before = w.resources.player;
    const input = makeInput();
    input.keyDownEdges.add('m');
    runFrame(makeGame(w, input), 16);
    expect(b1.productionQueue!.length).toBe(1);
    expect(b2.productionQueue!.length).toBe(1);
    expect(w.resources.player).toBe(before - 100);
  });

  it("No selection + 'm' edge → no-op", () => {
    const w = createWorld();
    const before = w.resources.player;
    const input = makeInput();
    input.keyDownEdges.add('m');
    runFrame(makeGame(w, input), 16);
    expect(w.resources.player).toBe(before);
  });

  it("placement non-null + 'm' edge → no-op (placement-mode-precedence)", () => {
    const w = createWorld();
    const bx = spawnBuilding(w, 'barracks', 'player', 10, 10);
    w.selection.add(bx.id);
    w.placement = { team: 'player', buildingKind: 'barracks' };
    const before = w.resources.player;
    const input = makeInput();
    input.keyDownEdges.add('m');
    runFrame(makeGame(w, input), 16);
    expect(bx.productionQueue!.length).toBe(0);
    expect(w.resources.player).toBe(before);
    expect(w.placement).not.toBeNull();
  });

  it("attackMode true + 'm' edge → no-op (attackMode-precedence)", () => {
    const w = createWorld();
    const bx = spawnBuilding(w, 'barracks', 'player', 10, 10);
    w.selection.add(bx.id);
    w.attackMode = true;
    const before = w.resources.player;
    const input = makeInput();
    input.keyDownEdges.add('m');
    runFrame(makeGame(w, input), 16);
    expect(bx.productionQueue!.length).toBe(0);
    expect(w.resources.player).toBe(before);
    expect(w.attackMode).toBe(true);
  });

  it("Barracks selected + 'c' edge → Medic queued (50 min + 25 gas deducted)", () => {
    const w = createWorld();
    const bx = spawnBuilding(w, 'barracks', 'player', 10, 10);
    w.selection.add(bx.id);
    w.resources.player = 200;
    w.gas.player = 100;
    const input = makeInput();
    input.keyDownEdges.add('c');
    runFrame(makeGame(w, input), 16);
    expect(bx.productionQueue!.length).toBe(1);
    expect(bx.productionQueue![0].produces).toBe('medic');
    expect(w.resources.player).toBe(200 - 50);
    expect(w.gas.player).toBe(100 - 25);
  });

  it("Marine selected (wrong selection) + 'c' edge → no-op", () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    w.selection.add(m.id);
    const before = w.resources.player;
    const beforeGas = w.gas.player;
    const input = makeInput();
    input.keyDownEdges.add('c');
    runFrame(makeGame(w, input), 16);
    expect(w.resources.player).toBe(before);
    expect(w.gas.player).toBe(beforeGas);
  });

  it("CommandCenter selected + 'c' edge → no-op (wrong producer)", () => {
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    w.selection.add(cc.id);
    const before = w.resources.player;
    const input = makeInput();
    input.keyDownEdges.add('c');
    runFrame(makeGame(w, input), 16);
    expect(cc.productionQueue!.length).toBe(0);
    expect(w.resources.player).toBe(before);
  });

  it("Barracks selected + 'c' but insufficient gas → no medic queued", () => {
    const w = createWorld();
    const bx = spawnBuilding(w, 'barracks', 'player', 10, 10);
    w.selection.add(bx.id);
    w.resources.player = 200;
    w.gas.player = 10;
    const input = makeInput();
    input.keyDownEdges.add('c');
    runFrame(makeGame(w, input), 16);
    expect(bx.productionQueue!.length).toBe(0);
    expect(w.resources.player).toBe(200);
    expect(w.gas.player).toBe(10);
  });

  it("Barracks selected + 'u' + placement active → no-op", () => {
    const w = createWorld();
    const bx = spawnBuilding(w, 'barracks', 'player', 10, 10);
    w.selection.add(bx.id);
    w.placement = { team: 'player', buildingKind: 'barracks' };
    const input = makeInput();
    input.keyDownEdges.add('u');
    runFrame(makeGame(w, input), 16);
    expect(bx.productionQueue!.length).toBe(0);
    expect(w.placement).not.toBeNull();
  });
});

describe('refinery / factory hotkeys via runFrame', () => {
  it("Worker selected + 'r' edge → placement mode = refinery", () => {
    const w = createWorld();
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(10, 10));
    w.selection.add(worker.id);
    const input = makeInput();
    input.keyDownEdges.add('r');
    runFrame(makeGame(w, input), 16);
    expect(w.placement).not.toBeNull();
    expect(w.placement!.buildingKind).toBe('refinery');
  });

  it("Worker selected + 'f' edge → placement mode = factory", () => {
    const w = createWorld();
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(10, 10));
    w.selection.add(worker.id);
    const input = makeInput();
    input.keyDownEdges.add('f');
    runFrame(makeGame(w, input), 16);
    expect(w.placement).not.toBeNull();
    expect(w.placement!.buildingKind).toBe('factory');
  });

  it("No worker selected + 'r' or 'f' → no-op", () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    w.selection.add(m.id);
    const input = makeInput();
    input.keyDownEdges.add('r');
    runFrame(makeGame(w, input), 16);
    expect(w.placement).toBeNull();
    const input2 = makeInput();
    input2.keyDownEdges.add('f');
    runFrame(makeGame(w, input2), 16);
    expect(w.placement).toBeNull();
  });

  it("Worker selected + 'd' edge → placement mode = supplyDepot", () => {
    const w = createWorld();
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(10, 10));
    w.selection.add(worker.id);
    const input = makeInput();
    input.keyDownEdges.add('d');
    runFrame(makeGame(w, input), 16);
    expect(w.placement).not.toBeNull();
    expect(w.placement!.buildingKind).toBe('supplyDepot');
  });

  it("Marine selected (no Worker) + 'd' edge → no-op", () => {
    const w = createWorld();
    const marine = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    w.selection.add(marine.id);
    const input = makeInput();
    input.keyDownEdges.add('d');
    runFrame(makeGame(w, input), 16);
    expect(w.placement).toBeNull();
  });

  it("'d' edge while placement active → no-op", () => {
    const w = createWorld();
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(10, 10));
    w.selection.add(worker.id);
    w.placement = { team: 'player', buildingKind: 'barracks' };
    const input = makeInput();
    input.keyDownEdges.add('d');
    runFrame(makeGame(w, input), 16);
    expect(w.placement!.buildingKind).toBe('barracks');
  });
});

