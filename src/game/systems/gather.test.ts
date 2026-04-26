import { describe, expect, it } from 'vitest';
import { CELL, type Entity } from '../../types';
import {
  DEPOSIT_SECONDS,
  MINING_SECONDS,
  WORKER_AUTO_REPATH_RADIUS,
  WORKER_CARRY_CAP,
} from '../balance';
import { spawnBuilding, spawnMineralNode, spawnUnit } from '../entities';
import { cellToPx, createWorld, type World } from '../world';
import { gatherSystem } from './gather';
import { movementSystem } from './movement';

const DT = 1 / 20;

function stepMany(world: ReturnType<typeof createWorld>, seconds: number): void {
  const ticks = Math.ceil(seconds / DT);
  for (let i = 0; i < ticks; i++) {
    gatherSystem(world, DT);
    movementSystem(world, DT);
  }
}

// Test helper: spawn a node with a fully-built depot on top so workers can gather it.
// Mirrors what `confirmPlacement('supplyDepot')` does at runtime, minus the construction step.
// `team` lets cross-team theft tests stage enemy-owned depot claims.
function spawnNodeWithDepot(
  world: World,
  cellX: number,
  cellY: number,
  remaining = 1500,
  team: 'player' | 'enemy' = 'player',
): { node: Entity; depot: Entity } {
  const node = spawnMineralNode(world, cellX, cellY, remaining);
  const depot = spawnBuilding(world, 'supplyDepot', team, cellX, cellY);
  node.depotId = depot.id;
  depot.mineralNodeId = node.id;
  return { node, depot };
}

describe('gather state machine', () => {
  it('walks to node, mines, returns, deposits', () => {
    const w = createWorld();
    // CC (20×20) occupies cells 10..29; mineral and worker placed outside its footprint.
    spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const { node } = spawnNodeWithDepot(w, 36, 12, 1500);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(34, 12));
    worker.command = { type: 'gather', nodeId: node.id };

    // First tick — initialize and request path
    gatherSystem(w, DT);
    expect(worker.gatherSubState).toBe('toNode');
    expect(worker.path).not.toBeNull();
    expect(worker.path!.length).toBeGreaterThan(0);

    // Walk and mine and return — give plenty of time
    stepMany(w, 30);

    expect(w.resources.player).toBeGreaterThanOrEqual(100 + WORKER_CARRY_CAP);
    expect((node.remaining ?? 0)).toBeLessThan(1500);
  });

  it('mining takes MINING_SECONDS once adjacent', () => {
    const w = createWorld();
    // CC (20×20) occupies cells 10..29; node and worker placed outside its footprint.
    spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const { node } = spawnNodeWithDepot(w, 36, 12, 100);
    // Place worker next to node (cell 35,12) so it arrives quickly
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(35, 12));
    worker.command = { type: 'gather', nodeId: node.id };

    // Drive long enough to reach node and start mining
    let mining = false;
    for (let i = 0; i < 200 && !mining; i++) {
      gatherSystem(w, DT);
      movementSystem(w, DT);
      if (worker.gatherSubState === 'mining') mining = true;
    }
    expect(mining).toBe(true);
    const t0 = worker.gatherTimer ?? 0;
    expect(t0).toBeCloseTo(MINING_SECONDS, 1);
  });

  it('depositing increases team resources', () => {
    const w = createWorld();
    // CC (20×20) occupies cells 10..29; node and worker placed outside its footprint.
    const cc = spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const { node } = spawnNodeWithDepot(w, 36, 12, 100);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(35, 12));
    worker.command = { type: 'gather', nodeId: node.id };
    worker.carrying = 0;

    const before = w.resources.player;
    // Run long enough to do a full cycle and deposit
    stepMany(w, 30);
    expect(w.resources.player).toBeGreaterThanOrEqual(before + WORKER_CARRY_CAP);
    expect(cc.id).toBeDefined();
    expect(DEPOSIT_SECONDS).toBeGreaterThan(0);
    expect(node.id).toBeDefined();
  });
});

