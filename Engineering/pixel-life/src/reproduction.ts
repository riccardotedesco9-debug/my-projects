import type { Pixel, World, SimConfig, TickEvents } from './types';
import { GENE } from './types';
import { getEffectiveGene, createPixel } from './pixel';
import { wrapX, wrapY, cellKey } from './world';
import { canBirthOn } from './terrain';
import { mutateDna, mutateRegulatoryGenes } from './genome';
import { dnaToColor } from './color-map';
import { getCreatureRole } from './metabolism';
import { addBirthEffect, toCanvasCenter } from './effects';
import {
  REPRO_MIN_ENERGY, REPRO_MAX_ENERGY, REPRO_TAX,
  REPRO_SHARE_MIN, REPRO_SHARE_MAX, MAX_POP_FRACTION,
  SATIETY_REPRO_THRESHOLD,
} from './constants';

const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
const DY = [-1, -1, -1, 0, 0, 1, 1, 1];

export function tryReproduce(
  pixel: Pixel,
  world: World,
  config: SimConfig,
  events: TickEvents,
): void {
  // Population cap check
  if (world.pixels.size >= world.width * world.height * MAX_POP_FRACTION) return;

  // Energy threshold check
  const reproGene = getEffectiveGene(pixel, GENE.REPRO_THRESHOLD);
  const threshold = REPRO_MIN_ENERGY + (reproGene / 255) * (REPRO_MAX_ENERGY - REPRO_MIN_ENERGY);

  if (pixel.energy < threshold) return;

  // Satiety state: if high, prioritize reproduction (lower effective threshold by 20%)
  const effectiveThreshold = pixel.state[1] > SATIETY_REPRO_THRESHOLD
    ? threshold * 0.8
    : threshold;

  if (pixel.energy < effectiveThreshold) return;

  // Find empty neighbor cell
  const emptyCell = findEmptyNeighbor(pixel, world);
  if (!emptyCell) return;

  const [nx, ny] = emptyCell;

  // Create offspring DNA with mutations
  const childDna = mutateDna(pixel.dna, pixel.dna[GENE.MUTATION_RATE], config.mutationIntensity);
  const childRegGenes = mutateRegulatoryGenes(pixel.regulatoryGenes);

  // Energy split
  const shareGene = getEffectiveGene(pixel, GENE.REPRO_SHARE) / 255;
  const shareFraction = REPRO_SHARE_MIN + shareGene * (REPRO_SHARE_MAX - REPRO_SHARE_MIN);
  const effectiveReproTax = (config as any).reproTax ?? REPRO_TAX;
  const childEnergy = pixel.energy * shareFraction - effectiveReproTax / 2;
  pixel.energy = pixel.energy * (1 - shareFraction) - effectiveReproTax / 2;

  const child = createPixel(
    world.nextPixelId++,
    nx, ny,
    childDna,
    childRegGenes,
    Math.max(1, childEnergy),
    pixel.generation + 1,
  );

  world.pixels.set(cellKey(nx, ny, world.width), child);
  events.births++;

  // Visual effect: birth ring in parent's color
  const [cr, cg, cb] = dnaToColor(pixel.dna, pixel.energy, getCreatureRole(pixel));
  const [bx, by] = toCanvasCenter(nx, ny, config.pixelScale);
  addBirthEffect(bx, by, cr, cg, cb);
}

function findEmptyNeighbor(pixel: Pixel, world: World): [number, number] | null {
  // Randomize order to avoid directional bias
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
