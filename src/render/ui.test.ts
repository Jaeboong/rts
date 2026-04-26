import { describe, expect, it } from 'vitest';
import { spawnBuilding, spawnMineralNode } from '../game/entities';
import { createWorld } from '../game/world';
import {
  findButtonAt,
  supplyDepotRemaining,
  type HUDState,
  type UIButton,
} from './ui';
import {
  ACTION_HOTKEYS,
  actionDisplayName,
  actionKey,
  getButtonTooltip,
} from './tooltip';

function makeButton(
  rect: { x: number; y: number; w: number; h: number },
  label = 'B',
): UIButton {
  return {
    label,
    action: { type: 'produce', unit: 'marine' },
    enabled: true,
    rect,
  };
}

function makeHud(buttons: UIButton[]): HUDState {
  return { fps: 0, tickCount: 0, buttons };
}

describe('findButtonAt (hover hit-test)', () => {
  it('returns the button when point is inside its rect', () => {
    const b = makeButton({ x: 100, y: 200, w: 92, h: 36 });
    const hud = makeHud([b]);
    expect(findButtonAt(hud, 120, 210)).toBe(b);
  });

  it('returns the button when point is on the rect edge (inclusive bounds)', () => {
    const b = makeButton({ x: 100, y: 200, w: 92, h: 36 });
    const hud = makeHud([b]);
    expect(findButtonAt(hud, 100, 200)).toBe(b);
    expect(findButtonAt(hud, 192, 236)).toBe(b);
  });

  it('returns null when point is in the gap between two adjacent buttons', () => {
    // BUTTON_PAD = 8 → gap from (192..200) at y in row band
    const a = makeButton({ x: 100, y: 200, w: 92, h: 36 }, 'A');
    const c = makeButton({ x: 200, y: 200, w: 92, h: 36 }, 'C');
    const hud = makeHud([a, c]);
    expect(findButtonAt(hud, 195, 215)).toBeNull();
  });

  it('returns null when point is outside the HUD entirely', () => {
    const b = makeButton({ x: 100, y: 200, w: 92, h: 36 });
    const hud = makeHud([b]);
    expect(findButtonAt(hud, 10, 10)).toBeNull();
    expect(findButtonAt(hud, 700, 500)).toBeNull();
  });

  it('returns null for empty button list', () => {
    expect(findButtonAt(makeHud([]), 100, 100)).toBeNull();
  });
});

describe('actionKey', () => {
  it('returns produce-<unit> for produce actions', () => {
    expect(actionKey({ type: 'produce', unit: 'marine' })).toBe('produce-marine');
    expect(actionKey({ type: 'produce', unit: 'worker' })).toBe('produce-worker');
    expect(actionKey({ type: 'produce', unit: 'tank' })).toBe('produce-tank');
    expect(actionKey({ type: 'produce', unit: 'medic' })).toBe('produce-medic');
  });

  it('returns build-<building> for beginPlace actions', () => {
    expect(actionKey({ type: 'beginPlace', building: 'barracks' })).toBe('build-barracks');
    expect(actionKey({ type: 'beginPlace', building: 'refinery' })).toBe('build-refinery');
    expect(actionKey({ type: 'beginPlace', building: 'factory' })).toBe('build-factory');
    expect(actionKey({ type: 'beginPlace', building: 'turret' })).toBe('build-turret');
  });

  it('returns cancelPlacement for cancel action', () => {
    expect(actionKey({ type: 'cancelPlacement' })).toBe('cancelPlacement');
  });
});

describe('ACTION_HOTKEYS mapping', () => {
  it('maps each ui-button action to its single-letter hotkey', () => {
    expect(ACTION_HOTKEYS['produce-marine']).toBe('M');
    expect(ACTION_HOTKEYS['produce-worker']).toBe('S');
    expect(ACTION_HOTKEYS['produce-tank']).toBe('T');
    expect(ACTION_HOTKEYS['build-barracks']).toBe('B');
    expect(ACTION_HOTKEYS['build-turret']).toBe('T');
    expect(ACTION_HOTKEYS['build-refinery']).toBe('R');
    expect(ACTION_HOTKEYS['build-factory']).toBe('F');
  });

  it('cancelPlacement uses Esc (multi-letter)', () => {
    expect(ACTION_HOTKEYS['cancelPlacement']).toBe('Esc');
  });

  it('produce-medic is C', () => {
    expect(ACTION_HOTKEYS['produce-medic']).toBe('C');
  });

  it('build-commandCenter is V', () => {
    expect(ACTION_HOTKEYS['build-commandCenter']).toBe('V');
  });
});

describe('actionDisplayName', () => {
  it('Title-cases unit kinds', () => {
    expect(actionDisplayName({ type: 'produce', unit: 'marine' })).toBe('Marine');
    expect(actionDisplayName({ type: 'produce', unit: 'worker' })).toBe('Worker');
    expect(actionDisplayName({ type: 'produce', unit: 'tank' })).toBe('Tank');
    expect(actionDisplayName({ type: 'produce', unit: 'medic' })).toBe('Medic');
  });

  it('Title-cases building kinds (camelCase → spaced where needed)', () => {
    expect(actionDisplayName({ type: 'beginPlace', building: 'barracks' })).toBe('Barracks');
    expect(actionDisplayName({ type: 'beginPlace', building: 'refinery' })).toBe('Refinery');
    expect(actionDisplayName({ type: 'beginPlace', building: 'factory' })).toBe('Factory');
    expect(actionDisplayName({ type: 'beginPlace', building: 'turret' })).toBe('Turret');
  });

  it('returns Cancel for cancel action', () => {
    expect(actionDisplayName({ type: 'cancelPlacement' })).toBe('Cancel');
  });
});

