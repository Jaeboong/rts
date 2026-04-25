import { describe, expect, it } from 'vitest';
import { CELL, GRID_H, GRID_W } from '../types';
import { canBuildingProduceUnits } from './balance';
import {
  canPlaceRefinery,
  canPlaceSupplyDepot,
  chooseAttackModeCommand,
  chooseUnitCommand,
  clampMoveTargetToWalkable,
  exitAttackMode,
  issueRightClick,
  issueUIAction,
  tryEnterAttackMode,
  unclaimedGeyserAt,
  unclaimedMineralNodeAt,
} from './commands';
import { displaceUnitsFromFootprint } from './displacement';
import {
  spawnBuilding,
  spawnGasGeyser,
  spawnMineralNode,
  spawnUnit,
} from './entities';
import type { Game } from './loop';
import { applyClick } from './selection';
import { cellToPx, createWorld, pxToCell, setOccupancy, type World } from './world';

describe('chooseAttackModeCommand', () => {
  it('returns AttackMove on empty ground', () => {
    const w = createWorld();
    const cmd = chooseAttackModeCommand(w, null, 320, 480);
    expect(cmd).toEqual({ type: 'attackMove', target: { x: 320, y: 480 } });
  });

  it('returns Attack when clicking enemy unit', () => {
    const w = createWorld();
    const enemy = spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(20, 20));
    const cmd = chooseAttackModeCommand(w, enemy, enemy.pos.x, enemy.pos.y);
    expect(cmd).toEqual({ type: 'attack', targetId: enemy.id });
  });

  it('returns Attack when clicking enemy building', () => {
    const w = createWorld();
    const enemyBld = spawnBuilding(w, 'barracks', 'enemy', 30, 30);
    const cmd = chooseAttackModeCommand(w, enemyBld, enemyBld.pos.x, enemyBld.pos.y);
    expect(cmd).toEqual({ type: 'attack', targetId: enemyBld.id });
  });

  it('returns AttackMove (position only) when clicking ally unit', () => {
    const w = createWorld();
    const ally = spawnUnit(w, 'marine', 'player', cellToPx(15, 15));
    const cmd = chooseAttackModeCommand(w, ally, ally.pos.x, ally.pos.y);
    expect(cmd.type).toBe('attackMove');
    if (cmd.type === 'attackMove') {
      expect(cmd.target.x).toBe(ally.pos.x);
      expect(cmd.target.y).toBe(ally.pos.y);
    }
  });

  it('returns AttackMove (position only) when clicking neutral mineral node', () => {
    const w = createWorld();
    const node = spawnMineralNode(w, 18, 18, 1500);
    const cmd = chooseAttackModeCommand(w, node, node.pos.x, node.pos.y);
    expect(cmd.type).toBe('attackMove');
  });
});

describe('attackMode regression: selection click path still works when off', () => {
  it('attackMode false + click on entity → standard selection (no command emitted)', () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    expect(w.attackMode).toBe(false);
    applyClick(w, m.pos.x, m.pos.y, false);
    expect(w.selection.has(m.id)).toBe(true);
    expect(m.command).toBeNull();
  });
});

describe('tryEnterAttackMode / exitAttackMode', () => {
  it('enters when selection has at least one entity', () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    w.selection.add(m.id);
    const ok = tryEnterAttackMode(w);
    expect(ok).toBe(true);
    expect(w.attackMode).toBe(true);
  });

  it('does not enter when selection is empty', () => {
    const w = createWorld();
    const ok = tryEnterAttackMode(w);
    expect(ok).toBe(false);
    expect(w.attackMode).toBe(false);
  });

  it('does not enter while building placement is active', () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(10, 10));
    w.selection.add(m.id);
    w.placement = { team: 'player', buildingKind: 'barracks' };
    const ok = tryEnterAttackMode(w);
    expect(ok).toBe(false);
    expect(w.attackMode).toBe(false);
  });

  it('exitAttackMode sets attackMode false', () => {
    const w = createWorld();
    w.attackMode = true;
    exitAttackMode(w);
    expect(w.attackMode).toBe(false);
  });
});

