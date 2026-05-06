import type { Pixel, World, SimConfig, TickEvents } from './types';
import { GENE } from './types';
import { getEffectiveGene } from './pixel';
import { addFood, addPheromone, wrapX, wrapY, cellKey } from './world';
import { weatherUpkeepMult } from './weather';
import { addInteractionEffect, toCanvasCenter } from './effects';
import { locomotionUpkeepMult } from './locomotion';
import {
  MAX_ENERGY, BASE_UPKEEP, SPEED_UPKEEP, SENSE_UPKEEP,
  HARVEST_RATE, WASTE_RATE,
  CATALYZE_BOOST, WINTER_UPKEEP_MULT,
  TROPHIC_INVERSE_FACTOR, ABSORB_SKILL_THRESHOLD,
  CORPSE_HARVEST_RATE,
  PHEROMONE_DEPOSIT_RATE,
} from './constants';

export function metabolize(pixel: Pixel, world: World, config: SimConfig, _events: TickEvents): boolean {
  const { width: w } = world;
  const cellIdx = pixel.y * w + pixel.x;

  // -- Trophic skill --
  const absorbSkill = pixel.dna[GENE.REACT_TYPE] < ABSORB_SKILL_THRESHOLD
    ? (ABSORB_SKILL_THRESHOLD - pixel.dna[GENE.REACT_TYPE]) / ABSORB_SKILL_THRESHOLD : 0;
  const harvestPenalty = 1 - absorbSkill * TROPHIC_INVERSE_FACTOR;

  // -- Harvest food from terrain with food-type preference --
  // Terrain types produce different "flavors" matched by harvest genes:
  //   Grass → R-dominant (leafy), Forest → G-dominant (fruit), Dirt → B-dominant (roots)
  //   Sand/Rock → balanced but scarce. Water → none.
  const catalyzeBoost = world.tick < pixel.catalyzedUntil ? CATALYZE_BOOST : 1.0;
  const terrain = world.terrain[cellIdx];
  const avail = world.food[cellIdx];

  // Food preference multiplier: how well creature's harvest genes match this terrain's food type
  // Food affinity: how well creature's harvest genes match terrain food type
  // Range 0.2 (terrible match) to 1.5 (specialist) — creates strong niche pressure
  let foodAffinity = 0.6; // default for unspecialized terrain
  if (terrain === 3) {
    // Grass: R-rich food
    foodAffinity = 0.2 + (pixel.dna[GENE.HARVEST_R] / 255) * 1.3;
  } else if (terrain === 4) {
    // Forest: G-rich food
    foodAffinity = 0.2 + (pixel.dna[GENE.HARVEST_G] / 255) * 1.3;
  } else if (terrain === 2) {
    // Dirt: B-rich food
    foodAffinity = 0.2 + (pixel.dna[GENE.HARVEST_B] / 255) * 1.3;
  } else if (terrain === 1) {
    // Sand: very scarce, no specialization bonus
    foodAffinity = 0.3;
  } else if (terrain === 0) {
    // Water: aquatic food, B-gene affinity
    foodAffinity = 0.1 + (pixel.dna[GENE.HARVEST_B] / 255) * 1.2;
  }

  const harvestEff = (pixel.dna[GENE.HARVEST_R] + pixel.dna[GENE.HARVEST_G] + pixel.dna[GENE.HARVEST_B]) / (255 * 3);
  const effectiveHarvest = config.harvestRate ?? HARVEST_RATE;
  const harvested = avail * harvestEff * effectiveHarvest * catalyzeBoost * harvestPenalty * foodAffinity;
  let gained = harvested;
  world.food[cellIdx] = Math.max(0, avail - harvested);

  // -- Harvest from corpse --
  const corpseEnergy = world.corpses[cellIdx];
  if (corpseEnergy > 0) {
    const corpseGain = Math.min(corpseEnergy, 5) * CORPSE_HARVEST_RATE * (0.5 + absorbSkill * 0.5);
    gained += corpseGain;
    world.corpses[cellIdx] = Math.max(0, corpseEnergy - Math.ceil(corpseGain));
  }

  // Feeding visual effect when gaining significant food
  if (gained > 0.3 && Math.random() < 0.15) {
    const [fx, fy] = toCanvasCenter(pixel.x, pixel.y, config.pixelScale);
    addInteractionEffect(fx, fy, 'feed');
  }

  // -- Upkeep -- (friction only; no longer lethal — energy clamped at 0)
  const speed = getEffectiveGene(pixel, GENE.SPEED) / 255;
  const sense = getEffectiveGene(pixel, GENE.SENSE_RANGE) / 255;
  let cost = BASE_UPKEEP + speed * SPEED_UPKEEP + sense * SENSE_UPKEEP;
  if (world.season === 'winter') cost *= WINTER_UPKEEP_MULT;
  cost *= config.upkeepMultiplier * weatherUpkeepMult(world.weather) * locomotionUpkeepMult(pixel);

  // Natural death (starvation, age) has been disabled by design.
  // Creatures only die to predation (see reactions.ts resolveAbsorb).
  // Energy floors at 0 instead.
  pixel.energy = Math.max(0, Math.min(MAX_ENERGY, pixel.energy + gained - cost));

  // Satiety gain from feeding — flat across roles.
  // Ecology comes from spatial feedback below, not role-specific knobs.
  if (gained > cost) {
    pixel.state[1] = Math.min(255, pixel.state[1] + 40);
  }

  // Spatial feedback: crowding fatigue + pioneer vigor.
  // 5×5 same-role scan: each neighbor past threshold subtracts 1 satiety.
  // 3×3 emptiness: isolated pioneers gain +2 — colonizing empty niches pays.
  const selfRole = pixel.role;
  let crowd = 0;
  let anyNear3 = false;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = wrapX(pixel.x + dx, world.width);
      const ny = wrapY(pixel.y + dy, world.height);
      const other = world.pixels.get(cellKey(nx, ny, world.width));
      if (!other || other.role !== selfRole) continue;
      crowd++;
      if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) anyNear3 = true;
    }
  }
  if (crowd >= 3) {
    pixel.state[1] = Math.max(0, pixel.state[1] - crowd);
  } else if (!anyNear3) {
    pixel.state[1] = Math.min(255, pixel.state[1] + 2);
  }

  // Waste deposit (becomes food for ecosystem)
  const wasteEff = (pixel.dna[GENE.WASTE_R] + pixel.dna[GENE.WASTE_G] + pixel.dna[GENE.WASTE_B]) / (255 * 3);
  const wasteMult = world.tick < pixel.catalyzedUntil ? 2.0 : 1.0;
  if (wasteEff > 0) addFood(world, pixel.x, pixel.y, wasteEff * WASTE_RATE * wasteMult);

  // Pheromone deposit
  addPheromone(world, pixel.x, pixel.y, (pixel.energy / MAX_ENERGY) * PHEROMONE_DEPOSIT_RATE);

  // Natural death removed — only predation kills (reactions.ts resolveAbsorb).
  // Hungry creatures sit at low energy until they feed; they never die on their own.
  pixel.age++;
  return true;
}

// Role is precomputed at Pixel creation (pixel.ts:createPixel) since DNA is immutable
// 0=plant, 1=hunter, 2=apex, 3=scavenger, 4=parasite, 5=swarm, 6=nomad
export function getCreatureRole(pixel: Pixel): number {
  return pixel.role;
}

// Simplified trophic level for energy balance (0=producer, 1=consumer, 2=apex)
export function getTrophicLevel(pixel: Pixel): number {
  const role = getCreatureRole(pixel);
  if (role === 2) return 2;                    // apex
  if (role === 1 || role === 3) return 1;      // hunter/scavenger
  return 0;                                     // plant/parasite/swarm/nomad
}