describe('getButtonTooltip', () => {
  it('Marine button → 3 lines (name, mineral cost, hotkey)', () => {
    const b = makeButton(
      { x: 0, y: 0, w: 92, h: 36 },
    );
    b.action = { type: 'produce', unit: 'marine' };
    const t = getButtonTooltip(b);
    expect(t.lines).toEqual(['Marine', 'Cost: 50 minerals', 'Hotkey: M']);
  });

  it('Tank button → 3 lines (name, mineral+gas cost, hotkey)', () => {
    const b = makeButton({ x: 0, y: 0, w: 92, h: 36 });
    b.action = { type: 'produce', unit: 'tank' };
    const t = getButtonTooltip(b);
    expect(t.lines).toEqual(['Tank', 'Cost: 250M / 100G', 'Hotkey: T']);
  });

  it('Refinery (build) → 3 lines with Refinery title-case', () => {
    const b = makeButton({ x: 0, y: 0, w: 92, h: 36 });
    b.action = { type: 'beginPlace', building: 'refinery' };
    const t = getButtonTooltip(b);
    expect(t.lines).toEqual(['Refinery', 'Cost: 100 minerals', 'Hotkey: R']);
  });

  it('Factory (build) → 3 lines with mineral+gas cost', () => {
    const b = makeButton({ x: 0, y: 0, w: 92, h: 36 });
    b.action = { type: 'beginPlace', building: 'factory' };
    const t = getButtonTooltip(b);
    expect(t.lines).toEqual(['Factory', 'Cost: 400M / 200G', 'Hotkey: F']);
  });

  it('Worker (CC produces) → 3 lines with mineral cost', () => {
    const b = makeButton({ x: 0, y: 0, w: 92, h: 36 });
    b.action = { type: 'produce', unit: 'worker' };
    const t = getButtonTooltip(b);
    expect(t.lines).toEqual(['Worker', 'Cost: 50 minerals', 'Hotkey: S']);
  });

  it('Cancel button → 2 lines (no cost, Esc hotkey)', () => {
    const b = makeButton({ x: 0, y: 0, w: 92, h: 36 });
    b.action = { type: 'cancelPlacement' };
    const t = getButtonTooltip(b);
    expect(t.lines).toEqual(['Cancel', 'Hotkey: Esc']);
  });

  it('Medic button → 3 lines (name, mineral+gas cost, C hotkey)', () => {
    const b = makeButton({ x: 0, y: 0, w: 92, h: 36 });
    b.action = { type: 'produce', unit: 'medic' };
    const t = getButtonTooltip(b);
    expect(t.lines).toEqual(['Medic', 'Cost: 50M / 25G', 'Hotkey: C']);
  });

  it('produces no cost line for zero-cost actions (supplyDepot has cost 0)', () => {
    // Defensive: zero-cost build buttons drop the cost line entirely. supplyDepot
    // is the canonical zero-cost building (gating is structural via mineralNode).
    // commandCenter used to be the example here, but it's now buildable at 750M.
    const b = makeButton({ x: 0, y: 0, w: 92, h: 36 });
    b.action = { type: 'beginPlace', building: 'supplyDepot' };
    const t = getButtonTooltip(b);
    // SupplyDepot has hotkey D, so name + hotkey = 2 lines (no cost line).
    expect(t.lines).toEqual(['Supply Depot', 'Hotkey: D']);
  });
});

describe('supplyDepotRemaining', () => {
  it('returns null for non-supplyDepot entities', () => {
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    expect(supplyDepotRemaining(w, cc)).toBeNull();
  });

  it('returns null for a supplyDepot with no mineralNode link', () => {
    const w = createWorld();
    const depot = spawnBuilding(w, 'supplyDepot', 'player', 30, 30);
    expect(depot.mineralNodeId).toBeNull();
    expect(supplyDepotRemaining(w, depot)).toBeNull();
  });

  it('returns the underlying mineralNode remaining ore for a linked depot', () => {
    const w = createWorld();
    const node = spawnMineralNode(w, 30, 30, 12345);
    const depot = spawnBuilding(w, 'supplyDepot', 'player', 30, 30);
    node.depotId = depot.id;
    depot.mineralNodeId = node.id;
    expect(supplyDepotRemaining(w, depot)).toBe(12345);
  });

  it('returns 0 when the linked node has no remaining (depleted)', () => {
    const w = createWorld();
    const node = spawnMineralNode(w, 30, 30, 0);
    const depot = spawnBuilding(w, 'supplyDepot', 'player', 30, 30);
    node.depotId = depot.id;
    depot.mineralNodeId = node.id;
    expect(supplyDepotRemaining(w, depot)).toBe(0);
  });

  it('returns null when the linked node id no longer resolves', () => {
    const w = createWorld();
    const depot = spawnBuilding(w, 'supplyDepot', 'player', 30, 30);
    depot.mineralNodeId = 99999; // dangling
    expect(supplyDepotRemaining(w, depot)).toBeNull();
  });
});
