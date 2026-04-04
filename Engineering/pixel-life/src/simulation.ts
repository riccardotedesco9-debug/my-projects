import type { World, SimConfig, Pixel, TickEvents } from './types';
import { createTickEvents } from './types';
import { updateSubstrate } from './substrate';
import { updateSeasons } from './seasons';
import { metabolize } from './metabolism';
import { movePixel } from './movement';
import { tryReproduce } from './reproduction';
import { applyAdhesion } from './adhesion';
import { decayPixelState } from './pixel-state';
import { recordMemory, decayMemory } from './spatial-memory';
import { markTerritory, decayTerritories } from './territory-system';
import { updatePacks } from './pack-hunting';
import { updateMigration, onSeasonChange } from './migration';
import { updateSpeciesTree } from './species-tree';
import { updateArmsRace } from './arms-race';
import { updateEcosystemGraph } from './ecosystem-graph';
import { trySexualReproduction } from './sexual-reproduction';
import { updateEvents } from './events';
import { updateWeather } from './weather';
import { seedPixels, recordPopulation } from './world';
import { AUTO_SEED_EMPTY_TICKS, AUTO_SEED_COUNT } from './constants';

let shuffleArr: Pixel[] = [];
export let lastTickEvents: TickEvents = createTickEvents();

export function simulateTick(world: World, config: SimConfig): void {
  const events = createTickEvents();

  updateSubstrate(world, config);
  const prevSeason = world.season;
  updateSeasons(world, config);
  if (world.season !== prevSeason) onSeasonChange(world, world.season);
  updateEvents(world, events);
  updateWeather(world.weather, world, config);

  // Shuffle pixels for fair processing
  shuffleArr.length = 0;
  for (const pixel of world.pixels.values()) shuffleArr.push(pixel);
  fisherYatesShuffle(shuffleArr);

  for (const pixel of shuffleArr) {
    // Verify pixel still exists (may have been killed by another pixel or event)
    const key = pixel.y * world.width + pixel.x;
    if (world.pixels.get(key) !== pixel) continue;

    decayPixelState(pixel);
    decayMemory(pixel);
    const alive = metabolize(pixel, world, config, events);
    if (alive) recordMemory(pixel, world);
    if (!alive) continue;

    movePixel(pixel, world, config, events);
    if (world.pixels.get(pixel.y * world.width + pixel.x) !== pixel) continue;

    applyAdhesion(pixel, world, events);
    markTerritory(pixel, world);
    tryReproduce(pixel, world, config, events);
  }

  // Sexual reproduction pass (10% sample)
  checkSexualReproduction(world, config, events);

  decayTerritories(world);
  updatePacks(world);
  updateMigration(world);
  updateSpeciesTree(world);
  updateArmsRace(world);
  updateEcosystemGraph(world);
  recordPopulation(world);

  // Auto-seed if population is zero
  if (world.pixels.size === 0) {
    world.emptyTicks++;
    if (world.emptyTicks >= AUTO_SEED_EMPTY_TICKS) {
      seedPixels(world, { ...config, initialPopulation: AUTO_SEED_COUNT });
      world.emptyTicks = 0;
    }
  } else {
    world.emptyTicks = 0;
  }

  world.prevPopulation = world.pixels.size;
  world.tick++;
  lastTickEvents = events;
}

function checkSexualReproduction(world: World, config: SimConfig, events: TickEvents): void {
  const pixels = Array.from(world.pixels.values());
  const sample = Math.max(1, Math.floor(pixels.length * 0.1));

  for (let i = 0; i < sample; i++) {
    const pixel = pixels[Math.floor(Math.random() * pixels.length)];
    if (pixel.dna[6] < 64 || pixel.dna[6] >= 128) continue;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = ((pixel.x + dx) % world.width + world.width) % world.width;
        const ny = ((pixel.y + dy) % world.height + world.height) % world.height;
        const neighbor = world.pixels.get(ny * world.width + nx);
        if (!neighbor || neighbor.dna[6] < 64 || neighbor.dna[6] >= 128) continue;
        trySexualReproduction(pixel, neighbor, world, config, events);
        break;
      }
    }
  }
}

function fisherYatesShuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
}