describe('gather depot indirection', () => {
  it('worker right-clicks raw mineralNode (no depot) → gather command rejected, idles', () => {
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const raw = spawnMineralNode(w, 35, 40, 1500);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(35, 40));
    worker.command = { type: 'gather', nodeId: raw.id };

    gatherSystem(w, DT);

    // No depot anywhere in the world → init branch finds no resolved node, command cleared.
    expect(worker.command).toBeNull();
    expect(worker.gatherSubState).toBeUndefined();
  });

  it('worker right-clicks supplyDepot → gather works against underlying mineralNode', () => {
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const { node, depot } = spawnNodeWithDepot(w, 35, 40, 1500);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(35, 40));
    // Right-clicking the depot points the gather command at the depot's id.
    worker.command = { type: 'gather', nodeId: depot.id };

    gatherSystem(w, DT);

    // Init resolved depot → underlying node.
    expect(worker.gatherNodeId).toBe(node.id);
    expect(worker.gatherSubState).toBe('toNode');

    // Drive a full cycle and verify mineral is depleted from the underlying node.
    const before = node.remaining ?? 0;
    stepMany(w, 30);
    expect((node.remaining ?? 0)).toBeLessThan(before);
  });

  it('worker right-clicks claimed mineralNode → gather targets the underlying node directly', () => {
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const { node } = spawnNodeWithDepot(w, 35, 40, 1500);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(35, 40));
    // Right-clicking the claimed mineralNode itself works the same as right-clicking the depot.
    worker.command = { type: 'gather', nodeId: node.id };

    gatherSystem(w, DT);

    expect(worker.gatherNodeId).toBe(node.id);
    expect(worker.gatherSubState).toBe('toNode');
  });

  it('right-click on supplyDepot under construction → enters waitForDepot, walks to perimeter', () => {
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const node = spawnMineralNode(w, 35, 40, 1500);
    const depot = spawnBuilding(w, 'supplyDepot', 'player', 35, 40, false);
    node.depotId = depot.id;
    depot.mineralNodeId = node.id;
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(35, 40));
    worker.command = { type: 'gather', nodeId: depot.id };

    gatherSystem(w, 1 / 20);

    // gatherNodeId is overloaded to the depot id during waitForDepot.
    expect(worker.gatherSubState).toBe('waitForDepot');
    expect(worker.gatherNodeId).toBe(depot.id);
    expect(worker.command).not.toBeNull();
    expect(worker.path).not.toBeNull();
    expect(worker.path!.length).toBeGreaterThan(0);
  });

  it('right-click on raw mineralNode whose depot is under construction → waitForDepot', () => {
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const node = spawnMineralNode(w, 35, 40, 1500);
    const depot = spawnBuilding(w, 'supplyDepot', 'player', 35, 40, false);
    node.depotId = depot.id;
    depot.mineralNodeId = node.id;
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(35, 40));
    worker.command = { type: 'gather', nodeId: node.id };

    gatherSystem(w, 1 / 20);

    expect(worker.gatherSubState).toBe('waitForDepot');
    expect(worker.gatherNodeId).toBe(depot.id);
    expect(worker.command).not.toBeNull();
  });

  it('depot completion while waitForDepot → flips to toNode against the underlying mineral', () => {
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const node = spawnMineralNode(w, 35, 40, 1500);
    const depot = spawnBuilding(w, 'supplyDepot', 'player', 35, 40, false);
    node.depotId = depot.id;
    depot.mineralNodeId = node.id;
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(35, 40));

    worker.command = { type: 'gather', nodeId: depot.id };
    gatherSystem(w, 1 / 20);
    expect(worker.gatherSubState).toBe('waitForDepot');
    expect(worker.gatherNodeId).toBe(depot.id);

    // Complete the depot mid-wait — the next tick should transition to toNode.
    depot.underConstruction = false;
    depot.hp = depot.hpMax;
    // Drain pending path so the waitForDepot branch is the source of the transition.
    worker.path = [];

    gatherSystem(w, 1 / 20);
    expect(worker.gatherSubState).toBe('toNode');
    expect(worker.gatherNodeId).toBe(node.id);
  });

  it('depot dies mid-wait → worker falls back to nearest gatherable node', () => {
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const dyingNode = spawnMineralNode(w, 35, 40, 1500);
    const dyingDepot = spawnBuilding(w, 'supplyDepot', 'player', 35, 40, false);
    dyingNode.depotId = dyingDepot.id;
    dyingDepot.mineralNodeId = dyingNode.id;
    // A second, fully-built depot+node within auto-repath radius.
    const altNode = spawnMineralNode(w, 41, 40, 1500);
    const altDepot = spawnBuilding(w, 'supplyDepot', 'player', 41, 40);
    altNode.depotId = altDepot.id;
    altDepot.mineralNodeId = altNode.id;
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(35, 40));

    worker.command = { type: 'gather', nodeId: dyingDepot.id };
    gatherSystem(w, 1 / 20);
    expect(worker.gatherSubState).toBe('waitForDepot');

    // Mark depot dead and break the link the way cleanupDead would.
    dyingNode.depotId = null;
    dyingDepot.dead = true;
    w.entities.delete(dyingDepot.id);

    gatherSystem(w, 1 / 20);
    // Fallback redirected to the nearest remaining gatherable node.
    expect(worker.gatherSubState).toBe('toNode');
    expect(worker.gatherNodeId).toBe(altNode.id);
  });

  it('depot dies mid-wait, no fallback in radius → worker idles', () => {
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const dyingNode = spawnMineralNode(w, 35, 40, 1500);
    const dyingDepot = spawnBuilding(w, 'supplyDepot', 'player', 35, 40, false);
    dyingNode.depotId = dyingDepot.id;
    dyingDepot.mineralNodeId = dyingNode.id;
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(35, 40));

    worker.command = { type: 'gather', nodeId: dyingDepot.id };
    gatherSystem(w, 1 / 20);
    expect(worker.gatherSubState).toBe('waitForDepot');

    dyingNode.depotId = null;
    dyingDepot.dead = true;
    w.entities.delete(dyingDepot.id);

    gatherSystem(w, 1 / 20);
    expect(worker.gatherSubState).toBeUndefined();
    expect(worker.command).toBeNull();
  });

  it('mining a depleted depot-claimed node does NOT mark it dead (depot would lose footprint)', () => {
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const { node, depot } = spawnNodeWithDepot(w, 35, 40, WORKER_CARRY_CAP);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(35, 40));
    worker.command = { type: 'gather', nodeId: depot.id };
    worker.gatherSubState = 'mining';
    worker.gatherTimer = 0.01;
    worker.gatherNodeId = node.id;

    // Mining tick depletes the node fully.
    gatherSystem(w, DT);
    expect((node.remaining ?? 0)).toBe(0);
    // Critical: must NOT be dead — otherwise removeEntity would zero the depot's occupancy cells.
    expect(node.dead).not.toBe(true);
  });
});

