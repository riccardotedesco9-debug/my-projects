import type { Pixel, World, TickEvents } from './types';
import { GENE } from './types';
import { getEffectiveGene } from './pixel';
import { wrapX, wrapY, cellKey, movePixelTo } from './world';
import { genomeSimilarity } from './genome';
import { isPassable } from './terrain';
import {
  ADHESION_THRESHOLD, SIMILARITY_BONUS_THRESHOLD,
  DISSIMILARITY_FLEE_THRESHOLD, COOPERATION_BONUS,
  SOCIAL_DOUBLE_THRESHOLD,
} from './constants';

const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
const DY = [-1, -1, -1, 0, 0, 1, 1, 1];

export function applyAdhesion(pixel: Pixel, world: World, _events: TickEvents): void {
  const adhesionGene = getEffectiveGene(pixel, GENE.ADHESION);
  if (adhesionGene < ADHESION_THRESHOLD) return;

  let maxSim = 0;
  let minSim = 16;
  let hasNeighbor = false;

  // Check all 8 neighbors for genetic similarity
  for (let i = 0; i < 8; i++) {
    const nx = wrapX(pixel.x + DX[i], world.width);
    const ny = wrapY(pixel.y + DY[i], world.height);
    const neighbor = world.pixels.get(cellKey(nx, ny, world.width));
    if (!neighbor) continue;

    hasNeighbor = true;
    const sim = genomeSimilarity(pixel.dna, neighbor.dna);
    if (sim > maxSim) maxSim = sim;
    if (sim < minSim) minSim = sim;
  }

  if (!hasNeighbor) return;

  // Cooperation bonus for similar neighbors
  if (maxSim >= SIMILARITY_BONUS_THRESHOLD) {
    const bonus = pixel.state[2] > SOCIAL_DOUBLE_THRESHOLD
      ? COOPERATION_BONUS * 2
      : COOPERATION_BONUS;
    pixel.energy += bonus;
    pixel.state[2] = Math.min(255, pixel.state[2] + 5); // boost social state
  }

  // Flee from very different neighbors
  if (minSim <= DISSIMILARITY_FLEE_THRESHOLD) {
    // Try to move to a random empty cell away from the dissimilar neighbor
    const order = shuffled8();
    for (const i of order) {
      const nx = wrapX(pixel.x + DX[i], world.width);
      const ny = wrapY(pixel.y + DY[i], world.height);
      const key = cellKey(nx, ny, world.width);
      if (!world.pixels.has(key) && isPassable(world.terrain[key])) {
        movePixelTo(world, pixel, nx, ny);
        break;
      }
    }
  }
}

function shuffled8(): number[] {
  const arr = [0, 1, 2, 3, 4, 5, 6, 7];
  for (let i = 7; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
