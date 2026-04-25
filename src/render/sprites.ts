import type { Entity, Team } from '../types';

// Each sprite key resolves to a single asset under /sprites/.
export type SpriteKey =
  | 'commandCenter-idle'
  | 'commandCenter-producing'
  | 'barracks-idle'
  | 'barracks-producing'
  | 'factory-idle'
  | 'factory-producing'
  | 'refinery'
  | 'turret-idle'
  | 'turret-attack'
  | 'worker'
  | 'marine'
  | 'marine-attack-1'
  | 'marine-attack-2'
  | 'marine-attack-3'
  | 'marine-attack-4'
  | 'marine-attack-5'
  | 'tank'
  | 'tank-attack-1'
  | 'tank-attack-2'
  | 'tank-attack-3'
  | 'tank-attack-4'
  | 'tank-attack-5'
  | 'tank-attack-6'
  | 'tank-light'
  | 'tank-light-attack-1'
  | 'tank-light-attack-2'
  | 'tank-light-attack-3'
  | 'tank-light-attack-4'
  | 'tank-light-attack-5'
  | 'tank-light-attack-6'
  | 'medic'
  | 'medic-healing'
  | 'enemy-dummy'
  | 'mineral'
  | 'gas-geyser';

export const SPRITE_FILES: Record<SpriteKey, string> = {
  'commandCenter-idle': 'command-center-idle.png',
  'commandCenter-producing': 'command-center-producing.png',
  'barracks-idle': 'barracks-idle.png',
  'barracks-producing': 'barracks-producing.png',
  'factory-idle': 'factory-idle.png',
  'factory-producing': 'factory-producing.png',
  refinery: 'refinery.png',
  'turret-idle': 'turret-idle.png',
  'turret-attack': 'turret-attack.png',
  worker: 'worker.png',
  marine: 'marine.png',
  'marine-attack-1': 'marine-attack-1.png',
  'marine-attack-2': 'marine-attack-2.png',
  'marine-attack-3': 'marine-attack-3.png',
  'marine-attack-4': 'marine-attack-4.png',
  'marine-attack-5': 'marine-attack-5.png',
  tank: 'tank.png',
  'tank-attack-1': 'tank-attack-1.png',
  'tank-attack-2': 'tank-attack-2.png',
  'tank-attack-3': 'tank-attack-3.png',
  'tank-attack-4': 'tank-attack-4.png',
  'tank-attack-5': 'tank-attack-5.png',
  'tank-attack-6': 'tank-attack-6.png',
  'tank-light': 'tank-light.png',
  'tank-light-attack-1': 'tank-light-attack-1.png',
  'tank-light-attack-2': 'tank-light-attack-2.png',
  'tank-light-attack-3': 'tank-light-attack-3.png',
  'tank-light-attack-4': 'tank-light-attack-4.png',
  'tank-light-attack-5': 'tank-light-attack-5.png',
  'tank-light-attack-6': 'tank-light-attack-6.png',
  medic: 'medic.png',
  'medic-healing': 'medic-healing.png',
  'enemy-dummy': 'enemy-dummy.png',
  mineral: 'mineral.png',
  'gas-geyser': 'gas-geyser.png',
};

// Sprites whose gray patches must NOT be tinted by team color.
const NO_TINT: ReadonlySet<SpriteKey> = new Set<SpriteKey>([
  'enemy-dummy',
  'mineral',
  'gas-geyser',
]);

// Team tint colors (hex). Neutral entities never go through the tint path.
export const TEAM_TINT: Record<Team, string> = {
  player: '#3a6ea5',
  enemy: '#a53a3a',
  neutral: '#888888',
};

// A drawable source canvas can serve drawImage. Use the loose CanvasImageSource
// alias for tests that may inject stubs.
export type SpriteImage = CanvasImageSource & { width: number; height: number };

export interface SpriteBbox {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface SpriteAtlas {
  base: Record<SpriteKey, SpriteImage>;
  // Opaque-pixel bbox per key — sub-rect to use as drawImage source so transparent
  // padding around the content doesn't get rendered into the entity footprint.
  bbox: Record<SpriteKey, SpriteBbox>;
  // Lazily-populated tinted variants keyed by `${spriteKey}|${team}`.
  tinted: Map<string, SpriteImage>;
  getTinted(key: SpriteKey, team: Team): SpriteImage;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = (): void => resolve(img);
    img.onerror = (): void => reject(new Error(`Failed to load sprite: ${url}`));
    img.src = url;
  });
}

export async function loadSprites(
  baseUrl = '/sprites/',
): Promise<SpriteAtlas> {
  const keys = Object.keys(SPRITE_FILES) as SpriteKey[];
  const entries = await Promise.all(
    keys.map(async (k) => {
      const img = await loadImage(baseUrl + SPRITE_FILES[k]);
      return [k, img] as const;
    }),
  );
  const base = Object.fromEntries(entries) as Record<SpriteKey, SpriteImage>;
  const bbox = Object.fromEntries(
    keys.map((k) => [k, computeOpaqueBbox(base[k])] as const),
  ) as Record<SpriteKey, SpriteBbox>;
  const tinted = new Map<string, SpriteImage>();
  return {
    base,
    bbox,
    tinted,
    getTinted(key, team): SpriteImage {
      // Resources / enemy dummy bypass tinting — single base copy for any team.
      if (NO_TINT.has(key) || team === 'neutral') return base[key];
      const cacheKey = `${key}|${team}`;
      const hit = tinted.get(cacheKey);
      if (hit) return hit;
      const tint = TEAM_TINT[team];
      const made = makeTinted(base[key], tint);
      tinted.set(cacheKey, made);
      return made;
    },
  };
}