describe('gather cross-team theft block', () => {
  // Bug regression: a player worker that right-clicked an enemy-team supplyDepot
  // (or its underlying mineralNode) used to mine that node and deposit the ore
  // back to the player's CC, draining enemy resources for free. The init branch
  // now requires depot.team === worker.team, and falls back to findNearestMineralNode
  // (own-team only) when the click is rejected.

  it('enemy-team supplyDepot direct click → gather rejected (no waitForDepot, idle)', () => {
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const { depot: enemyDepot } = spawnNodeWithDepot(w, 35, 40, 1500, 'enemy');
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(35, 40));
    worker.command = { type: 'gather', nodeId: enemyDepot.id };

    gatherSystem(w, DT);

    // No own-team depot anywhere → fallback finds nothing → command cleared.
    // Critical: must NOT be in waitForDepot — that would camp on the enemy depot.
    expect(worker.command).toBeNull();
    expect(worker.gatherSubState).toBeUndefined();
  });

  it('enemy-team mineralNode click (claimed by enemy depot) → gather rejected, idle', () => {
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const { node: enemyNode } = spawnNodeWithDepot(w, 35, 40, 1500, 'enemy');
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(35, 40));
    worker.command = { type: 'gather', nodeId: enemyNode.id };

    gatherSystem(w, DT);

    expect(worker.command).toBeNull();
    expect(worker.gatherSubState).toBeUndefined();
  });

  it('enemy-team under-construction depot click → does NOT enter waitForDepot', () => {
    // Without the team check, an enemy depot being built would put the player worker
    // into waitForDepot, parking it next to the enemy base waiting to steal.
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const enemyNode = spawnMineralNode(w, 35, 40, 1500);
    const enemyDepot = spawnBuilding(w, 'supplyDepot', 'enemy', 35, 40, false);
    enemyNode.depotId = enemyDepot.id;
    enemyDepot.mineralNodeId = enemyNode.id;
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(35, 40));
    worker.command = { type: 'gather', nodeId: enemyDepot.id };

    gatherSystem(w, DT);

    expect(worker.gatherSubState).not.toBe('waitForDepot');
    expect(worker.command).toBeNull();
  });

  it('enemy-team depot click WITH own-team fallback → routes to own-team node', () => {
    // Demonstrates the fallback path: enemy click rejected, then findNearestMineralNode
    // picks the player-team node instead of clearing the command.
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const { depot: enemyDepot } = spawnNodeWithDepot(w, 35, 40, 1500, 'enemy');
    const { node: ownNode } = spawnNodeWithDepot(w, 41, 40, 1500, 'player');
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(35, 40));
    worker.command = { type: 'gather', nodeId: enemyDepot.id };

    gatherSystem(w, DT);

    expect(worker.gatherNodeId).toBe(ownNode.id);
    expect(worker.gatherSubState).toBe('toNode');
  });

  it('regression: own-team depot click still gathers normally (no false positive)', () => {
    // Locks in the same-team behavior to catch any future over-strict team check.
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const { node, depot } = spawnNodeWithDepot(w, 35, 40, 1500, 'player');
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(35, 40));
    worker.command = { type: 'gather', nodeId: depot.id };

    gatherSystem(w, DT);

    expect(worker.gatherNodeId).toBe(node.id);
    expect(worker.gatherSubState).toBe('toNode');
  });

  it('auto-repath after depletion ignores enemy-team alt within radius', () => {
    // findNearestMineralInRadius (post-mining auto-repath) must also filter by team.
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const { node: primary } = spawnNodeWithDepot(w, 35, 40, 100, 'player');
    // Within radius but enemy-claimed → must NOT be picked.
    const { node: enemyAlt } = spawnNodeWithDepot(w, 41, 40, 1500, 'enemy');
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(35, 40));
    worker.command = { type: 'gather', nodeId: primary.id };
    worker.gatherSubState = 'mining';
    worker.gatherTimer = 0.01;
    worker.gatherNodeId = primary.id;
    primary.remaining = 0;

    gatherSystem(w, 1 / 20);

    // No own-team alt in radius → idles. Enemy alt must NOT be selected.
    expect(worker.gatherSubState).toBeUndefined();
    expect(worker.gatherNodeId).not.toBe(enemyAlt.id);
    expect(worker.command).toBeNull();
  });
});