describe('clampMoveTargetToWalkable', () => {
  it('returns input unchanged when target cell is walkable', () => {
    const w = createWorld();
    const input = { x: 5 * CELL + 7, y: 8 * CELL + 19 };
    const out = clampMoveTargetToWalkable(w, input);
    expect(out).toEqual(input);
  });

  it('returns adjacent walkable cell center when target cell holds a mineral', () => {
    const w = createWorld();
    const node = spawnMineralNode(w, 10, 10, 1500);
    const out = clampMoveTargetToWalkable(w, node.pos);
    const cx = Math.floor(out.x / CELL);
    const cy = Math.floor(out.y / CELL);
    expect(cx === 10 && cy === 10).toBe(false);
    expect(Math.max(Math.abs(cx - 10), Math.abs(cy - 10))).toBe(1);
    expect(out.x).toBe(cx * CELL + CELL / 2);
    expect(out.y).toBe(cy * CELL + CELL / 2);
  });

  it('returns adjacent walkable cell center when target cell is inside a building', () => {
    const w = createWorld();
    // Barracks is 15×15 — occupies cells 20..34.
    const bld = spawnBuilding(w, 'barracks', 'enemy', 20, 20);
    const out = clampMoveTargetToWalkable(w, bld.pos);
    const cx = Math.floor(out.x / CELL);
    const cy = Math.floor(out.y / CELL);
    const insideX = cx >= 20 && cx < 35;
    const insideY = cy >= 20 && cy < 35;
    expect(insideX && insideY).toBe(false);
    expect(out.x).toBe(cx * CELL + CELL / 2);
    expect(out.y).toBe(cy * CELL + CELL / 2);
  });

  it('finds nearest walkable cell when the inner ring is fully blocked', () => {
    const w = createWorld();
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        setOccupancy(w, 10 + dx, 10 + dy, 1, 1, 999);
      }
    }
    const out = clampMoveTargetToWalkable(w, cellToPx(10, 10));
    const cx = Math.floor(out.x / CELL);
    const cy = Math.floor(out.y / CELL);
    expect(cx >= 9 && cx <= 11 && cy >= 9 && cy <= 11).toBe(false);
    const idx = cy * GRID_W + cx;
    expect(w.occupancy[idx]).toBe(-1);
  });

  it('returns input when no walkable cell exists within search radius', () => {
    const w = createWorld();
    // Fill everything within a Chebyshev radius of 10 around (32, 32) — fits inside the 128x128 grid.
    for (let dy = -10; dy <= 10; dy++) {
      for (let dx = -10; dx <= 10; dx++) {
        setOccupancy(w, 32 + dx, 32 + dy, 1, 1, 999);
      }
    }
    const input = cellToPx(32, 32);
    const out = clampMoveTargetToWalkable(w, input);
    expect(out).toEqual(input);
  });
});

