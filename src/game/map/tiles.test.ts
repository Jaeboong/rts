import { describe, expect, it } from 'vitest';
import { ALL_TILE_KINDS, TILE_DEFS } from './tiles';
import type { TileKind } from './types';

describe('TILE_DEFS catalog', () => {
  it('has 24 entries (5 dirt + 5 grass + 5 wall + 5 props + 4 water)', () => {
    expect(Object.keys(TILE_DEFS)).toHaveLength(24);
  });

  it('every TileKind has an entry', () => {
    for (const k of ALL_TILE_KINDS) {
      expect(TILE_DEFS[k]).toBeDefined();
    }
  });

  it('water-1..4 are not walkable', () => {
    expect(TILE_DEFS['water-1'].walkable).toBe(false);
    expect(TILE_DEFS['water-2'].walkable).toBe(false);
    expect(TILE_DEFS['water-3'].walkable).toBe(false);
    expect(TILE_DEFS['water-4'].walkable).toBe(false);
  });

  it('water and wall tiles block movement (walls = hill-like obstacles); dirt/grass/props are walkable', () => {
    for (const k of ALL_TILE_KINDS) {
      const blocked = k.startsWith('water-') || k.startsWith('wall-');
      expect(TILE_DEFS[k].walkable).toBe(!blocked);
    }
  });

  it('every spritePath is /tiles/<kind>.png', () => {
    for (const k of ALL_TILE_KINDS) {
      expect(TILE_DEFS[k].spritePath).toBe(`/tiles/${k}.png`);
    }
  });

  it('every spritePath ends in .png', () => {
    for (const k of ALL_TILE_KINDS) {
      expect(TILE_DEFS[k].spritePath.endsWith('.png')).toBe(true);
    }
  });

  it('contains expected core kinds', () => {
    const expected: TileKind[] = ['grass-1', 'dirt-3', 'wall-5', 'prop-tree', 'water-2'];
    for (const k of expected) {
      expect(TILE_DEFS[k]).toBeDefined();
    }
  });
});
