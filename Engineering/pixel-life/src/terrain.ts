import { Terrain } from './types';
import type { Season } from './types';

// Simple value noise for terrain generation
function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  return (h ^ (h >> 16)) & 0x7fffffff;
}

function smoothNoise(x: number, y: number, scale: number, seed: number): number {
  const sx = x / scale, sy = y / scale;
  const ix = Math.floor(sx), iy = Math.floor(sy);
  const fx = sx - ix, fy = sy - iy;
  const n = (ix2: number, iy2: number) => hash(ix2, iy2, seed) / 0x7fffffff;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return n(ix, iy) * (1 - u) * (1 - v) + n(ix + 1, iy) * u * (1 - v) +
    n(ix, iy + 1) * (1 - u) * v + n(ix + 1, iy + 1) * u * v;
}

function fbm(x: number, y: number, seed: number): number {
  return smoothNoise(x, y, 40, seed) * 0.5 + smoothNoise(x, y, 20, seed + 100) * 0.3 +
    smoothNoise(x, y, 10, seed + 200) * 0.2;
}

export function generateTerrain(w: number, h: number): Uint8Array {
  const terrain = new Uint8Array(w * h);
  const s1 = (Math.random() * 99999) | 0, s2 = (Math.random() * 99999) | 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      terrain[y * w + x] = classify(fbm(x, y, s1), fbm(x, y, s2));
    }
  return terrain;
}

function classify(elev: number, moist: number): Terrain {
  if (elev < 0.28) return Terrain.WATER;
  if (elev < 0.35) return Terrain.SAND;
  if (elev > 0.78) return Terrain.ROCK;
  if (moist > 0.55) return Terrain.FOREST;
  if (moist > 0.35) return Terrain.GRASS;
  return Terrain.DIRT;
}

export function terrainFoodRate(t: Terrain): number {
  switch (t) {
    case Terrain.GRASS: return 0.6; case Terrain.FOREST: return 0.35;
    case Terrain.DIRT: return 0.08; case Terrain.SAND: return 0.01;
    case Terrain.WATER: return 0.2; // aquatic food — algae/fish
    default: return 0;
  }
}

// Context-aware terrain color: responds to weather, season, creature wear, and corpses
export function terrainColorInContext(
  t: Terrain, x: number, y: number,
  weather: string, season: Season, wear: number, corpse = 0,
): [number, number, number] {
  // Base color with per-cell noise texture
  const n = ((x * 7 + y * 13) & 0xf) - 8;
  let [r, g, b] = baseColor(t, n);

  // Season tinting — amplified for visibility
  switch (season) {
    case 'spring':
      if (t === Terrain.GRASS) { g += 12; } // lush green
      if (t === Terrain.FOREST) { g += 8; }
      break;
    case 'summer':
      if (t === Terrain.GRASS) { r += 8; g += 5; } // warm golden green
      if (t === Terrain.SAND) { r += 5; g += 3; }   // bright sand
      break;
    case 'autumn':
      if (t === Terrain.GRASS) { r += 20; g -= 8; } // strong orange
      if (t === Terrain.FOREST) { r += 15; g -= 10; } // deep red-brown
      if (t === Terrain.DIRT) { r += 8; }
      break;
    case 'winter':
      // Blue-grey tint + snow patches
      r = (r * 0.75) | 0; g = (g * 0.8) | 0; b += 8;
      if ((t === Terrain.GRASS || t === Terrain.ROCK) && ((x + y) % 3 === 0)) {
        r += 20; g += 20; b += 25; // heavier snow
      }
      break;
  }

  // Weather tinting — more dramatic
  switch (weather) {
    case 'rain':
      r = (r * 0.8) | 0; g = (g * 0.85) | 0; b += 5; // wetter, darker
      break;
    case 'snow':
      r += 12; g += 12; b += 18; // stronger white tint
      break;
    case 'fog': {
      const grey = (r + g + b) / 3;
      r = (r * 0.6 + grey * 0.4) | 0; // heavier desaturation
      g = (g * 0.6 + grey * 0.4) | 0;
      b = (b * 0.6 + grey * 0.4) | 0;
      break;
    }
    case 'storm':
      r = (r * 0.65) | 0; g = (g * 0.65) | 0; b = (b * 0.75) | 0; // much darker
      break;
    case 'drought':
      if (t === Terrain.GRASS || t === Terrain.FOREST) {
        r += 18; g -= 10; b -= 5; // visibly parched yellow-brown
      }
      break;
    case 'heatwave':
      r += 10; g += 3; // strong warm tint
      break;
  }

  // Creature wear: worn paths blend to warm tan, heavy wear gets golden glow
  if (wear > 15) {
    const wearT = Math.min(1, (wear - 15) / 120);
    // Light wear: blend toward warm tan (65, 50, 30)
    // Heavy wear: golden-brown highway (80, 60, 25)
    const heavy = wearT > 0.5;
    const tr = heavy ? 80 : 65, tg = heavy ? 60 : 50, tb = heavy ? 25 : 30;
    const blend = wearT * 0.6;
    r = (r * (1 - blend) + tr * blend) | 0;
    g = (g * (1 - blend) + tg * blend) | 0;
    b = (b * (1 - blend) + tb * blend) | 0;
  }

  // Corpse staining: reddish-brown marks (battlefield memory)
  if (corpse > 0) {
    const cf = Math.min(1, corpse / 40);
    r = Math.min(255, r + ((cf * 50) | 0));
    g = Math.min(255, g + ((cf * 10) | 0));
    b = Math.max(0, b - ((cf * 5) | 0));
  }

  return [clamp(r), clamp(g), clamp(b)];
}

function baseColor(t: Terrain, n: number): [number, number, number] {
  switch (t) {
    case Terrain.WATER: return [12 + n, 22 + n, 45 + n * 2];
    case Terrain.SAND: return [55 + n, 48 + n, 25];
    case Terrain.DIRT: return [38 + n, 28 + n, 14];
    case Terrain.GRASS: return [18 + n, 45 + n, 12];
    case Terrain.FOREST: return [10, 30 + n, 10];
    case Terrain.ROCK: return [32 + n, 32 + n, 36 + n];
    default: return [0, 0, 0];
  }
}

function clamp(v: number): number { return Math.max(0, Math.min(255, v)); }

export function isPassable(t: Terrain): boolean { return t !== Terrain.WATER; }
export function givesCover(t: Terrain): boolean { return t === Terrain.FOREST; }
export function terrainSpeedMult(t: Terrain): number {
  switch (t) { case Terrain.SAND: return 0.5; case Terrain.ROCK: return 0.7; case Terrain.FOREST: return 0.85; default: return 1; }
}
export function terrainMoveCost(t: Terrain): number {
  switch (t) { case Terrain.SAND: return 1.5; case Terrain.ROCK: return 1.3; case Terrain.FOREST: return 1.2; default: return 1; }
}
export function canBirthOn(t: Terrain): boolean {
  return t === Terrain.GRASS || t === Terrain.FOREST || t === Terrain.DIRT;
}
export function terrainSenseMult(t: Terrain): number {
  return t === Terrain.FOREST ? 0.5 : 1.0;
}
