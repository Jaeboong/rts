import { describe, expect, it } from 'vitest';
import { spawnBuilding, spawnUnit } from '../game/entities';
import { cellToPx, createWorld } from '../game/world';
import {
  isTintedKind,
  pickBuildingSprite,
  pickResourceSprite,
  pickUnitSprite,
  SPRITE_FILES,
  SPRITE_VARIANT_GROUPS,
  TEAM_TINT,
  unifyVariantBboxes,
  unionBbox,
  type SpriteBbox,
  type SpriteKey,
} from './sprites';

describe('SPRITE_FILES catalog', () => {
  it('has 37 entries (35 prior + mineral-base + supply-depot)', () => {
    expect(Object.keys(SPRITE_FILES)).toHaveLength(37);
  });

  it('includes mineral-base (raw patch) and supply-depot (building) keys', () => {
    expect(SPRITE_FILES).toHaveProperty('mineral-base');
    expect(SPRITE_FILES['mineral-base']).toBe('mineral-base.png');
    expect(SPRITE_FILES).toHaveProperty('supply-depot');
    // Repurposes the legacy mineral.png as the depot building sprite.
    expect(SPRITE_FILES['supply-depot']).toBe('mineral.png');
  });

  it('every value ends in .png', () => {
    for (const v of Object.values(SPRITE_FILES)) {
      expect(v.endsWith('.png')).toBe(true);
    }
  });

  it('includes medic and medic-healing keys', () => {
    expect(SPRITE_FILES).toHaveProperty('medic');
    expect(SPRITE_FILES).toHaveProperty('medic-healing');
    expect(SPRITE_FILES.medic).toBe('medic.png');
    expect(SPRITE_FILES['medic-healing']).toBe('medic-healing.png');
  });

  it('includes 5 marine-attack frames mapped to .png files', () => {
    for (let i = 1; i <= 5; i++) {
      const key = `marine-attack-${i}` as SpriteKey;
      expect(SPRITE_FILES).toHaveProperty(key);
      expect(SPRITE_FILES[key]).toBe(`marine-attack-${i}.png`);
    }
    // Old combined sprite must not be in the catalog anymore.
    expect(SPRITE_FILES).not.toHaveProperty('marine-attack');
  });

  it('includes tank-light idle + 6 attack frames', () => {
    expect(SPRITE_FILES).toHaveProperty('tank-light');
    expect(SPRITE_FILES['tank-light']).toBe('tank-light.png');
    for (let i = 1; i <= 6; i++) {
      const key = `tank-light-attack-${i}` as SpriteKey;
      expect(SPRITE_FILES).toHaveProperty(key);
      expect(SPRITE_FILES[key]).toBe(`tank-light-attack-${i}.png`);
    }
  });
});