describe('chooseUnitCommand', () => {
  it('worker right-click on mineral cell → Gather (target = mineral, not move)', () => {
    const w = createWorld();
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(5, 5));
    const node = spawnMineralNode(w, 12, 12, 1500);
    const cmd = chooseUnitCommand(w, worker, node, node.pos.x, node.pos.y, false);
    expect(cmd).toEqual({ type: 'gather', nodeId: node.id });
  });

  it('marine right-click on mineral cell → Move with clamped (adjacent walkable) target', () => {
    const w = createWorld();
    const marine = spawnUnit(w, 'marine', 'player', cellToPx(5, 5));
    const node = spawnMineralNode(w, 12, 12, 1500);
    const cmd = chooseUnitCommand(w, marine, node, node.pos.x, node.pos.y, false);
    expect(cmd.type).toBe('move');
    if (cmd.type === 'move') {
      const cx = Math.floor(cmd.target.x / CELL);
      const cy = Math.floor(cmd.target.y / CELL);
      expect(cx === 12 && cy === 12).toBe(false);
      expect(Math.max(Math.abs(cx - 12), Math.abs(cy - 12))).toBeLessThanOrEqual(1);
    }
  });

  it('marine right-click on enemy building cell → Attack (no clamp on entity-targeted form)', () => {
    const w = createWorld();
    const marine = spawnUnit(w, 'marine', 'player', cellToPx(5, 5));
    const enemyBld = spawnBuilding(w, 'barracks', 'enemy', 30, 30);
    const cmd = chooseUnitCommand(w, marine, enemyBld, enemyBld.pos.x, enemyBld.pos.y, false);
    expect(cmd).toEqual({ type: 'attack', targetId: enemyBld.id });
  });

  it('marine right-click on empty cell → Move with target unchanged', () => {
    const w = createWorld();
    const marine = spawnUnit(w, 'marine', 'player', cellToPx(5, 5));
    const wx = 20 * CELL + 9;
    const wy = 25 * CELL + 14;
    const cmd = chooseUnitCommand(w, marine, null, wx, wy, false);
    expect(cmd).toEqual({ type: 'move', target: { x: wx, y: wy } });
  });

  it('marine shift+right-click on mineral cell → AttackMove with clamped target', () => {
    const w = createWorld();
    const marine = spawnUnit(w, 'marine', 'player', cellToPx(5, 5));
    const node = spawnMineralNode(w, 14, 14, 1500);
    const cmd = chooseUnitCommand(w, marine, node, node.pos.x, node.pos.y, true);
    expect(cmd.type).toBe('attackMove');
    if (cmd.type === 'attackMove') {
      const cx = Math.floor(cmd.target.x / CELL);
      const cy = Math.floor(cmd.target.y / CELL);
      expect(cx === 14 && cy === 14).toBe(false);
      expect(Math.max(Math.abs(cx - 14), Math.abs(cy - 14))).toBeLessThanOrEqual(1);
    }
  });
});

describe('attack-mode click clamping', () => {
  it('attack-mode left-click on mineral cell → AttackMove with clamped target', () => {
    const w = createWorld();
    const node = spawnMineralNode(w, 16, 16, 1500);
    const cmd = chooseAttackModeCommand(w, node, node.pos.x, node.pos.y);
    expect(cmd.type).toBe('attackMove');
    if (cmd.type === 'attackMove') {
      const cx = Math.floor(cmd.target.x / CELL);
      const cy = Math.floor(cmd.target.y / CELL);
      expect(cx === 16 && cy === 16).toBe(false);
      expect(Math.max(Math.abs(cx - 16), Math.abs(cy - 16))).toBeLessThanOrEqual(1);
    }
  });

  it('attack-mode left-click on enemy → Attack (entity-targeted, no clamp)', () => {
    const w = createWorld();
    const enemy = spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(22, 22));
    const cmd = chooseAttackModeCommand(w, enemy, enemy.pos.x, enemy.pos.y);
    expect(cmd).toEqual({ type: 'attack', targetId: enemy.id });
  });
});

function makeGame(world: World): Game {
  const partial = { world };
  return partial as unknown as Game;
}

