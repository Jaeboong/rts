import { describe, expect, it } from 'vitest';

import type { Camera } from './camera';
import { runFrame } from './handler';
import { type InputState } from './input';
import type { Game } from './loop';
import { createWorld, type World } from './world';
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
    world,
    camera: makeCamera(),
    input,
    hud: makeHud(),
    speedFactor: 1,
    paused: false,
    players: [],
  };
  return partial as unknown as Game;
}

describe('F10 pause toggle', () => {
  it('flips paused false → true on first F10 keydown edge', () => {
    const w = createWorld();
    const input = makeInput();
    const game = makeGame(w, input);
    input.keyDownEdges.add('f10');
    runFrame(game, 16);
    expect(game.paused).toBe(true);
  });

  it('flips paused true → false on second F10 keydown edge', () => {
    const w = createWorld();
    const input = makeInput();
    const game = makeGame(w, input);
    game.paused = true;
    input.keyDownEdges.add('f10');
    runFrame(game, 16);
    expect(game.paused).toBe(false);
  });

  it('does not toggle when F10 is held without a fresh keydown edge', () => {
    const w = createWorld();
    const input = makeInput();
    const game = makeGame(w, input);
    // keys holds F10 but the per-frame edge set is empty (already consumed
    // last frame). Holding the key must not re-toggle pause.
    input.keys.add('f10');
    runFrame(game, 16);
    expect(game.paused).toBe(false);
  });
});