describe('pickUnitSprite', () => {
  it('worker → worker (no attack pose)', () => {
    const w = createWorld();
    const u = spawnUnit(w, 'worker', 'player', cellToPx(5, 5));
    expect(pickUnitSprite(u)).toBe<SpriteKey>('worker');
  });

  it('marine idle (no recent attack) → marine', () => {
    const w = createWorld();
    const u = spawnUnit(w, 'marine', 'player', cellToPx(5, 5));
    expect(u.attackEffectMs ?? 0).toBe(0);
    expect(pickUnitSprite(u)).toBe<SpriteKey>('marine');
  });

  it('marine with attackEffectMs=200 (just-fired) → marine-attack-1', () => {
    const w = createWorld();
    const u = spawnUnit(w, 'marine', 'player', cellToPx(5, 5));
    u.attackEffectMs = 200;
    expect(pickUnitSprite(u)).toBe<SpriteKey>('marine-attack-1');
  });

  it('marine with attackEffectMs=167 (still in first 40ms) → marine-attack-1', () => {
    const w = createWorld();
    const u = spawnUnit(w, 'marine', 'player', cellToPx(5, 5));
    u.attackEffectMs = 167;
    expect(pickUnitSprite(u)).toBe<SpriteKey>('marine-attack-1');
  });

  it('marine with attackEffectMs=100 (mid-cycle) → marine-attack-3', () => {
    const w = createWorld();
    const u = spawnUnit(w, 'marine', 'player', cellToPx(5, 5));
    u.attackEffectMs = 100;
    expect(pickUnitSprite(u)).toBe<SpriteKey>('marine-attack-3');
  });

  it('marine with attackEffectMs=1 (near end) → marine-attack-5', () => {
    const w = createWorld();
    const u = spawnUnit(w, 'marine', 'player', cellToPx(5, 5));
    u.attackEffectMs = 1;
    expect(pickUnitSprite(u)).toBe<SpriteKey>('marine-attack-5');
  });

  it('tank idle (attackEffectMs=0) → tank', () => {
    const w = createWorld();
    const u = spawnUnit(w, 'tank', 'player', cellToPx(5, 5));
    expect(u.attackEffectMs ?? 0).toBe(0);
    expect(pickUnitSprite(u)).toBe<SpriteKey>('tank');
  });

  it('tank with attackEffectMs=undefined → tank (idle)', () => {
    const w = createWorld();
    const u = spawnUnit(w, 'tank', 'player', cellToPx(5, 5));
    u.attackEffectMs = undefined;
    expect(pickUnitSprite(u)).toBe<SpriteKey>('tank');
  });

  it('tank with attackEffectMs=200 (just-fired) → tank-attack-1', () => {
    const w = createWorld();
    const u = spawnUnit(w, 'tank', 'player', cellToPx(5, 5));
    u.attackEffectMs = 200;
    expect(pickUnitSprite(u)).toBe<SpriteKey>('tank-attack-1');
  });

  it('tank with attackEffectMs=167 (still in first 33ms) → tank-attack-1', () => {
    const w = createWorld();
    const u = spawnUnit(w, 'tank', 'player', cellToPx(5, 5));
    u.attackEffectMs = 167;
    expect(pickUnitSprite(u)).toBe<SpriteKey>('tank-attack-1');
  });

  it('tank with attackEffectMs=100 (mid-cycle) → tank-attack-4', () => {
    const w = createWorld();
    const u = spawnUnit(w, 'tank', 'player', cellToPx(5, 5));
    u.attackEffectMs = 100;
    expect(pickUnitSprite(u)).toBe<SpriteKey>('tank-attack-4');
  });

  it('tank with attackEffectMs=1 (near end) → tank-attack-6', () => {
    const w = createWorld();
    const u = spawnUnit(w, 'tank', 'player', cellToPx(5, 5));
    u.attackEffectMs = 1;
    expect(pickUnitSprite(u)).toBe<SpriteKey>('tank-attack-6');
  });

  it('enemyDummy → enemy-dummy regardless of attack signal', () => {
    const w = createWorld();
    const u = spawnUnit(w, 'enemyDummy', 'enemy', cellToPx(5, 5));
    expect(pickUnitSprite(u)).toBe<SpriteKey>('enemy-dummy');
    u.attackEffectMs = 200;
    expect(pickUnitSprite(u)).toBe<SpriteKey>('enemy-dummy');
  });

  it('medic with no healSubState → medic', () => {
    const w = createWorld();
    const u = spawnUnit(w, 'medic', 'player', cellToPx(5, 5));
    u.healSubState = undefined;
    expect(pickUnitSprite(u)).toBe<SpriteKey>('medic');
  });

  it('medic in idle/following → medic', () => {
    const w = createWorld();
    const u = spawnUnit(w, 'medic', 'player', cellToPx(5, 5));
    u.healSubState = 'idle';
    expect(pickUnitSprite(u)).toBe<SpriteKey>('medic');
    u.healSubState = 'following';
    expect(pickUnitSprite(u)).toBe<SpriteKey>('medic');
  });

  it('medic healing → medic-healing', () => {
    const w = createWorld();
    const u = spawnUnit(w, 'medic', 'player', cellToPx(5, 5));
    u.healSubState = 'healing';
    expect(pickUnitSprite(u)).toBe<SpriteKey>('medic-healing');
  });

  it('tank-light idle (attackEffectMs=0) → tank-light', () => {
    const w = createWorld();
    const u = spawnUnit(w, 'tank-light', 'player', cellToPx(5, 5));
    expect(u.attackEffectMs ?? 0).toBe(0);
    expect(pickUnitSprite(u)).toBe<SpriteKey>('tank-light');
  });

  it('tank-light with attackEffectMs=undefined → tank-light (idle)', () => {
    const w = createWorld();
    const u = spawnUnit(w, 'tank-light', 'player', cellToPx(5, 5));
    u.attackEffectMs = undefined;
    expect(pickUnitSprite(u)).toBe<SpriteKey>('tank-light');
  });

  it('tank-light with attackEffectMs=200 (just-fired) → tank-light-attack-1', () => {
    const w = createWorld();
    const u = spawnUnit(w, 'tank-light', 'player', cellToPx(5, 5));
    u.attackEffectMs = 200;
    expect(pickUnitSprite(u)).toBe<SpriteKey>('tank-light-attack-1');
  });

  it('tank-light with attackEffectMs=167 (still in first 33ms) → tank-light-attack-1', () => {
    const w = createWorld();
    const u = spawnUnit(w, 'tank-light', 'player', cellToPx(5, 5));
    u.attackEffectMs = 167;
    expect(pickUnitSprite(u)).toBe<SpriteKey>('tank-light-attack-1');
  });

  it('tank-light with attackEffectMs=100 (mid-cycle) → tank-light-attack-4', () => {
    const w = createWorld();
    const u = spawnUnit(w, 'tank-light', 'player', cellToPx(5, 5));
    u.attackEffectMs = 100;
    expect(pickUnitSprite(u)).toBe<SpriteKey>('tank-light-attack-4');
  });

  it('tank-light with attackEffectMs=1 (near end) → tank-light-attack-6', () => {
    const w = createWorld();
    const u = spawnUnit(w, 'tank-light', 'player', cellToPx(5, 5));
    u.attackEffectMs = 1;
    expect(pickUnitSprite(u)).toBe<SpriteKey>('tank-light-attack-6');
  });
});