describe('refinery placement', () => {
  it('unclaimedGeyserAt returns geyser when click cell falls in its 5×5 footprint', () => {
    const w = createWorld();
    const g = spawnGasGeyser(w, 30, 30);
    // 5×5 footprint covers cells 30..34 in both axes (inclusive).
    expect(unclaimedGeyserAt(w, 30, 30)).toBe(g);
    expect(unclaimedGeyserAt(w, 32, 32)).toBe(g);
    expect(unclaimedGeyserAt(w, 34, 30)).toBe(g);
    expect(unclaimedGeyserAt(w, 34, 34)).toBe(g);
    // Outside footprint
    expect(unclaimedGeyserAt(w, 29, 30)).toBeNull();
    expect(unclaimedGeyserAt(w, 35, 30)).toBeNull();
  });

  it('unclaimedGeyserAt skips geysers already claimed', () => {
    const w = createWorld();
    const g = spawnGasGeyser(w, 30, 30);
    g.refineryId = 999;
    expect(unclaimedGeyserAt(w, 30, 30)).toBeNull();
  });

  it('canPlaceRefinery: valid when 5×5 around geyser TL only contains geyser cells', () => {
    const w = createWorld();
    const g = spawnGasGeyser(w, 30, 30);
    expect(canPlaceRefinery(w, 30, 30, g.id)).toBe(true);
  });

  it('canPlaceRefinery: invalid when a footprint cell is occupied by something other than the geyser', () => {
    const w = createWorld();
    const g = spawnGasGeyser(w, 30, 30);
    // Clobber a footprint cell (30,30) with an unrelated id so it isn't -1 nor geyserId.
    setOccupancy(w, 30, 30, 1, 1, 999);
    expect(canPlaceRefinery(w, 30, 30, g.id)).toBe(false);
  });

  it('confirmPlacement: refinery on geyser → spawns refinery, claims geyser, deducts cost', () => {
    const w = createWorld();
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(20, 20));
    w.selection.add(worker.id);
    const g = spawnGasGeyser(w, 30, 30);
    w.placement = { team: 'player', buildingKind: 'refinery' };
    w.resources.player = 200;
    issueUIAction(makeGame(w), {
      type: 'confirmPlacement',
      x: 30 * CELL + 4,
      y: 30 * CELL + 4,
    });
    expect(w.placement).toBeNull();
    expect(w.resources.player).toBe(100); // 200 - 100
    expect(g.refineryId).not.toBeNull();
    const refinery = [...w.entities.values()].find((e) => e.kind === 'refinery');
    expect(refinery).toBeDefined();
    expect(refinery!.cellX).toBe(30);
    expect(refinery!.cellY).toBe(30);
  });

  it('confirmPlacement: refinery on empty cell → no-op (no spawn, no cost)', () => {
    const w = createWorld();
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(20, 20));
    w.selection.add(worker.id);
    w.placement = { team: 'player', buildingKind: 'refinery' };
    const before = w.resources.player;
    const sizeBefore = w.entities.size;
    issueUIAction(makeGame(w), {
      type: 'confirmPlacement',
      x: 50 * CELL + 4,
      y: 50 * CELL + 4,
    });
    expect(w.resources.player).toBe(before);
    expect(w.entities.size).toBe(sizeBefore);
    // Placement remains active because confirm rejected.
    expect(w.placement).not.toBeNull();
  });

  it('confirmPlacement: refinery on already-claimed geyser → no-op', () => {
    const w = createWorld();
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(20, 20));
    w.selection.add(worker.id);
    const g = spawnGasGeyser(w, 30, 30);
    g.refineryId = 999;
    w.placement = { team: 'player', buildingKind: 'refinery' };
    const before = w.resources.player;
    const sizeBefore = w.entities.size;
    issueUIAction(makeGame(w), {
      type: 'confirmPlacement',
      x: 30 * CELL + 4,
      y: 30 * CELL + 4,
    });
    expect(w.resources.player).toBe(before);
    expect(w.entities.size).toBe(sizeBefore);
  });

  it('confirmPlacement: factory requires gas — refused on insufficient gas', () => {
    const w = createWorld();
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(20, 20));
    w.selection.add(worker.id);
    w.placement = { team: 'player', buildingKind: 'factory' };
    w.resources.player = 1000;
    w.gas = 50; // factory needs 200
    issueUIAction(makeGame(w), {
      type: 'confirmPlacement',
      x: 60 * CELL + 4,
      y: 60 * CELL + 4,
    });
    // Still in placement because gas was insufficient.
    expect(w.placement).not.toBeNull();
    expect(w.resources.player).toBe(1000);
    expect(w.gas).toBe(50);
  });

  it('confirmPlacement: factory with sufficient resources → deducts both', () => {
    const w = createWorld();
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(20, 20));
    w.selection.add(worker.id);
    w.placement = { team: 'player', buildingKind: 'factory' };
    w.resources.player = 500;
    w.gas = 250;
    issueUIAction(makeGame(w), {
      type: 'confirmPlacement',
      x: 60 * CELL + 4,
      y: 60 * CELL + 4,
    });
    expect(w.placement).toBeNull();
    expect(w.resources.player).toBe(100); // 500 - 400
    expect(w.gas).toBe(50); // 250 - 200
  });
});