// ---------------------------------------------------------------------------
// Tint algorithm — port of public/gallery.html applyTint().
// Multiplies near-neutral gray pixels (low saturation, mid luminance) by the
// tint color / 180. Other pixels left untouched. Result cached per (sprite, team).
// ---------------------------------------------------------------------------

export function makeTinted(src: SpriteImage, tintHex: string): SpriteImage {
  const w = src.width;
  const h = src.height;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('makeTinted: 2d context unavailable');
  ctx.drawImage(src, 0, 0);
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  const r = parseInt(tintHex.slice(1, 3), 16);
  const g = parseInt(tintHex.slice(3, 5), 16);
  const b = parseInt(tintHex.slice(5, 7), 16);
  for (let i = 0; i < d.length; i += 4) {
    const R = d[i];
    const G = d[i + 1];
    const B = d[i + 2];
    const A = d[i + 3];
    if (A < 8) continue;
    const max = Math.max(R, G, B);
    const min = Math.min(R, G, B);
    const sat = max === 0 ? 0 : (max - min) / max;
    const lum = (R + G + B) / 3;
    if (sat < 0.1 && lum > 110 && lum < 200) {
      d[i] = Math.round((R * r) / 180);
      d[i + 1] = Math.round((G * g) / 180);
      d[i + 2] = Math.round((B * b) / 180);
    }
  }
  ctx.putImageData(id, 0, 0);
  return c;
}

// ---------------------------------------------------------------------------
// Opaque-pixel bbox — scans alpha to find the tight rectangle around content.
// Lets renderer use a 9-arg drawImage with the source rect, so transparent
// padding around the artwork doesn't shrink the visible footprint render.
// One-shot at load time; cached on the atlas.
// ---------------------------------------------------------------------------

export function computeOpaqueBbox(img: SpriteImage): SpriteBbox {
  const w = img.width;
  const h = img.height;
  const fallback: SpriteBbox = { sx: 0, sy: 0, sw: w, sh: h };
  if (typeof document === 'undefined') return fallback; // node tests
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return fallback;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h).data;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] >= 8) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return fallback; // fully transparent — fall back to native dims
  return { sx: minX, sy: minY, sw: maxX - minX + 1, sh: maxY - minY + 1 };
}

// ---------------------------------------------------------------------------
// Sprite pickers (pure — testable without DOM)
// ---------------------------------------------------------------------------

// Returns null when the entity has no atlas sprite — caller falls back to programmatic shape.
export function pickUnitSprite(e: Entity): SpriteKey | null {
  const firing = (e.attackEffectMs ?? 0) > 0;
  switch (e.kind) {
    case 'worker':
      return 'worker';
    case 'marine': {
      if (!firing) return 'marine';
      // Cycle 5 frames across the 200ms attackEffectMs window; clamp guards against >200ms or undefined.
      const elapsedMs = 200 - (e.attackEffectMs ?? 0);
      const frameIndex = Math.max(0, Math.min(4, Math.floor((elapsedMs * 5) / 200)));
      const keys: readonly SpriteKey[] = [
        'marine-attack-1',
        'marine-attack-2',
        'marine-attack-3',
        'marine-attack-4',
        'marine-attack-5',
      ];
      return keys[frameIndex];
    }
    case 'tank': {
      if (!firing) return 'tank';
      // Cycle 6 frames across the 200ms attackEffectMs window; clamp guards against >200ms or undefined.
      const elapsedMs = 200 - (e.attackEffectMs ?? 0);
      const frameIndex = Math.max(0, Math.min(5, Math.floor((elapsedMs * 6) / 200)));
      const keys: readonly SpriteKey[] = [
        'tank-attack-1',
        'tank-attack-2',
        'tank-attack-3',
        'tank-attack-4',
        'tank-attack-5',
        'tank-attack-6',
      ];
      return keys[frameIndex];
    }
    case 'tank-light': {
      if (!firing) return 'tank-light';
      const elapsedMs = 200 - (e.attackEffectMs ?? 0);
      const frameIndex = Math.max(0, Math.min(5, Math.floor((elapsedMs * 6) / 200)));
      const keys: readonly SpriteKey[] = [
        'tank-light-attack-1',
        'tank-light-attack-2',
        'tank-light-attack-3',
        'tank-light-attack-4',
        'tank-light-attack-5',
        'tank-light-attack-6',
      ];
      return keys[frameIndex];
    }
    case 'enemyDummy':
      return 'enemy-dummy';
    case 'medic':
      return e.healSubState === 'healing' ? 'medic-healing' : 'medic';
    default:
      return 'worker';
  }
}

export function pickBuildingSprite(e: Entity): SpriteKey {
  const producing = (e.productionQueue?.length ?? 0) > 0;
  const firing = (e.attackEffectMs ?? 0) > 0;
  switch (e.kind) {
    case 'commandCenter':
      return producing ? 'commandCenter-producing' : 'commandCenter-idle';
    case 'barracks':
      return producing ? 'barracks-producing' : 'barracks-idle';
    case 'factory':
      return producing ? 'factory-producing' : 'factory-idle';
    case 'turret':
      return firing ? 'turret-attack' : 'turret-idle';
    case 'refinery':
      return 'refinery';
    default:
      return 'commandCenter-idle';
  }
}

export function pickResourceSprite(kind: 'mineralNode' | 'gasGeyser'): SpriteKey {
  return kind === 'mineralNode' ? 'mineral' : 'gas-geyser';
}

export function isTintedKind(kind: Entity['kind']): boolean {
  return kind !== 'mineralNode' && kind !== 'gasGeyser' && kind !== 'enemyDummy';
}

