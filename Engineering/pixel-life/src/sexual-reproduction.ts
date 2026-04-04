import type { Pixel, World, SimConfig, TickEvents } from './types';
import { GENE } from './types';
import { getEffectiveGene, createPixel } from './pixel';
import { wrapX, wrapY, cellKey } from './world';
import { canBirthOn } from './terrain';
import { genomeSimilarity, crossoverDna, crossoverRegulatoryGenes, mutateDna, mutateRegulatoryGenes } from './genome';
import { dnaToColor } from './color-map';
import { getCreatureRole } from './metabolism';
import { addBirthEffect, addInteractionEffect, toCanvasCenter } from './effects';
import {
  SEXUAL_MIN_SIMILARITY, SEXUAL_MAX_SIMILARITY,
  HYBRID_VIGOR_MIN, HYBRID_VIGOR_MAX, HYBRID_VIGOR_BONUS,
  REPRO_MIN_ENERGY, REPRO_MAX_ENERGY, REPRO_TAX, MAX_POP_FRACTION,
} from './constants';

const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
const DY = [-1, -1, -1, 0, 0, 1, 1, 1];

// Attempt sexual reproduction when a Share reaction occurs
// between two compatible pixels with enough energy
export function trySexualReproduction(
  a: Pixel,
  b: Pixel,
  world: World,
  config: SimConfig,
  events: TickEvents,
): boolean {
  // Population cap
  if (world.pixels.size >= world.width * world.height * MAX_POP_FRACTION) return false;

  // Both must have energy above their reproduction threshold
  const threshA = REPRO_MIN_ENERGY + (getEffectiveGene(a, GENE.REPRO_THRESHOLD) / 255) * (REPRO_MAX_ENERGY - REPRO_MIN_ENERGY);
  const threshB = REPRO_MIN_ENERGY + (getEffectiveGene(b, GENE.REPRO_THRESHOLD) / 255) * (REPRO_MAX_ENERGY - REPRO_MIN_ENERGY);
  if (a.energy < threshA || b.energy < threshB) return false;

  // Compatibility check: similarity must be in the sweet spot
  const similarity = genomeSimilarity(a.dna, b.dna);
  if (similarity < SEXUAL_MIN_SIMILARITY || similarity > SEXUAL_MAX_SIMILARITY) return false;

  // Find empty cell near either parent
  const emptyCell = findEmptyNear(a, world) ?? findEmptyNear(b, world);
  if (!emptyCell) return false;

  const [nx, ny] = emptyCell;

  // Crossover + mutation
  let childDna = crossoverDna(a.dna, b.dna);
  const avgMutRate = Math.floor((a.dna[GENE.MUTATION_RATE] + b.dna[GENE.MUTATION_RATE]) / 2);
  childDna = mutateDna(childDna, avgMutRate, config.mutationIntensity);

  const childRegGenes = mutateRegulatoryGenes(
    crossoverRegulatoryGenes(a.regulatoryGenes, b.regulatoryGenes)
  );

  // Energy cost: both parents contribute
  const childEnergy = (a.energy + b.energy) * 0.2 - REPRO_TAX;
  a.energy -= a.energy * 0.2 + REPRO_TAX / 2;
  b.energy -= b.energy * 0.2 + REPRO_TAX / 2;

  // Hybrid vigor bonus
  let bonusEnergy = 0;
  if (similarity >= HYBRID_VIGOR_MIN && similarity <= HYBRID_VIGOR_MAX) {
    bonusEnergy = HYBRID_VIGOR_BONUS;
  }

  const child = createPixel(
    world.nextPixelId++,
    nx, ny,
    childDna,
    childRegGenes,
    Math.max(1, childEnergy + bonusEnergy),
    Math.max(a.generation, b.generation) + 1,
  );

  world.pixels.set(cellKey(nx, ny, world.width), child);
  events.sexualRepros++;
  events.births++;

  // Visual: mating effect between parents + birth ring for child
  const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
  const [mx, my] = toCanvasCenter(midX, midY, config.pixelScale);
  addInteractionEffect(mx, my, 'sexual');
  const [cr, cg, cb] = dnaToColor(childDna, childEnergy + bonusEnergy, getCreatureRole(child));
  const [bx, by] = toCanvasCenter(nx, ny, config.pixelScale);
  addBirthEffect(bx, by, cr, cg, cb);
  return true;
}

function findEmptyNear(pixel: Pixel, world: World): [number, number] | null {
  const order = shuffled8();
  for (const i of order) {
    const nx = wrapX(pixel.x + DX[i], world.width);
    const ny = wrapY(pixel.y + DY[i], world.height);
    const key = cellKey(nx, ny, world.width);
    if (!world.pixels.has(key) && canBirthOn(world.terrain[key])) {
      return [nx, ny];
    }
  }
  return null;
}

function shuffled8(): number[] {
  const arr = [0, 1, 2, 3, 4, 5, 6, 7];
  for (let i = 7; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