describe('pickBuildingSprite', () => {
  it('CC empty queue → idle', () => {
    const w = createWorld();
    const b = spawnBuilding(w, 'commandCenter', 'player', 5, 5);
    expect(pickBuildingSprite(b)).toBe<SpriteKey>('commandCenter-idle');
  });

  it('CC non-empty queue → producing', () => {
    const w = createWorld();
    const b = spawnBuilding(w, 'commandCenter', 'player', 5, 5);
    b.productionQueue = [
      { produces: 'worker', totalSeconds: 12, remainingSeconds: 12 },
    ];
    expect(pickBuildingSprite(b)).toBe<SpriteKey>('commandCenter-producing');
  });

  it('Barracks empty/non-empty → idle/producing', () => {
    const w = createWorld();
    const b = spawnBuilding(w, 'barracks', 'player', 5, 5);
    expect(pickBuildingSprite(b)).toBe<SpriteKey>('barracks-idle');
    b.productionQueue = [
      { produces: 'marine', totalSeconds: 15, remainingSeconds: 15 },
    ];
    expect(pickBuildingSprite(b)).toBe<SpriteKey>('barracks-producing');
  });

  it('Factory empty/non-empty → idle/producing', () => {
    const w = createWorld();
    const b = spawnBuilding(w, 'factory', 'player', 5, 5);
    expect(pickBuildingSprite(b)).toBe<SpriteKey>('factory-idle');
    b.productionQueue = [
      { produces: 'tank', totalSeconds: 30, remainingSeconds: 30 },
    ];
    expect(pickBuildingSprite(b)).toBe<SpriteKey>('factory-producing');
  });

  it('Refinery → refinery (no producing variant)', () => {
    const w = createWorld();
    const b = spawnBuilding(w, 'refinery', 'player', 5, 5);
    expect(pickBuildingSprite(b)).toBe<SpriteKey>('refinery');
  });

  it('SupplyDepot → supply-depot (no producing variant)', () => {
    const w = createWorld();
    const b = spawnBuilding(w, 'supplyDepot', 'player', 5, 5);
    expect(pickBuildingSprite(b)).toBe<SpriteKey>('supply-depot');
  });

  it('Turret no recent fire → turret-idle', () => {
    const w = createWorld();
    const b = spawnBuilding(w, 'turret', 'player', 5, 5);
    expect(pickBuildingSprite(b)).toBe<SpriteKey>('turret-idle');
  });

  it('Turret recent fire → turret-attack', () => {
    const w = createWorld();
    const b = spawnBuilding(w, 'turret', 'player', 5, 5);
    b.attackEffectMs = 150;
    expect(pickBuildingSprite(b)).toBe<SpriteKey>('turret-attack');
  });
});

