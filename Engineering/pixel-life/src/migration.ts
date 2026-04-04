// Migration: nomads and fast creatures develop seasonal routes
// They remember food quality at locations per season, then migrate when season changes

import type { Pixel, World, Season } from './types';
import { GENE } from './types';
// Migration leverages seasonal food memory to guide fast creatures

const MIGRATION_UPDATE_INTERVAL = 100;
const MIGRATION_SPEED_MIN = 150;      // creatures must be fast to migrate

let lastUpdateTick = 0;
let prevSeason: Season = 'spring';

// Record seasonal food quality at season transitions
export function onSeasonChange(world: World, newSeason: Season): void {
  if (newSeason === prevSeason) return;
  const oldSeason = prevSeason;
  prevSeason = newSeason;

  // All creatures record their current position's food quality for the ending season
  for (const pixel of world.pixels.values()) {
    const idx = pixel.y * world.width + pixel.x;
    const foodQuality = world.food[idx];

    // Update or add seasonal memory
    const existing = pixel.seasonalMemory.find(m => m.season === oldSeason);
    if (existing) {
      // Blend with previous memory (running average)
      existing.x = Math.floor((existing.x + pixel.x) / 2);
      existing.y = Math.floor((existing.y + pixel.y) / 2);
      existing.food = existing.food * 0.5 + foodQuality * 0.5;
    } else {
      pixel.seasonalMemory.push({ season: oldSeason, x: pixel.x, y: pixel.y, food: foodQuality });
      // Keep max 4 entries (one per season)
      if (pixel.seasonalMemory.length > 4) pixel.seasonalMemory.shift();
    }
  }
}

// Update migration targets periodically
export function updateMigration(world: World): void {
  if (world.tick - lastUpdateTick < MIGRATION_UPDATE_INTERVAL) return;
  lastUpdateTick = world.tick;

  for (const pixel of world.pixels.values()) {
    // Only fast creatures (nomads, fast hunters) migrate
    if (pixel.dna[GENE.SPEED] < MIGRATION_SPEED_MIN) {
      pixel.migrationTarget = null;
      continue;
    }

    // Find best remembered location for the upcoming season
    const upcomingSeason = getNextSeason(world.season);
    const memory = pixel.seasonalMemory.find(m => m.season === upcomingSeason);

    if (memory && memory.food > 0.2) {
      pixel.migrationTarget = { x: memory.x, y: memory.y };
    } else if (pixel.seasonalMemory.length > 0) {
      // Fall back to best known location across all seasons
      let best = pixel.seasonalMemory[0];
      for (const m of pixel.seasonalMemory) {
        if (m.food > best.food) best = m;
      }
      if (best.food > 0.15) {
        pixel.migrationTarget = { x: best.x, y: best.y };
      }
    }
  }
}

// Get migration direction bias
export function getMigrationBias(pixel: Pixel, worldW: number, worldH: number): [number, number] {
  if (!pixel.migrationTarget) return [0, 0];

  let dx = pixel.migrationTarget.x - pixel.x;
  let dy = pixel.migrationTarget.y - pixel.y;

  // Toroidal wrapping
  if (Math.abs(dx) > worldW / 2) dx -= Math.sign(dx) * worldW;
  if (Math.abs(dy) > worldH / 2) dy -= Math.sign(dy) * worldH;

  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 3) {
    // Arrived at target — clear it
    pixel.migrationTarget = null;
    return [0, 0];
  }

  return [dx / dist, dy / dist];
}

function getNextSeason(current: Season): Season {
  const order: Season[] = ['spring', 'summer', 'autumn', 'winter'];
  const idx = order.indexOf(current);
  return order[(idx + 1) % 4];
}