describe('displaceUnitsFromFootprint', () => {
  it('empty footprint (no units inside) → no positions change', () => {
    const w = createWorld();
    const m = spawnUnit(w, 'marine', 'player', cellToPx(50, 50));
    const before = { x: m.pos.x, y: m.pos.y };
    displaceUnitsFromFootprint(w, 10, 10, 4, 4);
    expect(m.pos).toEqual(before);
  });

  it('single unit inside footprint → teleported to nearest walkable cell outside', () => {
    const w = createWorld();
    // Footprint: cells [10..14) × [10..14). Unit at (12, 12) is inside.
    const m = spawnUnit(w, 'marine', 'player', cellToPx(12, 12));
    displaceUnitsFromFootprint(w, 10, 10, 4, 4);
    const cell = pxToCell(m.pos);
    const insideX = cell.x >= 10 && cell.x < 14;
    const insideY = cell.y >= 10 && cell.y < 14;
    expect(insideX && insideY).toBe(false);
    // Centered on a cell after teleport.
    expect(m.pos.x).toBe(cell.x * CELL + CELL / 2);
    expect(m.pos.y).toBe(cell.y * CELL + CELL / 2);
  });

  it('two units inside footprint → both moved to different walkable cells', () => {
    const w = createWorld();
    const a = spawnUnit(w, 'marine', 'player', cellToPx(11, 11));
    const b = spawnUnit(w, 'marine', 'player', cellToPx(13, 13));
    displaceUnitsFromFootprint(w, 10, 10, 4, 4);
    const ca = pxToCell(a.pos);
    const cb = pxToCell(b.pos);
    expect(ca.x >= 10 && ca.x < 14 && ca.y >= 10 && ca.y < 14).toBe(false);
    expect(cb.x >= 10 && cb.x < 14 && cb.y >= 10 && cb.y < 14).toBe(false);
    // Different cells.
    expect(ca.x === cb.x && ca.y === cb.y).toBe(false);
  });

  it('preserves command, path, and gather state across teleport', () => {
    const w = createWorld();
    const node = spawnMineralNode(w, 50, 50, 1500);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(12, 12));
    worker.command = { type: 'gather', nodeId: node.id };
    worker.path = [{ x: 100, y: 100 }, { x: 200, y: 200 }];
    worker.gatherSubState = 'toNode';
    worker.gatherTimer = 1.2;
    worker.gatherNodeId = node.id;
    worker.gatherHomeId = 99;
    worker.carrying = 3;

    displaceUnitsFromFootprint(w, 10, 10, 4, 4);

    expect(worker.command).toEqual({ type: 'gather', nodeId: node.id });
    expect(worker.path).toEqual([{ x: 100, y: 100 }, { x: 200, y: 200 }]);
    expect(worker.gatherSubState).toBe('toNode');
    expect(worker.gatherTimer).toBe(1.2);
    expect(worker.gatherNodeId).toBe(node.id);
    expect(worker.gatherHomeId).toBe(99);
    expect(worker.carrying).toBe(3);
  });

  it('footprint near map edge → still finds walkable cell within grid bounds', () => {
    const w = createWorld();
    // Place footprint so its TL is at (GRID_W-3, GRID_H-3): touches SE corner.
    const cx = GRID_W - 3;
    const cy = GRID_H - 3;
    const m = spawnUnit(w, 'marine', 'player', cellToPx(cx + 1, cy + 1));
    displaceUnitsFromFootprint(w, cx, cy, 3, 3);
    const cell = pxToCell(m.pos);
    expect(cell.x).toBeGreaterThanOrEqual(0);
    expect(cell.y).toBeGreaterThanOrEqual(0);
    expect(cell.x).toBeLessThan(GRID_W);
    expect(cell.y).toBeLessThan(GRID_H);
    // Outside the footprint.
    const insideX = cell.x >= cx && cell.x < cx + 3;
    const insideY = cell.y >= cy && cell.y < cy + 3;
    expect(insideX && insideY).toBe(false);
  });

  it('confirmPlacement: worker inside building footprint is displaced before build command', () => {
    const w = createWorld();
    // Worker stands on a cell that will be inside the barracks footprint (15×15 starting at cell 10).
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(12, 12));
    w.selection.add(worker.id);
    w.placement = { team: 'player', buildingKind: 'barracks' };
    w.resources.player = 500;
    // Click center of cell 17, 17 → barracks TL = (17 - floor(15/2), 17 - 7) = (10, 10).
    issueUIAction(makeGame(w), {
      type: 'confirmPlacement',
      x: 17 * CELL + 4,
      y: 17 * CELL + 4,
    });
    expect(w.placement).toBeNull();
    const cell = pxToCell(worker.pos);
    const insideX = cell.x >= 10 && cell.x < 25;
    const insideY = cell.y >= 10 && cell.y < 25;
    expect(insideX && insideY).toBe(false);
    // Worker still got the build command.
    expect(worker.command?.type).toBe('build');
  });
});

