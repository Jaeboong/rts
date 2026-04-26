// Western Front preset: procedural battlefield with seeded variation.
//
// Generation order (deterministic from seed):
//  1. Fill all cells with random grass-1..5
//  2. Carve a sinuous NW-to-SE river of variable width (water tiles)
//  3. Carve dirt roads connecting bases via center + back routes
//     (roads overwrite water = bridges; the river never fully cuts the map)
//  4. Verify reachability by BFS; force-connect with extra road if needed
//  5. Scatter wall tiles around each base (partial perimeter, decorative)
//  6. Place CC + minerals + gas + workers/dummies; reject water/overlap
//  7. Scatter prop tiles (decorative density bump near bases)

import type {
  GeneratedMap,
  MapPreset,
  SpawnSpec,
  TileKind,
} from '../types';
import {
  carveRiver,
  carveRoad,
  CC_SIZE,
  CellPoint,
  clamp,
  fillGrass,
  idx,
  isWater,
  makeRng,
  reachable,
  RESOURCE_SIZE,
  Rng,
  scatterProps,
  scatterWalls,
  W,
  H,
} from './western-front-carve';

interface BaseAnchor {
  kind: 'main' | 'multi';
  team?: 'player' | 'enemy';
  cellX: number;
  cellY: number;
}

// Anchors are *intent*; jitter ±3 cells around them so layouts vary by seed.
const ANCHORS: ReadonlyArray<BaseAnchor> = [
  { kind: 'main', team: 'player', cellX: 25, cellY: 95 },
  { kind: 'main', team: 'enemy', cellX: 100, cellY: 25 },
  { kind: 'multi', cellX: 60, cellY: 60 },
  { kind: 'multi', cellX: 30, cellY: 30 },
  { kind: 'multi', cellX: 95, cellY: 95 },
];

interface Footprint { cellX: number; cellY: number; w: number; h: number; }

function rectsOverlap(a: Footprint, b: Footprint): boolean {
  return (
    a.cellX < b.cellX + b.w &&
    a.cellX + a.w > b.cellX &&
    a.cellY < b.cellY + b.h &&
    a.cellY + a.h > b.cellY
  );
}

function jitterAnchor(rng: Rng, a: BaseAnchor): { cellX: number; cellY: number } {
  return {
    cellX: clamp(a.cellX + rng.jitter(3), 0, W - CC_SIZE),
    cellY: clamp(a.cellY + rng.jitter(3), 0, H - CC_SIZE),
  };
}

interface PlacedSpawn { spec: SpawnSpec; foot: Footprint; }

// Footprint validation: reject any cell inside the prospective rect that is
// water, and reject if the rect overlaps any already-placed spawn.
function tryPlaceSpawn(
  spawns: PlacedSpawn[],
  tiles: TileKind[],
  spec: SpawnSpec,
  w: number,
  h: number,
): boolean {
  const foot: Footprint = { cellX: spec.cellX, cellY: spec.cellY, w, h };
  if (foot.cellX < 0 || foot.cellY < 0) return false;
  if (foot.cellX + w > W || foot.cellY + h > H) return false;
  for (let yy = foot.cellY; yy < foot.cellY + h; yy++) {
    for (let xx = foot.cellX; xx < foot.cellX + w; xx++) {
      if (isWater(tiles[idx(xx, yy)])) return false;
    }
  }
  for (const p of spawns) if (rectsOverlap(foot, p.foot)) return false;
  spawns.push({ spec, foot });
  return true;
}

