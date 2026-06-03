import type { Pixel, World, SimConfig, FoodPatch } from './types';
import { createPixel, createRandomDna } from './pixel';
import { generateTerrain, isPassable } from './terrain';
import { createWeather } from './weather';
import {
  POP_HISTORY_LENGTH, FOOD_PATCH_COUNT,
  FOOD_PATCH_RADIUS_MIN, FOOD_PATCH_RADIUS_MAX,
  FOOD_PATCH_LIFE_MIN, FOOD_PATCH_LIFE_MAX,
  EVENT_INTERVAL_MIN, EVENT_INTERVAL_MAX,
} from './constants';

export function createWorld(config: SimConfig): World {
  const { worldWidth: w, worldHeight: h } = config;
  const n = w * h;
  return {
    width: w, height: h,
    pixels: new Map(),
    terrain: generateTerrain(w, h),
    food: new Float32Array(n),
    foodBuf: new Float32Array(n),
    pheromone: new Float32Array(n),
    corpses: new Uint8Array(n),
    wear: new Uint8Array(n),
    territory: new Uint16Array(n),  // 0 = unclaimed
    territoryAge: new Uint16Array(n),
    foodPatches: initPatches(w, h),
    tick: 0, season: 'spring', seasonTick: 0,
    nextPixelId: 1, emptyTicks: 0,
    popHistory: [], prevPopulation: 0,
    nextEventTick: randomInt(EVENT_INTERVAL_MIN, EVENT_INTERVAL_MAX),
    activeEvent: null,
    weather: createWeather(),
  };
}

function initPatches(w: number, h: number): FoodPatch[] {
  const patches: FoodPatch[] = [];
  for (let i = 0; i < FOOD_PATCH_COUNT; i++) patches.push(createFoodPatch(w, h));
  return patches;
}

export function createFoodPatch(w: number, h: number): FoodPatch {
  const angle = Math.random() * Math.PI * 2;
  return {
    x: Math.random() * w, y: Math.random() * h,
    radius: randomInt(FOOD_PATCH_RADIUS_MIN, FOOD_PATCH_RADIUS_MAX),
    channel: 0, // unused now but kept for type compat
    strength: 0.02 + Math.random() * 0.02,
    dx: Math.cos(angle) * 0.02, dy: Math.sin(angle) * 0.02,
    life: randomInt(FOOD_PATCH_LIFE_MIN, FOOD_PATCH_LIFE_MAX),
  };
}

export function seedPixels(world: World, config: SimConfig): void {
  const { worldWidth: w, worldHeight: h } = config;
  const count = Math.min(config.initialPopulation, Math.floor(w * h * 0.5));
  for (let i = 0; i < count; i++) {
    const x = Math.floor(Math.random() * w);
    const y = Math.floor(Math.random() * h);
    const key = y * w + x;
    if (world.pixels.has(key)) continue;
    if (!isPassable(world.terrain[key])) continue; // don't spawn in water
    world.pixels.set(key, createPixel(world.nextPixelId++, x, y, createRandomDna()));
  }
}

export function wrapX(x: number, w: number): number { return ((x % w) + w) % w; }
export function wrapY(y: number, h: number): number { return ((y % h) + h) % h; }
export function cellKey(x: number, y: number, w: number): number { return y * w + x; }

export function getFood(world: World, x: number, y: number): number {
  return world.food[y * world.width + x];
}
export function addFood(world: World, x: number, y: number, amount: number): void {
  const idx = y * world.width + x;
  world.food[idx] = Math.max(0, Math.min(1, world.food[idx] + amount));
}
export function addPheromone(world: World, x: number, y: number, amount: number): void {
  const idx = y * world.width + x;
  world.pheromone[idx] = Math.max(0, Math.min(1, world.pheromone[idx] + amount));
}

export function removePixel(world: World, pixel: Pixel): void {
  world.pixels.delete(pixel.y * world.width + pixel.x);
}
export function movePixelTo(world: World, pixel: Pixel, nx: number, ny: number): void {
  world.pixels.delete(pixel.y * world.width + pixel.x);
  pixel.x = nx; pixel.y = ny; pixel.wallTicks = 0;
  world.pixels.set(ny * world.width + nx, pixel);
}

export function recordPopulation(world: World): void {
  world.popHistory.push(world.pixels.size);
  if (world.popHistory.length > POP_HISTORY_LENGTH) world.popHistory.shift();
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
