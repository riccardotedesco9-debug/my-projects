// Territory system: creatures of the same species (similar DNA) share territory
// Territory is tracked by species cluster, not individual creature

import type { Pixel, World } from './types';
import { GENE } from './types';
import { wrapX, wrapY } from './world';
import {
  TERRITORY_ADHESION_MIN, TERRITORY_MARK_RADIUS,
  TERRITORY_DECAY_RATE, TERRITORY_MAX_AGE,
  TERRITORY_MOVE_PENALTY,
} from './constants';
import { getCreatureRole } from './metabolism';

// Territory owner = role (0-6), not individual pixel ID
// This means all wolves share wolf territory, all plants share plant territory

export function markTerritory(pixel: Pixel, world: World): void {
  if (pixel.dna[GENE.ADHESION] < TERRITORY_ADHESION_MIN) return;
  if (pixel.wallTicks < 3 && pixel.age < 10) return;

  const { width: w, height: h } = world;
  const r = TERRITORY_MARK_RADIUS;
  const ownerRole = getCreatureRole(pixel) + 1; // +1 so 0 stays "unclaimed"

  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const nx = wrapX(pixel.x + dx, w);
      const ny = wrapY(pixel.y + dy, h);
      const ci = ny * w + nx;
      const currentOwner = world.territory[ci];

      // Claim unclaimed or refresh same-species territory
      if (currentOwner === 0 || currentOwner === ownerRole) {
        world.territory[ci] = ownerRole;
        world.territoryAge[ci] = 0;
      }
    }
  }
}

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

// Foreign territory = different role owns it
export function getTerritoryMoveCost(pixel: Pixel, world: World, nx: number, ny: number): number {
  const ci = ny * world.width + nx;
  const owner = world.territory[ci];
  if (owner === 0) return 1.0; // unclaimed
  const myRole = getCreatureRole(pixel) + 1;
  if (owner === myRole) return 1.0; // own species territory
  return TERRITORY_MOVE_PENALTY;
}

// Territory color based on role (consistent with role colors)
const TERRITORY_ROLE_COLORS: [number, number, number][] = [
  [0, 0, 0],          // 0 = unclaimed (never drawn)
  [68, 204, 68],      // 1 = plant (green)
  [204, 136, 68],     // 2 = hunter (orange)
  [204, 51, 51],      // 3 = apex (red)
  [170, 136, 102],    // 4 = scavenger (brown)
  [170, 68, 204],     // 5 = parasite (purple)
  [68, 204, 204],     // 6 = swarm (cyan)
  [204, 204, 68],     // 7 = nomad (yellow)
];

export function getTerritoryColor(world: World, ci: number): [number, number, number, number] | null {
  const owner = world.territory[ci];
  if (owner === 0 || owner > 7) return null;
  const age = world.territoryAge[ci];
  const alpha = Math.max(0.05, 0.25 * (1 - age / TERRITORY_MAX_AGE));
  const [r, g, b] = TERRITORY_ROLE_COLORS[owner];
  return [r, g, b, alpha];
}
