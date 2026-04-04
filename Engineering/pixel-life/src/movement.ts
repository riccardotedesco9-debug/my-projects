import type { Pixel, World, SimConfig, TickEvents } from './types';
import { GENE } from './types';
import { getEffectiveGene } from './pixel';
import { wrapX, wrapY, cellKey, movePixelTo, addPheromone } from './world';
import { resolveReaction } from './reactions';
import { isPassable, givesCover, terrainSpeedMult, terrainMoveCost, terrainSenseMult } from './terrain';
import { weatherSenseMult, weatherMoveCostMult } from './weather';
import { MOVE_COST, THREAT_FLEE_THRESHOLD, CAMOUFLAGE_CHANCE, TRAIL_INTENSITY } from './constants';

const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
const DY = [-1, -1, -1, 0, 0, 1, 1, 1];

export function movePixel(pixel: Pixel, world: World, config: SimConfig, events: TickEvents): void {
  // Terrain affects movement speed
  const currentTerrain = world.terrain[pixel.y * world.width + pixel.x];
  const speed = (getEffectiveGene(pixel, GENE.SPEED) / 255) * terrainSpeedMult(currentTerrain);
  if (Math.random() > speed) { pixel.wallTicks++; return; }

  // Terrain + weather affect sensing range
  const baseSense = Math.floor(getEffectiveGene(pixel, GENE.SENSE_RANGE) / 255 * 5);
  const senseRange = Math.max(1, Math.floor(baseSense * terrainSenseMult(currentTerrain) * weatherSenseMult(world.weather)));
  let senseTarget = getEffectiveGene(pixel, GENE.SENSE_TARGET);

  // State overrides
  if (pixel.state[0] > THREAT_FLEE_THRESHOLD && senseTarget < 170) senseTarget = 200;
  if (pixel.energy < 40 && pixel.dna[GENE.REACT_TYPE] < 64 && senseTarget < 85) senseTarget = 120;

  let bestDx = 0, bestDy = 0;

  if (senseRange === 0) {
    const dir = Math.floor(Math.random() * 8);
    bestDx = DX[dir]; bestDy = DY[dir];
  } else if (senseTarget < 60) {
    [bestDx, bestDy] = seekFood(pixel, world, senseRange);
  } else if (senseTarget < 85) {
    [bestDx, bestDy] = seekPheromone(pixel, world);
  } else if (senseTarget < 170) {
    [bestDx, bestDy] = seekPixel(pixel, world, senseRange, false);
  } else {
    [bestDx, bestDy] = seekPixel(pixel, world, senseRange, true);
  }

  if (bestDx === 0 && bestDy === 0) {
    const dir = Math.floor(Math.random() * 8);
    bestDx = DX[dir]; bestDy = DY[dir];
  }

  const nx = wrapX(pixel.x + bestDx, world.width);
  const ny = wrapY(pixel.y + bestDy, world.height);

  // Water blocks movement
  if (!isPassable(world.terrain[ny * world.width + nx])) return;

  const occupant = world.pixels.get(cellKey(nx, ny, world.width));
  if (occupant) {
    resolveReaction(pixel, occupant, world, config, events);
  } else {
    // Leave footprint (wear) and pheromone at old position
    const oldIdx = pixel.y * world.width + pixel.x;
    if (world.wear[oldIdx] < 250) world.wear[oldIdx] += 2;
    addPheromone(world, pixel.x, pixel.y, TRAIL_INTENSITY);

    movePixelTo(world, pixel, nx, ny);
    // Terrain + worn path affects movement cost
    const destIdx = ny * world.width + nx;
    const wornBonus = world.wear[destIdx] > 100 ? 0.9 : 1.0; // worn paths are easier
    pixel.energy -= MOVE_COST * terrainMoveCost(world.terrain[destIdx]) * wornBonus * weatherMoveCostMult(world.weather);
  }
}

function seekFood(pixel: Pixel, world: World, range: number): [number, number] {
  const { width: w, height: h } = world;
  let best = -1, bx = 0, by = 0;
  for (let i = 0; i < 8; i++) {
    const nx = wrapX(pixel.x + DX[i], w), ny = wrapY(pixel.y + DY[i], h);
    if (!isPassable(world.terrain[ny * w + nx])) continue;
    const f = world.food[ny * w + nx];
    if (f > best) { best = f; bx = DX[i]; by = DY[i]; }
  }
  if (range > 1) {
    for (let i = 0; i < 8; i++) {
      const nx = wrapX(pixel.x + DX[i] * range, w), ny = wrapY(pixel.y + DY[i] * range, h);
      if (!isPassable(world.terrain[ny * w + nx])) continue;
      const f = world.food[ny * w + nx];
      if (f > best) { best = f; bx = DX[i]; by = DY[i]; }
    }
  }
  return [bx, by];
}

function seekPheromone(pixel: Pixel, world: World): [number, number] {
  const { width: w, height: h } = world;
  let best = -1, bx = 0, by = 0;
  for (let i = 0; i < 8; i++) {
    const nx = wrapX(pixel.x + DX[i], w), ny = wrapY(pixel.y + DY[i], h);
    if (!isPassable(world.terrain[ny * w + nx])) continue;
    const p = world.pheromone[ny * w + nx];
    if (p > best) { best = p; bx = DX[i]; by = DY[i]; }
  }
  return [bx, by];
}

function seekPixel(pixel: Pixel, world: World, range: number, flee: boolean): [number, number] {
  const { width: w, height: h } = world;
  let bestDist = range * range + 1, bx = 0, by = 0;
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = wrapX(pixel.x + dx, w), ny = wrapY(pixel.y + dy, h);
      const target = world.pixels.get(cellKey(nx, ny, w));
      if (!target) continue;
      // Forest provides cover — harder to spot prey
      if (givesCover(world.terrain[ny * w + nx]) && Math.random() < CAMOUFLAGE_CHANCE) continue;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        bx = flee ? -Math.sign(dx) : Math.sign(dx);
        by = flee ? -Math.sign(dy) : Math.sign(dy);
      }
    }
  }
  return [bx, by];
}
