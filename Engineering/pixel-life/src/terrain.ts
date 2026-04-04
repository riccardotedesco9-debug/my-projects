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
    case Terrain.GRASS: return 1.0; case Terrain.FOREST: return 0.6;
    case Terrain.DIRT: return 0.3; case Terrain.SAND: return 0.1;
    default: return 0;
  }
}

// Context-aware terrain color: responds to weather, season, and creature wear
export function terrainColorInContext(
  t: Terrain, x: number, y: number,
  weather: string, season: Season, wear: number,
): [number, number, number] {
  // Base color with per-cell noise texture
  const n = ((x * 7 + y * 13) & 0xf) - 8;
  let [r, g, b] = baseColor(t, n);

  // Season tinting
  switch (season) {
    case 'spring':
      if (t === Terrain.GRASS) { g += 8; } // greener
      if (t === Terrain.FOREST) { g += 5; }
      break;
    case 'summer':
      if (t === Terrain.GRASS) { r += 5; g += 3; } // warm green
      break;
    case 'autumn':
      if (t === Terrain.GRASS) { r += 15; g -= 5; } // orange tint
      if (t === Terrain.FOREST) { r += 10; g -= 8; } // red-brown
      if (t === Terrain.DIRT) { r += 5; }
      break;
    case 'winter':
      // Blue-grey tint + snow on grass/rock
      r = (r * 0.8) | 0; g = (g * 0.85) | 0; b += 5;
      if ((t === Terrain.GRASS || t === Terrain.ROCK) && ((x + y) % 3 === 0)) {
        r += 15; g += 15; b += 18; // snow patches
      }
      break;
  }

  // Weather tinting
  switch (weather) {
    case 'rain':
      r = (r * 0.85) | 0; g = (g * 0.88) | 0; b += 3; // darker, wet
      break;
    case 'snow':
      r += 8; g += 8; b += 12; // white tint
      break;
    case 'fog':
      const grey = (r + g + b) / 3;
      r = (r * 0.7 + grey * 0.3) | 0; // desaturate
      g = (g * 0.7 + grey * 0.3) | 0;
      b = (b * 0.7 + grey * 0.3) | 0;
      break;
    case 'storm':
      r = (r * 0.75) | 0; g = (g * 0.75) | 0; b = (b * 0.8) | 0; // dark blue
      break;
    case 'drought':
      if (t === Terrain.GRASS || t === Terrain.FOREST) {
        r += 10; g -= 5; b -= 3; // brown/yellow parched look
      }
      break;
    case 'heatwave':
      r += 6; g += 2; // warm orange tint
      break;
  }

  // Creature wear: darker paths where creatures walk often
  if (wear > 30) {
    const darkening = Math.min(0.3, (wear - 30) / 200);
    r = (r * (1 - darkening)) | 0;
    g = (g * (1 - darkening)) | 0;
    b = (b * (1 - darkening)) | 0;
  }

  return [clamp(r), clamp(g), clamp(b)];
}

function baseColor(t: Terrain, n: number): [number, number, number] {
  switch (t) {
    case Terrain.WATER: return [8 + n, 15 + n, 30 + n * 2];
    case Terrain.SAND: return [35 + n, 30 + n, 15];
    case Terrain.DIRT: return [22 + n, 16 + n, 8];
    case Terrain.GRASS: return [12 + n, 28 + n, 8];
    case Terrain.FOREST: return [6, 18 + n, 6];
    case Terrain.ROCK: return [20 + n, 20 + n, 22 + n];
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