describe('mineral auto-repath on depletion', () => {
  it('auto-targets another mineral within radius when current depletes mid-mining', () => {
    const w = createWorld();
    // CC (20×20) at (10,10) covers cells 10..29; place workers/minerals at row 40 to clear it.
    spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const { node: primary } = spawnNodeWithDepot(w, 35, 40, 100);
    // 6 cells right of primary, within 8-cell radius (5×5 mineral spacing precludes <6 cell gap).
    const { node: alt } = spawnNodeWithDepot(w, 41, 40, 1500);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(35, 40));
    worker.command = { type: 'gather', nodeId: primary.id };
    worker.gatherSubState = 'mining';
    worker.gatherTimer = 0.01;
    worker.gatherNodeId = primary.id;
    primary.remaining = 0;

    gatherSystem(w, 1 / 20);

    expect(worker.gatherSubState).toBe('toNode');
    expect(worker.gatherNodeId).toBe(alt.id);
    expect(worker.command).not.toBeNull();
  });

  it('clears gather state when no mineral within radius after depletion', () => {
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const { node: primary } = spawnNodeWithDepot(w, 35, 40, 100);
    // Far outside 8-cell radius.
    spawnNodeWithDepot(w, 35 + WORKER_AUTO_REPATH_RADIUS + 5, 40, 1500);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(35, 40));
    worker.command = { type: 'gather', nodeId: primary.id };
    worker.gatherSubState = 'mining';
    worker.gatherTimer = 0.01;
    worker.gatherNodeId = primary.id;
    primary.remaining = 0;

    gatherSystem(w, 1 / 20);

    expect(worker.gatherSubState).toBeUndefined();
    expect(worker.gatherNodeId).toBeNull();
    expect(worker.gatherTimer).toBe(0);
    expect(worker.command).toBeNull();
  });

  it('picks the closest mineral by Euclidean distance when multiple are in radius', () => {
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const { node: primary } = spawnNodeWithDepot(w, 35, 40, 100);
    // 5×5 mineral footprints require ≥6 cells between TLs to avoid overlap.
    const { node: farAlt } = spawnNodeWithDepot(w, 35, 47, 1500);
    const { node: nearAlt } = spawnNodeWithDepot(w, 41, 40, 1500);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(35, 40));
    worker.command = { type: 'gather', nodeId: primary.id };
    worker.gatherSubState = 'mining';
    worker.gatherTimer = 0.01;
    worker.gatherNodeId = primary.id;
    primary.remaining = 0;

    gatherSystem(w, 1 / 20);

    expect(worker.gatherNodeId).toBe(nearAlt.id);
    expect(worker.gatherNodeId).not.toBe(farAlt.id);
  });

  it('does not auto-repath an idle worker when minerals deplete in the world', () => {
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const { node } = spawnNodeWithDepot(w, 35, 40, 100);
    spawnNodeWithDepot(w, 41, 40, 1500);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(35, 40));
    // Idle: no command, no gather sub-state.
    worker.command = null;
    worker.gatherSubState = undefined;
    node.remaining = 0;

    gatherSystem(w, 1 / 20);

    expect(worker.command).toBeNull();
    expect(worker.gatherSubState).toBeUndefined();
    expect(worker.gatherNodeId == null).toBe(true);
  });

  it('raw mineralNode without depot is NOT a valid auto-repath target', () => {
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const { node: primary } = spawnNodeWithDepot(w, 35, 40, 100);
    // Raw patch nearby with no depot — must not be picked.
    const raw = spawnMineralNode(w, 41, 40, 1500);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(35, 40));
    worker.command = { type: 'gather', nodeId: primary.id };
    worker.gatherSubState = 'mining';
    worker.gatherTimer = 0.01;
    worker.gatherNodeId = primary.id;
    primary.remaining = 0;

    gatherSystem(w, 1 / 20);

    // No depot-claimed node within radius → idles.
    expect(worker.gatherSubState).toBeUndefined();
    expect(worker.gatherNodeId).not.toBe(raw.id);
  });

  it('does not pick a node whose depot is still underConstruction', () => {
    // Auto-repath fallback path: under-construction depot must not satisfy the scan.
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const { node: primary } = spawnNodeWithDepot(w, 35, 40, 100);
    // Alt patch within radius but its depot is not yet built.
    const altNode = spawnMineralNode(w, 41, 40, 1500);
    const altDepot = spawnBuilding(w, 'supplyDepot', 'player', 41, 40, false);
    altNode.depotId = altDepot.id;
    altDepot.mineralNodeId = altNode.id;
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(35, 40));
    worker.command = { type: 'gather', nodeId: primary.id };
    worker.gatherSubState = 'mining';
    worker.gatherTimer = 0.01;
    worker.gatherNodeId = primary.id;
    primary.remaining = 0;

    gatherSystem(w, 1 / 20);

    // Under-construction depot is not gatherable → no alt found → idles.
    expect(worker.gatherSubState).toBeUndefined();
    expect(worker.gatherNodeId).not.toBe(altNode.id);
    expect(worker.command).toBeNull();
  });

  it('treats radius boundary as inclusive (mineral at exactly N*CELL is selected)', () => {
    // Inclusive boundary: a mineral whose center is exactly WORKER_AUTO_REPATH_RADIUS * CELL away counts.
    const w = createWorld();
    spawnBuilding(w, 'commandCenter', 'player', 10, 10);
    const { node: primary } = spawnNodeWithDepot(w, 35, 40, 100);
    // cellToPx(35,40) → (35*16+8, 40*16+8). Mineral at (35+8, 40) → dx = 8*CELL, dy = 0 → exactly on boundary.
    const { node: boundaryAlt } = spawnNodeWithDepot(w, 35 + WORKER_AUTO_REPATH_RADIUS, 40, 1500);
    const worker = spawnUnit(w, 'worker', 'player', cellToPx(35, 40));
    worker.command = { type: 'gather', nodeId: primary.id };
    worker.gatherSubState = 'mining';
    worker.gatherTimer = 0.01;
    worker.gatherNodeId = primary.id;
    primary.remaining = 0;

    gatherSystem(w, 1 / 20);

    // Sanity check the geometry assumption.
    const dx = boundaryAlt.pos.x - worker.pos.x;
    const dy = boundaryAlt.pos.y - worker.pos.y;
    expect(Math.hypot(dx, dy)).toBeCloseTo(WORKER_AUTO_REPATH_RADIUS * CELL, 5);

    expect(worker.gatherNodeId).toBe(boundaryAlt.id);
    expect(worker.gatherSubState).toBe('toNode');
  });
});
