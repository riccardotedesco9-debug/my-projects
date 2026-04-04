// Territory system: high-adhesion creatures claim nearby cells
// Other creatures pay a movement penalty entering foreign territory

import type { Pixel, World } from './types';
import { GENE } from './types';
import { wrapX, wrapY } from './world';
import {
  TERRITORY_ADHESION_MIN, TERRITORY_MARK_RADIUS,
  TERRITORY_DECAY_RATE, TERRITORY_MAX_AGE,
  TERRITORY_MOVE_PENALTY,
} from './constants';

// Mark territory around a creature if it has high adhesion and has been stationary
export function markTerritory(pixel: Pixel, world: World): void {
  if (pixel.dna[GENE.ADHESION] < TERRITORY_ADHESION_MIN) return;
  // Must have been in area for a few ticks (not just passing through)
  if (pixel.wallTicks < 3 && pixel.age < 10) return;

  const { width: w, height: h } = world;
  const r = TERRITORY_MARK_RADIUS;

  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue; // circular radius
      const nx = wrapX(pixel.x + dx, w);
      const ny = wrapY(pixel.y + dy, h);
      const ci = ny * w + nx;
      const currentOwner = world.territory[ci];

      // Claim unclaimed or refresh own territory
      if (currentOwner === 0 || currentOwner === pixel.id) {
        world.territory[ci] = pixel.id;
        world.territoryAge[ci] = 0; // reset age
      }
      // Don't overwrite another creature's fresh territory
    }
  }
}

// Decay all territories — called once per tick
export function decayTerritories(world: World): void {
  const n = world.width * world.height;
  for (let i = 0; i < n; i++) {
    if (world.territory[i] === 0) continue;
    world.territoryAge[i] += TERRITORY_DECAY_RATE;
    if (world.territoryAge[i] >= TERRITORY_MAX_AGE) {
      world.territory[i] = 0;
      world.territoryAge[i] = 0;
    }
  }
}

// Get movement cost multiplier for entering a cell owned by another creature
export function getTerritoryMoveCost(pixel: Pixel, world: World, nx: number, ny: number): number {
  const ci = ny * world.width + nx;
  const owner = world.territory[ci];
  if (owner === 0 || owner === pixel.id) return 1.0;
  // Foreign territory — check if owner is similar (same species = no penalty)
  // Simple heuristic: check if owner is still alive and has different role
  // For performance, just apply the penalty for any foreign territory
  return TERRITORY_MOVE_PENALTY;
}

// Get territory color for rendering (based on owner's DNA hash)
export function getTerritoryColor(world: World, ci: number): [number, number, number, number] | null {
  const ownerId = world.territory[ci];
  if (ownerId === 0) return null;
  // Simple color from owner ID
  const age = world.territoryAge[ci];
  const alpha = Math.max(0.05, 0.3 * (1 - age / TERRITORY_MAX_AGE));
  const hue = (ownerId * 137) % 360;
  // HSL to RGB approximation for overlay
  const h = hue / 60;
  const x = 1 - Math.abs(h % 2 - 1);
  let r = 0, g = 0, b = 0;
  if (h < 1) { r = 1; g = x; }
  else if (h < 2) { r = x; g = 1; }
  else if (h < 3) { g = 1; b = x; }
  else if (h < 4) { g = x; b = 1; }
  else if (h < 5) { r = x; b = 1; }
  else { r = 1; b = x; }
  return [Math.floor(r * 200 + 55), Math.floor(g * 200 + 55), Math.floor(b * 200 + 55), alpha];
}
