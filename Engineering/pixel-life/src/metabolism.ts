import type { Pixel, World, SimConfig, TickEvents } from './types';
import { GENE } from './types';
import { getEffectiveGene } from './pixel';
import { removePixel, addFood, addPheromone } from './world';
import { weatherUpkeepMult } from './weather';
import { addDeathEffect, addInteractionEffect, toCanvasCenter } from './effects';
import { locomotionUpkeepMult } from './locomotion';
import {
  MAX_ENERGY, BASE_UPKEEP, SPEED_UPKEEP, SENSE_UPKEEP,
  HARVEST_RATE, WASTE_RATE, DEATH_SUBSTRATE_SCALE,
  CATALYZE_BOOST, WINTER_UPKEEP_MULT,
  TROPHIC_INVERSE_FACTOR, ABSORB_SKILL_THRESHOLD,
  CORPSE_ENERGY_MULT, CORPSE_HARVEST_RATE,
  AGE_DECAY_START, AGE_DECAY_RATE,
  PHEROMONE_DEPOSIT_RATE,
} from './constants';

export function metabolize(pixel: Pixel, world: World, config: SimConfig, events: TickEvents): boolean {
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
  const harvested = avail * harvestEff * HARVEST_RATE * catalyzeBoost * harvestPenalty * foodAffinity;
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

  // -- Upkeep --
  const speed = getEffectiveGene(pixel, GENE.SPEED) / 255;
  const sense = getEffectiveGene(pixel, GENE.SENSE_RANGE) / 255;
  let cost = BASE_UPKEEP + speed * SPEED_UPKEEP + sense * SENSE_UPKEEP;
  if (world.season === 'winter') cost *= WINTER_UPKEEP_MULT;
  cost *= config.upkeepMultiplier * weatherUpkeepMult(world.weather) * locomotionUpkeepMult(pixel);

  // Age decay
  if (pixel.age > AGE_DECAY_START) cost += (pixel.age - AGE_DECAY_START) * AGE_DECAY_RATE;

  const prevEnergy = pixel.energy;
  pixel.energy = Math.min(MAX_ENERGY, pixel.energy + gained - cost);

  // Satiety state
  if (gained > cost) pixel.state[1] = Math.min(255, pixel.state[1] + 30);

  // Waste deposit (becomes food for ecosystem)
  const wasteEff = (pixel.dna[GENE.WASTE_R] + pixel.dna[GENE.WASTE_G] + pixel.dna[GENE.WASTE_B]) / (255 * 3);
  const wasteMult = world.tick < pixel.catalyzedUntil ? 2.0 : 1.0;
  if (wasteEff > 0) addFood(world, pixel.x, pixel.y, wasteEff * WASTE_RATE * wasteMult);

  // Pheromone deposit
  addPheromone(world, pixel.x, pixel.y, (pixel.energy / MAX_ENERGY) * PHEROMONE_DEPOSIT_RATE);

  // -- Death --
  if (pixel.energy <= 0) {
    world.corpses[cellIdx] = Math.min(255, world.corpses[cellIdx] + Math.floor(Math.max(5, prevEnergy) * CORPSE_ENERGY_MULT));
    const release = Math.max(1, prevEnergy) * DEATH_SUBSTRATE_SCALE;
    addFood(world, pixel.x, pixel.y, release * 0.3);
    const [dx, dy] = toCanvasCenter(pixel.x, pixel.y, config.pixelScale);
    addDeathEffect(dx, dy);
    removePixel(world, pixel);
    events.deaths++;
    return false;
  }

  pixel.age++;
  return true;
}

// Creature roles: 0=plant, 1=hunter, 2=apex, 3=scavenger, 4=parasite, 5=swarm, 6=nomad
export function getCreatureRole(pixel: Pixel): number {
  const rt = pixel.dna[GENE.REACT_TYPE];
  const speed = pixel.dna[GENE.SPEED];
  const adhesion = pixel.dna[GENE.ADHESION];
  const sense = pixel.dna[GENE.SENSE_TARGET];
  const threshold = pixel.dna[GENE.REACT_THRESHOLD];

  // Swarm: very high adhesion + sharer
  if (adhesion > 180 && rt >= 64 && rt < 128) return 5;
  // Parasite: catalyzer + pixel seeker
  if (rt >= 128 && rt < 192 && sense >= 85 && sense < 170) return 4;
  // Nomad: fast + food seeker + repeller
  if (rt >= 192 && speed > 160 && sense < 60) return 6;
  // Apex: max absorber
  if (rt < 15) return 2;
  // Scavenger: light absorber + pheromone follower + high threshold
  if (rt >= 15 && rt < 64 && (sense >= 60 && sense < 85 || threshold > 80)) return 3;
  // Hunter: absorber + pixel seeker
  if (rt < 64 && sense >= 85) return 1;
  // Default: plant
  return 0;
}

// Simplified trophic level for energy balance (0=producer, 1=consumer, 2=apex)
export function getTrophicLevel(pixel: Pixel): number {
  const role = getCreatureRole(pixel);
  if (role === 2) return 2;                    // apex
  if (role === 1 || role === 3) return 1;      // hunter/scavenger
  return 0;                                     // plant/parasite/swarm/nomad
}
