import type { World, SimConfig, Season } from './types';
import { createFoodPatch } from './world';
import { Terrain } from './types';
import { terrainFoodRate } from './terrain';
import { weatherFoodMult, weatherDecayMult } from './weather';
import {
  SPRING_EMISSION_MULT, SUMMER_EMISSION_MULT,
  WINTER_EMISSION_MULT, AUTUMN_DIFFUSION_MULT,
  PHEROMONE_DECAY, CORPSE_DECAY_RATE,
} from './constants';

// Pre-computed neighbor offsets
let neighborOffsets: Int32Array;
let cachedW = 0, cachedH = 0;

function ensureOffsets(w: number, h: number): void {
  if (w === cachedW && h === cachedH) return;
  cachedW = w; cachedH = h;
  const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
  const DY = [-1, -1, -1, 0, 0, 1, 1, 1];
  neighborOffsets = new Int32Array(w * h * 8);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const base = (y * w + x) * 8;
      for (let i = 0; i < 8; i++) {
        neighborOffsets[base + i] = ((y + DY[i] + h) % h) * w + ((x + DX[i] + w) % w);
      }
    }
}

export function updateSubstrate(world: World, config: SimConfig): void {
  ensureOffsets(world.width, world.height);
  emitFromTerrain(world, config);
  emitFromPatches(world);
  diffuseFood(world, config);
  decayFood(world, config);
  decayPheromone(world);
  decayCorpses(world);
  decayWear(world);
  driftFoodPatches(world);
}

// Terrain-based food emission — SPARSE, not every tile every tick
// Only ~5% of fertile cells emit food per tick (stochastic), creating natural patchiness
function emitFromTerrain(world: World, config: SimConfig): void {
  const { width: w, height: h, food, terrain } = world;
  const base = config.substrateEmission * getEmissionMult(world.season) * weatherFoodMult(world.weather);
  // Use tick-based hash to select which cells emit this tick (~5% per tick)
  const tickSeed = world.tick * 2654435761;
  for (let y = 0; y < h; y++) {
    const latFactor = getSeasonalLatitude(y, h, world.season);
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const t = terrain[i];
      let rate = terrainFoodRate(t);
      if (rate <= 0) continue;

      // Stochastic emission: only ~5% of cells produce food each tick
      // Deterministic hash so each cell gets its turn regularly
      if (((tickSeed + x * 7 + y * 13) & 0x1f) !== 0) continue; // 1/32 chance per tick

      // When a cell does emit, it produces more (compensating for low frequency)
      if (t === Terrain.GRASS || t === Terrain.DIRT || t === Terrain.FOREST) {
        if (hasAdjacentWater(terrain, x, y, w, h)) rate *= 1.3;
      }
      food[i] = Math.min(1, food[i] + base * rate * latFactor * 20); // 20x burst since only 1/32 tick
    }
  }
}

// Geographic food gradient: creates seasonal migration pressure
// Returns multiplier 0.75-1.25 based on latitude and season
function getSeasonalLatitude(y: number, h: number, season: Season): number {
  const lat = y / h; // 0 = north, 1 = south
  // Stronger gradient: 0.3x to 1.7x — creates real migration pressure
  switch (season) {
    case 'summer': return 0.3 + (1 - lat) * 1.4;  // north is lush, south is barren
    case 'winter': return 0.3 + lat * 1.4;          // south is lush, north is barren
    case 'spring': return 0.5 + (1 - lat) * 1.0;   // north warming up
    case 'autumn': return 0.5 + lat * 1.0;          // south holds warmth longer
  }
}

function hasAdjacentWater(terrain: Uint8Array, x: number, y: number, w: number, h: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = ((x + dx) % w + w) % w;
      const ny = ((y + dy) % h + h) % h;
      if (terrain[ny * w + nx] === Terrain.WATER) return true;
    }
  }
  return false;
}

function emitFromPatches(world: World): void {
  const { width: w, height: h, food, foodPatches } = world;
  for (const p of foodPatches) {
    if (p.life <= 0) continue;
    const px = p.x | 0, py = p.y | 0, r2 = p.radius * p.radius;
    for (let dy = -p.radius; dy <= p.radius; dy++) {
      for (let dx = -p.radius; dx <= p.radius; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const nx = ((px + dx) % w + w) % w;
        const ny = ((py + dy) % h + h) % h;
        const falloff = 1 - Math.sqrt(d2) / p.radius;
        const idx = ny * w + nx;
        food[idx] = Math.min(1, food[idx] + p.strength * falloff * 0.15);
      }
    }
  }
}

function diffuseFood(world: World, config: SimConfig): void {
  const { width: w, height: h, food, foodBuf } = world;
  const D = config.substrateDiffusion * getDiffMult(world.season);
  foodBuf.set(food);

  const n = w * h;
  for (let i = 0; i < n; i++) {
    const val = food[i];
    if (val < 0.001) continue;
    const transfer = val * D;
    const per = transfer * 0.125;
    foodBuf[i] -= transfer;
    const nBase = i * 8;
    for (let j = 0; j < 8; j++) {
      foodBuf[neighborOffsets[nBase + j]] += per;
    }
  }
  food.set(foodBuf);
}

function decayFood(world: World, config: SimConfig): void {
  const f = world.food;
  // Drought accelerates food decay
  const decay = Math.pow(config.substrateDecay, weatherDecayMult(world.weather));
  for (let i = 0; i < f.length; i++) f[i] *= decay;
}

function decayPheromone(world: World): void {
  const p = world.pheromone;
  for (let i = 0; i < p.length; i++) p[i] *= PHEROMONE_DECAY;
}

function decayCorpses(world: World): void {
  const c = world.corpses;
  for (let i = 0; i < c.length; i++) {
    if (c[i] > CORPSE_DECAY_RATE) c[i] -= CORPSE_DECAY_RATE; else c[i] = 0;
  }
}

function decayWear(world: World): void {
  // Wear decays slowly — paths fade over time
  if (world.tick % 20 === 0) {
    const w = world.wear;
    for (let i = 0; i < w.length; i++) { if (w[i] > 0) w[i]--; }
  }
}

function driftFoodPatches(world: World): void {
  const { width: w, height: h } = world;
  for (let i = 0; i < world.foodPatches.length; i++) {
    const p = world.foodPatches[i];
    p.life--;
    p.x = ((p.x + p.dx) % w + w) % w;
    p.y = ((p.y + p.dy) % h + h) % h;
    if (p.life <= 0) world.foodPatches[i] = createFoodPatch(w, h);
  }
}

function getEmissionMult(s: Season): number {
  return s === 'spring' ? SPRING_EMISSION_MULT : s === 'summer' ? SUMMER_EMISSION_MULT
    : s === 'winter' ? WINTER_EMISSION_MULT : 1.0;
}
function getDiffMult(s: Season): number {
  return s === 'autumn' ? AUTUMN_DIFFUSION_MULT : 1.0;
}