function placeBase(
  tiles: TileKind[],
  spawns: PlacedSpawn[],
  rng: Rng,
  anchor: BaseAnchor,
  jittered: { cellX: number; cellY: number },
): void {
  const team = anchor.team ?? 'neutral';

  if (anchor.kind === 'main') {
    const ccPlaced = tryPlaceSpawn(
      spawns,
      tiles,
      { kind: 'commandCenter', team, cellX: jittered.cellX, cellY: jittered.cellY },
      CC_SIZE,
      CC_SIZE,
    );
    if (!ccPlaced) {
      // Fallback: try the canonical anchor without jitter.
      tryPlaceSpawn(
        spawns,
        tiles,
        { kind: 'commandCenter', team, cellX: anchor.cellX, cellY: anchor.cellY },
        CC_SIZE,
        CC_SIZE,
      );
    }
  }

  // Mineral cluster: 4..5 nodes scattered in a ring ~12 cells from CC center.
  const ccCx = jittered.cellX + CC_SIZE / 2;
  const ccCy = jittered.cellY + CC_SIZE / 2;
  const mineralCount = 4 + rng.range(2); // 4..5
  let mineralPlaced = 0;
  let attempts = 0;
  while (mineralPlaced < mineralCount && attempts < 50) {
    attempts++;
    const angle = (rng.next() / 0xffffffff) * Math.PI * 2;
    const dist = 18 + rng.range(5); // 18..22 cells from CC center (well outside 20-cell CC footprint)
    const cx = clamp(
      Math.round(ccCx + Math.cos(angle) * dist) - Math.floor(RESOURCE_SIZE / 2),
      0,
      W - RESOURCE_SIZE,
    );
    const cy = clamp(
      Math.round(ccCy + Math.sin(angle) * dist) - Math.floor(RESOURCE_SIZE / 2),
      0,
      H - RESOURCE_SIZE,
    );
    if (
      tryPlaceSpawn(
        spawns,
        tiles,
        { kind: 'mineralNode', team: 'neutral', cellX: cx, cellY: cy },
        RESOURCE_SIZE,
        RESOURCE_SIZE,
      )
    ) {
      mineralPlaced++;
    }
  }

  // Single gas geyser. Try ~10 cells out first; if the ring is congested with
  // minerals/water, widen the search progressively up to ~15 cells before giving up.
  let gasPlaced = false;
  attempts = 0;
  while (!gasPlaced && attempts < 200) {
    attempts++;
    const angle = (rng.next() / 0xffffffff) * Math.PI * 2;
    const baseDist = 16 + rng.range(4); // 16..19 (clear of CC + mineral ring)
    const widen = Math.floor(attempts / 50);
    const dist = baseDist + widen * 2;
    const cx = clamp(
      Math.round(ccCx + Math.cos(angle) * dist) - Math.floor(RESOURCE_SIZE / 2),
      0,
      W - RESOURCE_SIZE,
    );
    const cy = clamp(
      Math.round(ccCy + Math.sin(angle) * dist) - Math.floor(RESOURCE_SIZE / 2),
      0,
      H - RESOURCE_SIZE,
    );
    gasPlaced = tryPlaceSpawn(
      spawns,
      tiles,
      { kind: 'gasGeyser', team: 'neutral', cellX: cx, cellY: cy },
      RESOURCE_SIZE,
      RESOURCE_SIZE,
    );
  }

  // Mains: workers (player) and enemy dummies (enemy).
  if (anchor.kind === 'main' && team === 'player') {
    let placed = 0;
    let workerAttempts = 0;
    while (placed < 4 && workerAttempts < 40) {
      workerAttempts++;
      const wx = jittered.cellX + CC_SIZE + (placed % 2);
      const wy = jittered.cellY + CC_SIZE + Math.floor(placed / 2);
      if (
        tryPlaceSpawn(
          spawns,
          tiles,
          { kind: 'worker', team: 'player', cellX: wx, cellY: wy },
          1,
          1,
        )
      ) {
        placed++;
      } else if (
        tryPlaceSpawn(
          spawns,
          tiles,
          {
            kind: 'worker',
            team: 'player',
            cellX: jittered.cellX + CC_SIZE + 2 + workerAttempts,
            cellY: jittered.cellY + CC_SIZE,
          },
          1,
          1,
        )
      ) {
        placed++;
      }
    }
  }
}

function center5(j: { cellX: number; cellY: number }): CellPoint {
  return { cx: j.cellX + Math.floor(CC_SIZE / 2), cy: j.cellY + Math.floor(CC_SIZE / 2) };
}

function generateMap(seed: number): GeneratedMap {
  const rng = makeRng(seed);
  const tiles: TileKind[] = new Array(W * H);

  fillGrass(tiles, rng);
  carveRiver(tiles, rng);

  // Pre-jitter all anchors so road carving sees the same coords as base placement.
  const jittered = ANCHORS.map((a) => ({ a, j: jitterAnchor(rng, a) }));
  const playerJ = jittered[0];
  const enemyJ = jittered[1];
  const center = jittered[2];
  const nw = jittered[3];
  const se = jittered[4];

  // Main road runs through the center multi; back routes via NW and SE.
  carveRoad(tiles, center5(playerJ.j), center5(center.j), rng);
  carveRoad(tiles, center5(center.j), center5(enemyJ.j), rng);
  carveRoad(tiles, center5(playerJ.j), center5(nw.j), rng);
  carveRoad(tiles, center5(nw.j), center5(enemyJ.j), rng);
  carveRoad(tiles, center5(playerJ.j), center5(se.j), rng);
  carveRoad(tiles, center5(se.j), center5(enemyJ.j), rng);

  // Safety net — if the river still cuts the bases off, force a direct bridge.
  if (!reachable(tiles, center5(playerJ.j), center5(enemyJ.j))) {
    carveRoad(tiles, center5(playerJ.j), center5(enemyJ.j), rng);
  }

  for (const { j } of jittered) scatterWalls(tiles, j, rng);

  const placedSpawns: PlacedSpawn[] = [];
  for (const { a, j } of jittered) placeBase(tiles, placedSpawns, rng, a, j);

  // Props last — purely visual, doesn't affect reachability.
  scatterProps(
    tiles,
    jittered.map(({ j }) => j),
    rng,
  );

  return {
    tiles,
    spawns: placedSpawns.map((p) => p.spec),
  };
}

export const westernFrontPreset: MapPreset = {
  name: 'Western Front',
  width: W,
  height: H,
  generate: generateMap,
};