describe('supplyDepot placement', () => {
  it('unclaimedMineralNodeAt returns node when click cell falls in its 5×5 footprint', () => {
    const w = createWorld();
    const node = spawnMineralNode(w, 30, 30, 1500);
    expect(unclaimedMineralNodeAt(w, 30, 30)).toBe(node);
    expect(unclaimedMineralNodeAt(w, 32, 32)).toBe(node);
    expect(unclaimedMineralNodeAt(w, 34, 34)).toBe(node);
    expect(unclaimedMineralNodeAt(w, 29, 30)).toBeNull();
    expect(unclaimedMineralNodeAt(w, 35, 30)).toBeNull();
  });

  it('unclaimedMineralNodeAt skips nodes already claimed by a depot', () => {
    const w = createWorld();
    const node = spawnMineralNode(w, 30, 30, 1500);
    node.depotId = 999;
    expect(unclaimedMineralNodeAt(w, 30, 30)).toBeNull();
  });

  it('canPlaceSupplyDepot: valid when 5×5 around node TL only contains node cells', () => {
    const w = createWorld();
    const node = spawnMineralNode(w, 30, 30, 1500);
    expect(canPlaceSupplyDepot(w, 30, 30, node.id)).toBe(true);
  });

  it('canPlaceSupplyDepot: invalid when a footprint cell is occupied by something other than the node', () => {
    const w = createWorld();
    const node = spawnMineralNode(w, 30, 30, 1500);
    setOccupancy(w, 30, 30, 1, 1, 999);
    expect(canPlaceSupplyDepot(w, 30, 30, node.id)).toBe(false);
  });

  it('confirmPlacement: supplyDepot on mineral node → spawns depot at node TL, claims node, free', () => {
    const w = createWorld();
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(20, 20));
    w.selection.add(worker.id);
    const node = spawnMineralNode(w, 30, 30, 1500);
    w.placement = { team: 'player', buildingKind: 'supplyDepot' };
    const before = w.resources.player;
    issueUIAction(makeGame(w), {
      type: 'confirmPlacement',
      x: 30 * CELL + 4,
      y: 30 * CELL + 4,
    });
    expect(w.placement).toBeNull();
    // Free: no mineral cost.
    expect(w.resources.player).toBe(before);
    expect(node.depotId).not.toBeNull();
    const depot = [...w.entities.values()].find((e) => e.kind === 'supplyDepot');
    expect(depot).toBeDefined();
    expect(depot!.cellX).toBe(30);
    expect(depot!.cellY).toBe(30);
    expect(depot!.mineralNodeId).toBe(node.id);
    expect(node.depotId).toBe(depot!.id);
  });

  it('confirmPlacement: supplyDepot on empty cell → no-op (no spawn, no cost)', () => {
    const w = createWorld();
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(20, 20));
    w.selection.add(worker.id);
    w.placement = { team: 'player', buildingKind: 'supplyDepot' };
    const sizeBefore = w.entities.size;
    issueUIAction(makeGame(w), {
      type: 'confirmPlacement',
      x: 50 * CELL + 4,
      y: 50 * CELL + 4,
    });
    expect(w.entities.size).toBe(sizeBefore);
    expect(w.placement).not.toBeNull();
  });

  it('confirmPlacement: supplyDepot on already-claimed node → no-op', () => {
    const w = createWorld();
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(20, 20));
    w.selection.add(worker.id);
    const node = spawnMineralNode(w, 30, 30, 1500);
    node.depotId = 999;
    w.placement = { team: 'player', buildingKind: 'supplyDepot' };
    const sizeBefore = w.entities.size;
    issueUIAction(makeGame(w), {
      type: 'confirmPlacement',
      x: 30 * CELL + 4,
      y: 30 * CELL + 4,
    });
    expect(w.entities.size).toBe(sizeBefore);
  });
});

