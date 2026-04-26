// Expansion Front preset (Phase 46): 256×256 map with mirror-symmetric base
// layout designed for explicit expansion gameplay.
//
// Layout (mirror function: (x, y) → (y, x), the main diagonal y=x):
//   * 2 mains   — SW corner (player) + NE corner (enemy)
//   * 2 naturals — near each main, behind a chokepoint
//   * 2 thirds   — at the 1/3 marks of the map, opposite-side flanks
//   * 0–2 centers — single mineralNodes around the map midpoint (contested)
//
// Generation order (deterministic from seed):
//  1. Fill all cells with random grass-1..5
//  2. Carve a sinuous NW-to-SE river (water tiles)
//  3. Carve dirt roads connecting mains via center, and each main↔natural↔third
//  4. Carve wall chokepoints across natural / third entrances (corridor gap
//     keeps movement possible — see expansion-front-carve.carveChokepoint)
//  5. Verify reachability by BFS; force-connect with an extra direct road if
//     a chokepoint accidentally cut things off.
//  6. Scatter wall tiles around each base (decorative)
//  7. Place CC + minerals + gas + workers; reject water/wall/overlap
//  8. Scatter prop tiles (decorative)
//
// Density rationale: 4× area but only ~2× resources total → per-cell density
// drops to roughly 50% of western-front. Total target 22–38 mineralNodes /
// 2–5 gasGeysers (per Phase 46 spec).

import type {
  GeneratedMap,
  MapPreset,
  SpawnSpec,
  TileKind,
} from '../types';
import {
  carveChokepoint,
  carveRiver,
  carveRoad,
  CC_SIZE,
  CellPoint,
  clamp,
  fillGrass,
  GRASS_KINDS,
  H,
  idx,
  isWall,
  isWater,
  makeRng,
  reachable,
  RESOURCE_SIZE,
  Rng,
  scatterProps,
  W,
} from './expansion-front-carve';

// Anchors: SW main + NE main, plus naturals/thirds. Mirror function is
// (x, y) → (y, x). The ANCHORS array stores ONE side (SW/lower-left half);
// the generator deterministically mirrors each non-self-mirrored anchor to
// produce the full symmetric layout. WHY mirror in the generator vs hand-write
// pairs: ensures perfect symmetry and lets the symmetry test be a single
// assert rather than coordinate-by-coordinate.

interface BaseAnchor {
  kind: 'main' | 'natural' | 'third' | 'center';
  team?: 'player' | 'enemy';
  cellX: number;
  cellY: number;
}

// Approximate corners per spec: (15, 230) and (230, 15). CC_SIZE=20 footprint
// fits inside the 256² bounds at those positions (15+20=35, 230+20=250 ≤ 256).
// Naturals: ~25 cells diagonally from the main, on the diagonal-toward-center
// side, with a wall chokepoint between them. Thirds: at the 1/3 marks.
//
// Exported for tests (BFS reachability + chokepoint width assertions need to
// know where the chokepoints are). Tests can replicate jitter via getJittered().
export const ONE_SIDE_ANCHORS: ReadonlyArray<BaseAnchor> = [
  // Player main — SW (low x, high y).
  { kind: 'main', team: 'player', cellX: 15, cellY: 215 },
  // Player natural — slightly inward toward center.
  { kind: 'natural', cellX: 50, cellY: 195 },
  // Player third — flanking position, opposite of natural side, ~1/3 mark.
  { kind: 'third', cellX: 25, cellY: 145 },
];

// Center bases (self-mirrored on the y=x diagonal). Each is single mineralNode
// placement (no CC) — pure contested resource. Picked at midpoint and
// 2/3-midpoint along the diagonal; the second is offset slightly for variety.
export const CENTER_ANCHORS: ReadonlyArray<BaseAnchor> = [
  { kind: 'center', cellX: 125, cellY: 125 },
  { kind: 'center', cellX: 90, cellY: 90 },
];

function mirror(a: BaseAnchor): BaseAnchor {
  const team =
    a.team === 'player' ? 'enemy' : a.team === 'enemy' ? 'player' : a.team;
  return {
    kind: a.kind,
    team,
    cellX: a.cellY,
    cellY: a.cellX,
  };
}

