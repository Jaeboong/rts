import type { TileDef, TileKind } from './types';

// Per-kind tile metadata. walkable=false ONLY for water — walls/props are
// decorative in the MVP (a wall tile blocks LOS visually but doesn't block
// movement; the goal here is environmental texture, not collision).
export const TILE_DEFS: Record<TileKind, TileDef> = {
  'dirt-1': { spritePath: '/tiles/dirt-1.png', walkable: true },
  'dirt-2': { spritePath: '/tiles/dirt-2.png', walkable: true },
  'dirt-3': { spritePath: '/tiles/dirt-3.png', walkable: true },
  'dirt-4': { spritePath: '/tiles/dirt-4.png', walkable: true },
  'dirt-5': { spritePath: '/tiles/dirt-5.png', walkable: true },
  'grass-1': { spritePath: '/tiles/grass-1.png', walkable: true },
  'grass-2': { spritePath: '/tiles/grass-2.png', walkable: true },
  'grass-3': { spritePath: '/tiles/grass-3.png', walkable: true },
  'grass-4': { spritePath: '/tiles/grass-4.png', walkable: true },
  'grass-5': { spritePath: '/tiles/grass-5.png', walkable: true },
  'wall-1': { spritePath: '/tiles/wall-1.png', walkable: false },
  'wall-2': { spritePath: '/tiles/wall-2.png', walkable: false },
  'wall-3': { spritePath: '/tiles/wall-3.png', walkable: false },
  'wall-4': { spritePath: '/tiles/wall-4.png', walkable: false },
  'wall-5': { spritePath: '/tiles/wall-5.png', walkable: false },
  'prop-rocks': { spritePath: '/tiles/prop-rocks.png', walkable: true },
  'prop-bush': { spritePath: '/tiles/prop-bush.png', walkable: true },
  'prop-tree': { spritePath: '/tiles/prop-tree.png', walkable: true },
  'prop-fire': { spritePath: '/tiles/prop-fire.png', walkable: true },
  'prop-well': { spritePath: '/tiles/prop-well.png', walkable: true },
  'water-1': { spritePath: '/tiles/water-1.png', walkable: false },
  'water-2': { spritePath: '/tiles/water-2.png', walkable: false },
  'water-3': { spritePath: '/tiles/water-3.png', walkable: false },
  'water-4': { spritePath: '/tiles/water-4.png', walkable: false },
};

export const ALL_TILE_KINDS: readonly TileKind[] = Object.keys(
  TILE_DEFS,
) as TileKind[];

// Drawable source mirroring SpriteAtlas.SpriteImage — same loose alias for tests.
export type TileImage = CanvasImageSource & { width: number; height: number };

export interface TileAtlas {
  base: Record<TileKind, TileImage>;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = (): void => resolve(img);
    img.onerror = (): void => reject(new Error(`Failed to load tile: ${url}`));
    img.src = url;
  });
}

// Async loader analogous to render/sprites.ts loadSprites(). Tiles are environmental,
// never team-tinted, so the atlas keeps just a flat base map — no tint cache.
export async function loadTileSprites(baseUrl = ''): Promise<TileAtlas> {
  const entries = await Promise.all(
    ALL_TILE_KINDS.map(async (k) => {
      const img = await loadImage(baseUrl + TILE_DEFS[k].spritePath);
      return [k, img] as const;
    }),
  );
  const base = Object.fromEntries(entries) as Record<TileKind, TileImage>;
  return { base };
}
