// Locomotion system: determines if creatures can swim or fly
// Derived from existing genes — no new genome slots needed
// Swimming: high Harvest_B (>180) = aquatic adaptation
// Flying: high Speed (>200) + low Armor (<60) = light enough to fly

import type { Pixel } from './types';
import { GENE, Terrain } from './types';

export type LocomotionType = 'walk' | 'swim' | 'fly';

// Determine a creature's locomotion type from its genome
export function getLocomotion(pixel: Pixel): LocomotionType {
  const speed = pixel.dna[GENE.SPEED];
  const armor = pixel.dna[GENE.ARMOR];
  const harvestB = pixel.dna[GENE.HARVEST_B];

  // Flying: very fast + very light (speed > 200, armor < 60)
  if (speed > 200 && armor < 60) return 'fly';

  // Swimming: high blue harvest (aquatic food specialist, harvest_B > 180)
  if (harvestB > 180) return 'swim';

  return 'walk';
}

// Can this creature enter this terrain type?
export function canTraverse(pixel: Pixel, terrain: Terrain): boolean {
  const loco = getLocomotion(pixel);

  if (terrain === Terrain.WATER) {
    return loco === 'swim' || loco === 'fly'; // walkers can't enter water
  }
  return true; // all types can walk on land
}

// Movement cost modifier based on locomotion
export function locomotionMoveCost(pixel: Pixel, terrain: Terrain): number {
  const loco = getLocomotion(pixel);

  if (loco === 'fly') {
    // Flyers ignore terrain cost penalties (always 0.8x) but higher base upkeep
    return 0.8;
  }
  if (loco === 'swim' && terrain === Terrain.WATER) {
    return 0.7; // swimming in water is natural — cheaper than walking
  }
  if (loco === 'swim' && terrain !== Terrain.WATER) {
    return 1.3; // fish on land are slow
  }
  return 1.0; // normal walker
}

// Extra upkeep cost for flight (balances the mobility advantage)
export function locomotionUpkeepMult(pixel: Pixel): number {
  const loco = getLocomotion(pixel);
  if (loco === 'fly') return 1.25; // 25% extra upkeep — flight costs but remains viable
  if (loco === 'swim') return 1.1; // 10% extra — gill maintenance
  return 1.0;
}

// Aquatic food rate — water tiles produce food for swimmers
export function aquaticFoodRate(): number {
  return 0.4; // moderate — less than grass but enough to sustain aquatic species
}