// Clear blocking tiles (water + wall) from a footprint, replacing with grass
// (or dirt if already dirt). Used pre-CC-placement so a CC can always be
// placed on its anchor even after chokepoint walls / river splatting.
function clearFootprint(
  tiles: TileKind[],
  cellX: number,
  cellY: number,
  w: number,
  h: number,
  rng: Rng,
): void {
  for (let yy = cellY; yy < cellY + h; yy++) {
    for (let xx = cellX; xx < cellX + w; xx++) {
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const i = idx(xx, yy);
      const t = tiles[i];
      if (isWater(t) || isWall(t)) {
        tiles[i] = rng.pick(GRASS_KINDS);
      }
    }
  }
}

interface Footprint { cellX: number; cellY: number; w: number; h: number; }

function rectsOverlap(a: Footprint, b: Footprint): boolean {
  return (
    a.cellX < b.cellX + b.w &&
    a.cellX + a.w > b.cellX &&
    a.cellY < b.cellY + b.h &&
    a.cellY + a.h > b.cellY
  );
}

// Mirror jitter: jitter the SW side, then derive the NE jittered position by
// mirroring the *jittered* coords. This preserves symmetry: jitter(SW) and
// jitter(NE) are exact mirrors of each other.
function jitterAnchorSym(rng: Rng, a: BaseAnchor): { cellX: number; cellY: number } {
  return {
    cellX: clamp(a.cellX + rng.jitter(3), 0, W - CC_SIZE),
    cellY: clamp(a.cellY + rng.jitter(3), 0, H - CC_SIZE),
  };
}

interface PlacedSpawn { spec: SpawnSpec; foot: Footprint; }

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
      const t = tiles[idx(xx, yy)];
      if (isWater(t) || isWall(t)) return false;
    }
  }
  for (const p of spawns) if (rectsOverlap(foot, p.foot)) return false;
  spawns.push({ spec, foot });
  return true;
}

// Place mineralNodes around (ccCx, ccCy) at a given ring radius. Returns
// number actually placed (may be < `count` if the ring is congested).
function placeMineralRing(
  spawns: PlacedSpawn[],
  tiles: TileKind[],
  rng: Rng,
  ccCx: number,
  ccCy: number,
  count: number,
  ringMin: number,
  ringSpan: number,
): number {
  let placed = 0;
  let attempts = 0;
  while (placed < count && attempts < 80) {
    attempts++;
    const angle = (rng.next() / 0xffffffff) * Math.PI * 2;
    const dist = ringMin + rng.range(ringSpan);
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
      placed++;
    }
  }
  return placed;
}

// Single gas geyser placement with widening search radius.
function placeGas(
  spawns: PlacedSpawn[],
  tiles: TileKind[],
  rng: Rng,
  ccCx: number,
  ccCy: number,
  ringMin: number,
  ringSpan: number,
): boolean {
  let attempts = 0;
  while (attempts < 200) {
    attempts++;
    const angle = (rng.next() / 0xffffffff) * Math.PI * 2;
    const baseDist = ringMin + rng.range(ringSpan);
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
    if (
      tryPlaceSpawn(
        spawns,
        tiles,
        { kind: 'gasGeyser', team: 'neutral', cellX: cx, cellY: cy },
        RESOURCE_SIZE,
        RESOURCE_SIZE,
      )
    ) {
      return true;
    }
  }
  return false;
}

