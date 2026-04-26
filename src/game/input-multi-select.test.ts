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

describe('same-kind multi-select via runFrame', () => {
  it('double-click on player marine expands to all marines in radius', () => {
    const w = createWorld();
    const m1 = spawnUnit(w, 'marine', 'player', cellToPx(20, 20));
    const m2 = spawnUnit(w, 'marine', 'player', cellToPx(22, 20));
    const m3 = spawnUnit(w, 'marine', 'player', cellToPx(20, 24));
    const input = makeInput();

    // First click: stamps lastClickedEntityId.
    input.clicks.push({ x: m1.pos.x, y: m1.pos.y, shift: false, ctrl: false, time: 100 });
    runFrame(makeGame(w, input), 16);
    consumeFrame(input);
    expect(w.selection.size).toBe(1);
    expect(w.selection.has(m1.id)).toBe(true);

    // Second click on the same unit within 300ms → expand.
    input.clicks.push({ x: m1.pos.x, y: m1.pos.y, shift: false, ctrl: false, time: 200 });
    runFrame(makeGame(w, input), 16);
    expect(w.selection.has(m1.id)).toBe(true);
    expect(w.selection.has(m2.id)).toBe(true);
    expect(w.selection.has(m3.id)).toBe(true);
  });

  it('two clicks more than 300ms apart do NOT trigger double-click expansion', () => {
    const w = createWorld();
    const m1 = spawnUnit(w, 'marine', 'player', cellToPx(20, 20));
    const m2 = spawnUnit(w, 'marine', 'player', cellToPx(22, 20));
    const input = makeInput();

    input.clicks.push({ x: m1.pos.x, y: m1.pos.y, shift: false, ctrl: false, time: 100 });
    runFrame(makeGame(w, input), 16);
    consumeFrame(input);
    input.clicks.push({ x: m1.pos.x, y: m1.pos.y, shift: false, ctrl: false, time: 500 });
    runFrame(makeGame(w, input), 16);

    expect(w.selection.has(m1.id)).toBe(true);
    expect(w.selection.has(m2.id)).toBe(false);
    expect(w.selection.size).toBe(1);
  });

  it('ctrl+click on player marine expands without needing two clicks', () => {
    const w = createWorld();
    const m1 = spawnUnit(w, 'marine', 'player', cellToPx(20, 20));
    const m2 = spawnUnit(w, 'marine', 'player', cellToPx(22, 20));
    const input = makeInput();

    input.clicks.push({ x: m1.pos.x, y: m1.pos.y, shift: false, ctrl: true, time: 100 });
    runFrame(makeGame(w, input), 16);

    expect(w.selection.has(m1.id)).toBe(true);
    expect(w.selection.has(m2.id)).toBe(true);
  });

  it('ctrl+shift+click on player marine ADDS expanded set to existing selection', () => {
    const w = createWorld();
    const wkr = spawnUnit(w, 'worker', 'player', cellToPx(50, 50));
    const m1 = spawnUnit(w, 'marine', 'player', cellToPx(20, 20));
    const m2 = spawnUnit(w, 'marine', 'player', cellToPx(22, 20));
    w.selection.add(wkr.id);
    const input = makeInput();

    input.clicks.push({ x: m1.pos.x, y: m1.pos.y, shift: true, ctrl: true, time: 100 });
    runFrame(makeGame(w, input), 16);

    expect(w.selection.has(wkr.id)).toBe(true);
    expect(w.selection.has(m1.id)).toBe(true);
    expect(w.selection.has(m2.id)).toBe(true);
  });

  it('ctrl+click on enemy unit does NOT expand (player-team only)', () => {
    const w = createWorld();
    const enemy = spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(20, 20));
    const enemy2 = spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(22, 20));
    const input = makeInput();

    input.clicks.push({ x: enemy.pos.x, y: enemy.pos.y, shift: false, ctrl: true, time: 100 });
    runFrame(makeGame(w, input), 16);

    // Falls back to single-select on the clicked enemy (for attack-target picking).
    expect(w.selection.has(enemy.id)).toBe(true);
    expect(w.selection.has(enemy2.id)).toBe(false);
  });

  it('double-click on player building does NOT expand to all same-kind buildings', () => {
    const w = createWorld();
    const cc1 = spawnBuilding(w, 'commandCenter', 'player', 4, 4);
    const cc2 = spawnBuilding(w, 'commandCenter', 'player', 30, 4);
    const input = makeInput();

    input.clicks.push({ x: cc1.pos.x, y: cc1.pos.y, shift: false, ctrl: false, time: 100 });
    runFrame(makeGame(w, input), 16);
    consumeFrame(input);
    input.clicks.push({ x: cc1.pos.x, y: cc1.pos.y, shift: false, ctrl: false, time: 200 });
    runFrame(makeGame(w, input), 16);

    expect(w.selection.has(cc1.id)).toBe(true);
    expect(w.selection.has(cc2.id)).toBe(false);
  });

  it('single-click selection still works (no regression)', () => {
    const w = createWorld();
    const m1 = spawnUnit(w, 'marine', 'player', cellToPx(20, 20));
    const m2 = spawnUnit(w, 'marine', 'player', cellToPx(22, 20));
    const input = makeInput();

    input.clicks.push({ x: m1.pos.x, y: m1.pos.y, shift: false, ctrl: false, time: 100 });
    runFrame(makeGame(w, input), 16);

    expect(w.selection.has(m1.id)).toBe(true);
    expect(w.selection.has(m2.id)).toBe(false);
    expect(w.selection.size).toBe(1);
  });

  it('shift+click toggle still works (no regression)', () => {
    const w = createWorld();
    const m1 = spawnUnit(w, 'marine', 'player', cellToPx(20, 20));
    const m2 = spawnUnit(w, 'marine', 'player', cellToPx(40, 40));
    w.selection.add(m1.id);
    const input = makeInput();

    input.clicks.push({ x: m2.pos.x, y: m2.pos.y, shift: true, ctrl: false, time: 100 });
    runFrame(makeGame(w, input), 16);

    expect(w.selection.has(m1.id)).toBe(true);
    expect(w.selection.has(m2.id)).toBe(true);
  });

  it('drag-box select still works (no regression)', () => {
    const w = createWorld();
    const m1 = spawnUnit(w, 'marine', 'player', cellToPx(5, 5));
    const m2 = spawnUnit(w, 'marine', 'player', cellToPx(10, 5));
    const input = makeInput();
    input.dragCommit = { x0: 0, y0: 0, x1: 20 * 16, y1: 10 * 16, shift: false };
    runFrame(makeGame(w, input), 16);

    expect(w.selection.has(m1.id)).toBe(true);
    expect(w.selection.has(m2.id)).toBe(true);
  });

  it('two clicks on different units within 300ms do NOT trigger double-click expansion', () => {
    const w = createWorld();
    const m1 = spawnUnit(w, 'marine', 'player', cellToPx(20, 20));
    const m2 = spawnUnit(w, 'marine', 'player', cellToPx(22, 20));
    const m3 = spawnUnit(w, 'marine', 'player', cellToPx(40, 40));
    const input = makeInput();

    input.clicks.push({ x: m1.pos.x, y: m1.pos.y, shift: false, ctrl: false, time: 100 });
    runFrame(makeGame(w, input), 16);
    consumeFrame(input);
    // Quickly click m3 instead — different entity, so no expansion fires.
    input.clicks.push({ x: m3.pos.x, y: m3.pos.y, shift: false, ctrl: false, time: 200 });
    runFrame(makeGame(w, input), 16);

    expect(w.selection.has(m3.id)).toBe(true);
    expect(w.selection.has(m1.id)).toBe(false);
    expect(w.selection.has(m2.id)).toBe(false);
    expect(w.selection.size).toBe(1);
  });
});
