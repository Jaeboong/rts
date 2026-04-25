// Autotile sheet metadata — one entry per slot in public/tiles/auto/tile-cXrY.png.
//
// 4-bit cardinal mask convention: bit 0 = N (-y), bit 1 = E (+x), bit 2 = S (+y),
// bit 3 = W (-x). A bit is set when the neighbor in that direction is a DIFFERENT
// base class than the center. Edge tiles encode "I'm CENTER, neighbors flagged in
// mask are OTHER" — so edges always live in the LAND-class slot and OTHER is water.
//
// Row layout of the sheet (8 cols x 4 rows):
//   Row 0 — base terrain (variants per class) + 'pit' decorative tiles
//   Row 1 — DIRT center, water on cardinals/concave-corners
//   Row 2 — GRASS center, same edge masks as row 1
//   Row 3 — wall/cliff barrier sprites (NOT used by the autotile algorithm; see
//           tile-render.ts for the row-0 'pit' fallback for wall-* tiles).

export type TerrainBaseClass = 'dirt' | 'grass' | 'water' | 'wall';

// Edge orientations relative to the CENTER cell. Names describe where the OTHER
// (water) terrain sits. CARDINAL_* are single-side edges; CORNER_* are concave
// corners where water occupies two adjacent sides.
export const MASK_BASE = 0;
export const MASK_N = 0b0001;
export const MASK_E = 0b0010;
export const MASK_S = 0b0100;
export const MASK_W = 0b1000;
export const MASK_NE = MASK_N | MASK_E;
export const MASK_NW = MASK_N | MASK_W;
export const MASK_SE = MASK_S | MASK_E;
export const MASK_SW = MASK_S | MASK_W;

export interface TileSlot {
  id: string; // 'cXrY'
  spritePath: string; // '/tiles/auto/tile-cXrY.png'
  baseClass: TerrainBaseClass;
  edgeMask: number;
}

function slot(
  c: number,
  r: number,
  baseClass: TerrainBaseClass,
  edgeMask: number,
): TileSlot {
  const id = `c${c}r${r}`;
  return { id, spritePath: `/tiles/auto/tile-${id}.png`, baseClass, edgeMask };
}

// Row 0 — bases. c0/c4 = dirt, c1/c5 = grass, c2/c6 = water, c3/c7 = walled-pit
// (used as the wall-* fallback so wall cells render as a stone-rim pit, not flat
// gray).
const ROW0: TileSlot[] = [
  slot(0, 0, 'dirt', MASK_BASE),
  slot(1, 0, 'grass', MASK_BASE),
  slot(2, 0, 'water', MASK_BASE),
  slot(3, 0, 'wall', MASK_BASE),
  slot(4, 0, 'dirt', MASK_BASE),
  slot(5, 0, 'grass', MASK_BASE),
  slot(6, 0, 'water', MASK_BASE),
  slot(7, 0, 'wall', MASK_BASE),
];

// Rows 1 & 2 — same column→mask mapping; differ only in baseClass (dirt vs grass).
// Verified visually: c4r1 and c4r2 both depict water in the SW corner.
const EDGE_BY_COL: readonly number[] = [
  MASK_S, // c0 — water on south edge
  MASK_N, // c1 — water on north edge
  MASK_W, // c2 — water on west edge
  MASK_E, // c3 — water on east edge
  MASK_SW, // c4 — concave corner, water S+W
  MASK_SE, // c5 — concave corner, water S+E
  MASK_NW, // c6 — concave corner, water N+W
  MASK_NE, // c7 — concave corner, water N+E
];

const ROW1: TileSlot[] = EDGE_BY_COL.map((m, c) => slot(c, 1, 'dirt', m));
const ROW2: TileSlot[] = EDGE_BY_COL.map((m, c) => slot(c, 2, 'grass', m));

// Row 3 — cliff/wall barrier art. Each sprite mixes grass, dirt, and stone in a
// fixed configuration meant for connected ridges (which presets currently don't
// emit; western-front-carve.ts only scatters wall-* decoratively). Catalogued
// in TILE_SLOTS_ALL so loadAutotileSheet pulls every PNG, but EXCLUDED from
// TILE_SLOTS — the autotile algorithm only sees the base + dirt/grass-edge
// pool, so a wall cell falls back to the row-0 stone-rim pits instead of
// dragging in grass/dirt-mixed row-3 art that won't match its neighbours.
// edgeMask = -1 is a sentinel meaning "exclude from autotile binning".
const ROW3_LOADER_ONLY = -1;
const ROW3: TileSlot[] = Array.from({ length: 8 }, (_c, c) =>
  slot(c, 3, 'wall', ROW3_LOADER_ONLY),
);

// Slots referenced by the autotile picker (binned by class+mask).
export const TILE_SLOTS: readonly TileSlot[] = [
  ...ROW0,
  ...ROW1,
  ...ROW2,
];

// All slots — including ROW3 — for the loader so every PNG is fetched.
export const TILE_SLOTS_ALL: readonly TileSlot[] = [
  ...ROW0,
  ...ROW1,
  ...ROW2,
  ...ROW3,
];

export const TILE_SLOTS_BY_ID: Readonly<Record<string, TileSlot>> =
  Object.fromEntries(TILE_SLOTS_ALL.map((s) => [s.id, s]));

// Cardinal mask bits — also exported for the autotile algorithm to import without
// hardcoding bit positions.
export const BIT_N = MASK_N;
export const BIT_E = MASK_E;
export const BIT_S = MASK_S;
export const BIT_W = MASK_W;
