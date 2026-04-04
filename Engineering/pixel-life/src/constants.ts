import type { SimConfig } from './types';

// -- Energy --
export const MAX_ENERGY = 100.0;
export const BASE_UPKEEP = 0.06;        // meaningful but not punishing — leaves room for evolution
export const SPEED_UPKEEP = 0.10;       // fast creatures pay more
export const SENSE_UPKEEP = 0.04;       // sensing costs energy
export const HARVEST_RATE = 0.28;       // scarcer food — drives competition and niche separation
export const WASTE_RATE = 0.015;        // nutrient cycling
export const MOVE_COST = 0.025;         // moderate exploration cost
export const DEATH_SUBSTRATE_SCALE = 0.1; // nutrient release on death

// -- Reproduction --
export const REPRO_MIN_ENERGY = 30;     // must be well-fed to reproduce
export const REPRO_MAX_ENERGY = 60;     // ceiling
export const REPRO_TAX = 3.5;           // meaningful cost but still viable — natural selection, not extinction
export const REPRO_SHARE_MIN = 0.1;
export const REPRO_SHARE_MAX = 0.9;

// -- Reactions --
export const ABSORB_EFFICIENCY = 0.55; // moderate: predators need multiple kills to thrive
export const CATALYZE_COST = 2.0;
export const CATALYZE_DURATION = 10;
export const CATALYZE_BOOST = 1.5;
export const REPEL_COST = 0.1;

// -- Adhesion --
export const ADHESION_THRESHOLD = 128;
export const SIMILARITY_BONUS_THRESHOLD = 12;
export const DISSIMILARITY_FLEE_THRESHOLD = 4;
export const COOPERATION_BONUS = 0.04;  // helps but doesn't fully offset upkeep — swarms still need food
export const GENE_CLOSENESS = 10;

// -- Substrate --
export const SUBSTRATE_MAX = 1.0;
export const SUBSTRATE_SATURATION_LIMIT = 2.5;

// -- Seasons --
export const SEASON_ORDER: readonly string[] = ['spring', 'summer', 'autumn', 'winter'];
export const SPRING_EMISSION_MULT = 1.2;
export const SUMMER_EMISSION_MULT = 1.4;
export const AUTUMN_DIFFUSION_MULT = 1.6;
export const WINTER_EMISSION_MULT = 0.8;   // less severe winter
export const WINTER_UPKEEP_MULT = 1.25;    // gentler upkeep increase

// -- Deep complexity --
export const REG_GENE_ADD_CHANCE = 0.05;
export const REG_GENE_REMOVE_CHANCE = 0.05;
export const REG_GENE_MODIFIER = 0.2;  // +/-20%
export const THREAT_DECAY = 1;
export const SATIETY_DECAY = 2;
export const SOCIAL_DECAY = 1;
export const SOCIAL_DOUBLE_THRESHOLD = 150;
export const THREAT_FLEE_THRESHOLD = 100;
export const SATIETY_REPRO_THRESHOLD = 200;
export const WALL_TICKS_THRESHOLD = 50;
export const WALL_ARMOR_MIN = 200;
export const WALL_SPEED_MAX = 50;

// -- Sexual reproduction --
export const SEXUAL_MIN_SIMILARITY = 4;
export const SEXUAL_MAX_SIMILARITY = 12;
export const HYBRID_VIGOR_MIN = 6;
export const HYBRID_VIGOR_MAX = 8;
export const HYBRID_VIGOR_BONUS = 5.0;

// -- Camouflage --
export const CAMOUFLAGE_CHANCE = 0.5;
export const CAMOUFLAGE_SPEED_MAX = 80;

// -- Trophic specialization --
export const TROPHIC_INVERSE_FACTOR = 0.7; // apex predators harvest only 30% — must hunt to survive
export const ABSORB_SKILL_THRESHOLD = 64;  // reactType < this = absorb-capable

// -- Corpses --
export const CORPSE_ENERGY_MULT = 2;       // corpse energy = pixel energy * this
export const CORPSE_DECAY_RATE = 2;         // lose 2 energy per tick
export const CORPSE_HARVEST_RATE = 0.8;     // harvest efficiency from corpses