describe('pickResourceSprite', () => {
  it('mineralNode → mineral-base (raw patch art), gasGeyser → gas-geyser', () => {
    expect(pickResourceSprite('mineralNode')).toBe<SpriteKey>('mineral-base');
    expect(pickResourceSprite('gasGeyser')).toBe<SpriteKey>('gas-geyser');
  });
});

describe('isTintedKind', () => {
  it('tints workers, marines, tanks, buildings', () => {
    expect(isTintedKind('worker')).toBe(true);
    expect(isTintedKind('marine')).toBe(true);
    expect(isTintedKind('tank')).toBe(true);
    expect(isTintedKind('tank-light')).toBe(true);
    expect(isTintedKind('commandCenter')).toBe(true);
    expect(isTintedKind('barracks')).toBe(true);
    expect(isTintedKind('factory')).toBe(true);
    expect(isTintedKind('turret')).toBe(true);
    expect(isTintedKind('refinery')).toBe(true);
    expect(isTintedKind('supplyDepot')).toBe(true);
  });

  it('skips tint for resource nodes and enemyDummy', () => {
    expect(isTintedKind('mineralNode')).toBe(false);
    expect(isTintedKind('gasGeyser')).toBe(false);
    expect(isTintedKind('enemyDummy')).toBe(false);
  });
});

describe('TEAM_TINT', () => {
  it('player and enemy use distinct hex strings', () => {
    expect(TEAM_TINT.player).not.toBe(TEAM_TINT.enemy);
    expect(TEAM_TINT.player).toMatch(/^#[0-9a-f]{6}$/i);
    expect(TEAM_TINT.enemy).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('unionBbox', () => {
  it('returns a rect spanning both inputs', () => {
    const a: SpriteBbox = { sx: 10, sy: 20, sw: 30, sh: 40 };
    const b: SpriteBbox = { sx: 5, sy: 25, sw: 50, sh: 30 };
    expect(unionBbox(a, b)).toEqual({ sx: 5, sy: 20, sw: 50, sh: 40 });
  });

  it('is idempotent on identical input', () => {
    const a: SpriteBbox = { sx: 0, sy: 0, sw: 64, sh: 64 };
    expect(unionBbox(a, a)).toEqual(a);
  });
});

describe('unifyVariantBboxes', () => {
  it('overwrites every variant in a group with the merged bbox', () => {
    const stub: SpriteBbox = { sx: 0, sy: 0, sw: 1, sh: 1 };
    const bbox = Object.fromEntries(
      (Object.keys(SPRITE_FILES) as SpriteKey[]).map((k) => [k, { ...stub }]),
    ) as Record<SpriteKey, SpriteBbox>;
    bbox['factory-idle'] = { sx: 10, sy: 10, sw: 80, sh: 80 };
    bbox['factory-producing'] = { sx: 5, sy: 8, sw: 100, sh: 90 };
    unifyVariantBboxes(bbox);
    const expected = { sx: 5, sy: 8, sw: 100, sh: 90 };
    expect(bbox['factory-idle']).toEqual(expected);
    expect(bbox['factory-producing']).toEqual(expected);
  });

  it('factory + barracks + commandCenter + turret variant pairs all unify', () => {
    expect(SPRITE_VARIANT_GROUPS.length).toBe(4);
    for (const group of SPRITE_VARIANT_GROUPS) expect(group.length).toBeGreaterThanOrEqual(2);
  });
});