describe('chooseUnitCommand: supplyDepot gather', () => {
  it('worker right-click on supplyDepot → gather command (depot ID as nodeId)', () => {
    const w = createWorld();
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(5, 5));
    const depot = spawnBuilding(w, 'supplyDepot', 'player', 30, 30);
    const cmd = chooseUnitCommand(w, worker, depot, depot.pos.x, depot.pos.y, false);
    expect(cmd).toEqual({ type: 'gather', nodeId: depot.id });
  });

  it('worker right-click on raw mineralNode → gather command (still emits, depot lookup happens in gather system)', () => {
    const w = createWorld();
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(5, 5));
    const node = spawnMineralNode(w, 30, 30, 1500);
    const cmd = chooseUnitCommand(w, worker, node, node.pos.x, node.pos.y, false);
    expect(cmd).toEqual({ type: 'gather', nodeId: node.id });
  });
});

describe('canBuildingProduceUnits (derived from UNIT_PRODUCTION)', () => {
  it('commandCenter → true (produces worker)', () => {
    expect(canBuildingProduceUnits('commandCenter')).toBe(true);
  });

  it('barracks → true (produces marine)', () => {
    expect(canBuildingProduceUnits('barracks')).toBe(true);
  });

  it('factory → true (produces tank)', () => {
    expect(canBuildingProduceUnits('factory')).toBe(true);
  });

  it('refinery → false (no producible unit)', () => {
    expect(canBuildingProduceUnits('refinery')).toBe(false);
  });

  it('turret → false (no producible unit)', () => {
    expect(canBuildingProduceUnits('turret')).toBe(false);
  });

  it('supplyDepot → false (no producible unit)', () => {
    expect(canBuildingProduceUnits('supplyDepot')).toBe(false);
  });
});

describe('issueRightClick: rally point restricted to production buildings', () => {
  it('right-click on empty land while CC selected → rallyPoint set', () => {
    const w = createWorld();
    const cc = spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    w.selection.add(cc.id);
    expect(cc.rallyPoint).toBeNull();

    issueRightClick(makeGame(w), 40 * CELL + 4, 40 * CELL + 4, false);

    expect(cc.rallyPoint).toEqual({ x: 40 * CELL + 4, y: 40 * CELL + 4 });
  });

  it('right-click on empty land while Barracks selected → rallyPoint set', () => {
    const w = createWorld();
    const brk = spawnBuilding(w, 'barracks', 'player', 10, 10);
    w.selection.add(brk.id);

    issueRightClick(makeGame(w), 50 * CELL + 4, 50 * CELL + 4, false);

    expect(brk.rallyPoint).toEqual({ x: 50 * CELL + 4, y: 50 * CELL + 4 });
  });

  it('right-click on empty land while Factory selected → rallyPoint set', () => {
    const w = createWorld();
    const fac = spawnBuilding(w, 'factory', 'player', 10, 10);
    w.selection.add(fac.id);

    issueRightClick(makeGame(w), 60 * CELL + 4, 60 * CELL + 4, false);

    expect(fac.rallyPoint).toEqual({ x: 60 * CELL + 4, y: 60 * CELL + 4 });
  });

  it('right-click on empty land while Refinery selected → rallyPoint NOT set (still null)', () => {
    const w = createWorld();
    const ref = spawnBuilding(w, 'refinery', 'player', 10, 10);
    w.selection.add(ref.id);
    expect(ref.rallyPoint).toBeNull();

    issueRightClick(makeGame(w), 40 * CELL + 4, 40 * CELL + 4, false);

    expect(ref.rallyPoint).toBeNull();
  });

  it('right-click on empty land while Turret selected → rallyPoint NOT set (still null)', () => {
    const w = createWorld();
    const tur = spawnBuilding(w, 'turret', 'player', 10, 10);
    w.selection.add(tur.id);
    expect(tur.rallyPoint).toBeNull();

    issueRightClick(makeGame(w), 40 * CELL + 4, 40 * CELL + 4, false);

    expect(tur.rallyPoint).toBeNull();
  });
});