function placeBase(
  tiles: TileKind[],
  spawns: PlacedSpawn[],
  rng: Rng,
  anchor: BaseAnchor,
  jittered: { cellX: number; cellY: number },
): void {
  const team = anchor.team ?? 'neutral';
  const ccCx = jittered.cellX + Math.floor(CC_SIZE / 2);
  const ccCy = jittered.cellY + Math.floor(CC_SIZE / 2);

  if (anchor.kind === 'main') {
    // CC for main bases. Try jittered first; fall back to canonical anchor.
    const ccPlaced = tryPlaceSpawn(
      spawns,
      tiles,
      { kind: 'commandCenter', team, cellX: jittered.cellX, cellY: jittered.cellY },
      CC_SIZE,
      CC_SIZE,
    );
    if (!ccPlaced) {
      tryPlaceSpawn(
        spawns,
        tiles,
        { kind: 'commandCenter', team, cellX: anchor.cellX, cellY: anchor.cellY },
        CC_SIZE,
        CC_SIZE,
      );
    }
    // 6–7 minerals at main (rich main per spec; cap upper bound to keep total
    // under the per-density target — see spec total of 22..38).
    placeMineralRing(spawns, tiles, rng, ccCx, ccCy, 6 + rng.range(2), 18, 5);
    placeGas(spawns, tiles, rng, ccCx, ccCy, 16, 4);

    if (team === 'player') {
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
    return;
  }

  if (anchor.kind === 'natural') {
    // 4–6 minerals + maybe gas.
    placeMineralRing(spawns, tiles, rng, ccCx, ccCy, 4 + rng.range(2), 10, 4);
    if (rng.range(2) === 0) {
      placeGas(spawns, tiles, rng, ccCx, ccCy, 12, 3);
    }
    return;
  }

  if (anchor.kind === 'third') {
    placeMineralRing(spawns, tiles, rng, ccCx, ccCy, 4 + rng.range(2), 10, 4);
    if (rng.range(2) === 0) {
      placeGas(spawns, tiles, rng, ccCx, ccCy, 12, 3);
    }
    return;
  }

  // 'center' — 2–3 single mineralNodes scattered, no gas. Lower count keeps
  // the total mineral spawn under the per-cell density cap (spec: ≤38 total).
  placeMineralRing(spawns, tiles, rng, ccCx, ccCy, 2 + rng.range(2), 6, 6);
}

function center5(j: { cellX: number; cellY: number }): CellPoint {
  return { cx: j.cellX + Math.floor(CC_SIZE / 2), cy: j.cellY + Math.floor(CC_SIZE / 2) };
}

interface JitteredAnchor { a: BaseAnchor; j: { cellX: number; cellY: number }; }

function generateMap(seed: number): GeneratedMap {
  const rng = makeRng(seed);
  const tiles: TileKind[] = new Array(W * H);

  fillGrass(tiles, rng);
  carveRiver(tiles, rng);

  // Pre-jitter SW side anchors. Mirror the JITTERED coords (not the raw
  // anchors) so symmetry is exact regardless of jitter outcome.
  const jitteredOneSide: JitteredAnchor[] = ONE_SIDE_ANCHORS.map((a) => ({
    a,
    j: jitterAnchorSym(rng, a),
  }));

  // Mirror SW jittered → NE side. Each NE anchor swaps team if applicable.
  const jitteredOther: JitteredAnchor[] = jitteredOneSide.map(({ a, j }) => ({
    a: mirror(a),
    j: { cellX: j.cellY, cellY: j.cellX },
  }));

  // Self-mirrored centers (on the diagonal). For each, one entry — the
  // mirror IS itself when cellX === cellY. We jitter symmetrically by jittering
  // x = y to keep them on-diagonal.
  const jitteredCenters: JitteredAnchor[] = CENTER_ANCHORS.map((a) => {
    const jx = clamp(a.cellX + rng.jitter(3), 0, W - CC_SIZE);
    return { a, j: { cellX: jx, cellY: jx } };
  });

  const all: JitteredAnchor[] = [
    ...jitteredOneSide,
    ...jitteredOther,
    ...jitteredCenters,
  ];

  const playerMain = jitteredOneSide[0];
  const enemyMain = jitteredOther[0];
  const playerNatural = jitteredOneSide[1];
  const enemyNatural = jitteredOther[1];
  const playerThird = jitteredOneSide[2];
  const enemyThird = jitteredOther[2];

  // Roads: connect mains via center; each main to its natural and third;
  // mirrored on the enemy side. Center bases get a tap road from the
  // main-axis road so workers can reach them.
  const centerJ = jitteredCenters[0];
  carveRoad(tiles, center5(playerMain.j), center5(playerNatural.j), rng);
  carveRoad(tiles, center5(playerNatural.j), center5(centerJ.j), rng);
  carveRoad(tiles, center5(centerJ.j), center5(enemyNatural.j), rng);
  carveRoad(tiles, center5(enemyNatural.j), center5(enemyMain.j), rng);
  carveRoad(tiles, center5(playerMain.j), center5(playerThird.j), rng);
  carveRoad(tiles, center5(playerThird.j), center5(centerJ.j), rng);
  carveRoad(tiles, center5(enemyMain.j), center5(enemyThird.j), rng);
  carveRoad(tiles, center5(enemyThird.j), center5(centerJ.j), rng);

  // Chokepoints. Natural choke: 3–5 cell gap; third choke: 5–8 cells.
  // The choke goes between main and natural (so natural is "behind" the wall
  // from the enemy's perspective). Same on enemy side via mirror.
  const naturalGap = 3 + rng.range(3); // 3..5
  const thirdGap = 5 + rng.range(4);   // 5..8
  // Wall stripe length: long enough that the perpendicular corridor is
  // actually constrained (wall ends > spec's gap width). 24-cell stripe
  // bounds a 3-5 cell gap; 30 for third's wider 5-8 gap.
  carveChokepoint(tiles, center5(playerMain.j), center5(playerNatural.j), naturalGap, rng, 24);
  carveChokepoint(tiles, center5(enemyMain.j), center5(enemyNatural.j), naturalGap, rng, 24);
  carveChokepoint(tiles, center5(playerThird.j), center5(centerJ.j), thirdGap, rng, 30);
  carveChokepoint(tiles, center5(enemyThird.j), center5(centerJ.j), thirdGap, rng, 30);

  // Safety net — after choke walls go in, make sure player↔enemy is still
  // reachable. If not, slam a direct road through whatever's blocking.
  if (!reachable(tiles, center5(playerMain.j), center5(enemyMain.j))) {
    carveRoad(tiles, center5(playerMain.j), center5(enemyMain.j), rng);
  }

  // Skip decorative scatterWalls — chokepoint walls already provide wall
  // presence on the map, and decorative scatter near a CC anchor invariably
  // intersects the 20×20 footprint, causing tryPlaceSpawn to reject every
  // jittered position. Carve a clean dirt clearing inside the main CC
  // footprints so even if the river / chokepoint logic stamps a stray wall
  // there, the CC can be placed.
  for (const ja of [playerMain, enemyMain]) {
    clearFootprint(tiles, ja.j.cellX, ja.j.cellY, CC_SIZE, CC_SIZE, rng);
  }

  const placedSpawns: PlacedSpawn[] = [];
  for (const ja of all) placeBase(tiles, placedSpawns, rng, ja.a, ja.j);

  // Props last — purely visual, doesn't affect reachability.
  scatterProps(
    tiles,
    all.map(({ j }) => j),
    rng,
  );

  return {
    tiles,
    spawns: placedSpawns.map((p) => p.spec),
  };
}

// Test helper — replicates the deterministic anchor jitter so test code can
// know where naturals/thirds end up for a given seed. Mirrors the sequence
// in generateMap up through anchor jitter (no tile work). DO NOT call from
// production code — keep this exclusively for test BFS/chokepoint assertions.
export interface ExpansionAnchors {
  playerMain: { cellX: number; cellY: number };
  enemyMain: { cellX: number; cellY: number };
  playerNatural: { cellX: number; cellY: number };
  enemyNatural: { cellX: number; cellY: number };
  playerThird: { cellX: number; cellY: number };
  enemyThird: { cellX: number; cellY: number };
  centers: ReadonlyArray<{ cellX: number; cellY: number }>;
}

export function previewAnchors(seed: number): ExpansionAnchors {
  const rng = makeRng(seed);
  // Replicate fillGrass + carveRiver RNG consumption to match generate()'s
  // state at the jitter step. WHY: jitter values depend on RNG state.
  const tiles: TileKind[] = new Array(W * H);
  fillGrass(tiles, rng);
  carveRiver(tiles, rng);
  const oneSide = ONE_SIDE_ANCHORS.map((a) => jitterAnchorSym(rng, a));
  const centers = CENTER_ANCHORS.map((a) => {
    const jx = clamp(a.cellX + rng.jitter(3), 0, W - CC_SIZE);
    return { cellX: jx, cellY: jx };
  });
  return {
    playerMain: oneSide[0],
    enemyMain: { cellX: oneSide[0].cellY, cellY: oneSide[0].cellX },
    playerNatural: oneSide[1],
    enemyNatural: { cellX: oneSide[1].cellY, cellY: oneSide[1].cellX },
    playerThird: oneSide[2],
    enemyThird: { cellX: oneSide[2].cellY, cellY: oneSide[2].cellX },
    centers,
  };
}

export const expansionFrontPreset: MapPreset = {
  name: 'Expansion Front',
  width: W,
  height: H,
  generate: generateMap,
};