// -- Age decay --
export const AGE_DECAY_START = 500;         // age when upkeep starts increasing
export const AGE_DECAY_RATE = 0.001;        // upkeep increase per tick of age past threshold

// -- Food patches --
export const FOOD_PATCH_COUNT = 7;          // primary food source — creates competition hotspots
export const FOOD_PATCH_RADIUS_MIN = 5;
export const FOOD_PATCH_RADIUS_MAX = 12;
export const FOOD_PATCH_STRENGTH = 0.018;
export const FOOD_PATCH_LIFE_MIN = 500;
export const FOOD_PATCH_LIFE_MAX = 2000;
export const FOOD_PATCH_DRIFT_SPEED = 0.02; // cells per tick

// -- Pheromone (4th substrate channel) --
export const PHEROMONE_DEPOSIT_RATE = 0.02; // deposited per tick based on energy
export const PHEROMONE_DIFFUSION_MULT = 2.0;// diffuses 2x faster than RGB
export const PHEROMONE_DECAY = 0.98;        // decays much faster than RGB

// -- Environmental events --
export const EVENT_INTERVAL_MIN = 800;
export const EVENT_INTERVAL_MAX = 2500;
export const METEOR_RADIUS = 12;
export const METEOR_SUBSTRATE_DEPOSIT = 0.8;
export const DROUGHT_DURATION = 200;
export const BLOOM_DURATION = 150;
export const BLOOM_MULT = 8;
export const PLAGUE_DURATION = 120;
export const PLAGUE_DAMAGE_MULT = 2.0;

// -- Clusters --
export const CLUSTER_ADHESION_MIN = 200;
export const CLUSTER_SIMILARITY_MIN = 14;
export const CLUSTER_AGE_MIN = 20;          // ticks adjacent before forming

// -- Population safety --
export const AUTO_SEED_EMPTY_TICKS = 100;
export const AUTO_SEED_COUNT = 50;
export const MAX_POP_FRACTION = 0.10;  // max 10% = ~3000 pixels, more evolution material

// -- Spatial Memory --
export const MEMORY_MAX_ENTRIES = 8;
export const MEMORY_DECAY_RATE = 0.995;
export const MEMORY_FOOD_THRESHOLD = 0.4;
export const MEMORY_DANGER_THRESHOLD = 80;
export const MEMORY_INFLUENCE_WEIGHT = 0.3;

// -- Territory --
export const TERRITORY_ADHESION_MIN = 150;
export const TERRITORY_MARK_RADIUS = 3;
export const TERRITORY_DECAY_RATE = 1;       // age increment per tick
export const TERRITORY_MAX_AGE = 200;        // ticks before territory fades
export const TERRITORY_MOVE_PENALTY = 2.0;   // 100% extra movement cost in foreign territory — real deterrent

// -- Camera --
export const MIN_ZOOM = 1.0;
export const MAX_ZOOM = 6.0;
export const ZOOM_SPEED = 0.15;
export const ZOOM_LERP = 0.15;
export const LOD_GLYPH_THRESHOLD = 1.5;
export const LOD_SPRITE_THRESHOLD = 3.0;
export const TERRAIN_TILE_SIZE = 16;
export const WATER_ANIM_INTERVAL = 30;

// -- Rendering --
export const SUBSTRATE_RENDER_INTERVAL = 4;
export const POP_HISTORY_LENGTH = 500;
export const TRAIL_INTENSITY = 0.04;        // substrate deposited as movement trail

// -- Species clustering --
export const SPECIES_DISTANCE_THRESHOLD = 20;
export const SPECIES_COMPUTE_INTERVAL = 100;

// -- Default config --
export function createDefaultConfig(): SimConfig {
  return {
    worldWidth: 200,
    worldHeight: 150,
    pixelScale: 5,              // 1000x750 canvas, 5px creatures for shape visibility
    initialPopulation: 100,     // sparse — gives room to see individuals
    substrateEmission: 0.010,   // moderate — patchy emission creates natural scarcity
    substrateDiffusion: 0.06,
    substrateDecay: 0.997,
    seasonLength: 2000,
    upkeepMultiplier: 1.0,
    mutationIntensity: 15,
    simSpeed: 1,
    viewMode: 'normal',
    paused: false,
    paintChannel: 0,
    harvestRate: 0.28,
    reproTax: 3.5,
  };
}
