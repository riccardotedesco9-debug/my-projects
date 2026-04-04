// -- Gene indices for the 16-byte core genome --
export const GENE = {
  HARVEST_R: 0, HARVEST_G: 1, HARVEST_B: 2,
  SPEED: 3, SENSE_RANGE: 4, SENSE_TARGET: 5,
  REACT_TYPE: 6, REACT_THRESHOLD: 7,
  WASTE_R: 8, WASTE_G: 9, WASTE_B: 10,
  REPRO_THRESHOLD: 11, REPRO_SHARE: 12,
  MUTATION_RATE: 13, ARMOR: 14, ADHESION: 15,
} as const;

export const CORE_GENOME_SIZE = 16;
export const MAX_REGULATORY_GENES = 16;
// Each regulatory gene: [conditionIdx, threshold, targetIdx]
export const REG_GENE_SIZE = 3;

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type ViewMode = 'normal' | 'energy' | 'substrate' | 'lineage' | 'trophic' | 'territory';

// Terrain types — each cell has one
export const enum Terrain {
  WATER = 0,   // blocks movement, no food
  SAND = 1,    // very low food
  DIRT = 2,    // low food
  GRASS = 3,   // high food
  FOREST = 4,  // medium food + camouflage
  ROCK = 5,    // no food, walkable
}

export interface MemoryEntry {
  x: number;
  y: number;
  type: 'food' | 'danger' | 'safe';
  strength: number;    // 0-255, decays over time
  tick: number;        // when recorded
}

export interface RegulatoryGene {
  conditionIdx: number; // core gene index to read
  threshold: number;    // activation threshold (0-255)
  targetIdx: number;    // core gene index to modify
}

export interface Pixel {
  id: number;
  x: number;
  y: number;
  energy: number;
  dna: Uint8Array;                  // 16 core genes
  regulatoryGenes: RegulatoryGene[];// 0-16 evolved conditional modifiers
  age: number;
  generation: number;
  catalyzedUntil: number;           // tick when catalyze buff expires
  wallTicks: number;                // ticks spent stationary (for wall building)
  direction: number;                // 0=down, 1=left, 2=right, 3=up (last movement)
  memory: MemoryEntry[];            // spatial memory (max 8 entries)
  packId: number;                   // 0 = solo, >0 = pack member
  migrationTarget: { x: number; y: number } | null;
  seasonalMemory: { season: Season; x: number; y: number; food: number }[];
  state: Uint8Array;                // [threat, satiety, social] — 3 internal registers
}

export interface World {
  width: number;
  height: number;
  pixels: Map<number, Pixel>;       // key = y * width + x
  terrain: Uint8Array;                // W * H (Terrain enum per cell)
  food: Float32Array;                 // W * H (food energy per cell, 0-1)
  foodBuf: Float32Array;              // double-buffer for diffusion
  pheromone: Float32Array;            // W * H (pheromone trails, 0-1)
  corpses: Uint8Array;                // W * H (corpse energy per cell, 0=none)
  wear: Uint8Array;                   // W * H (creature foot traffic, 0-255)
  territory: Uint16Array;              // W * H (owner pixel ID, 0 = unclaimed)
  territoryAge: Uint16Array;          // W * H (ticks since last reinforced)
  foodPatches: FoodPatch[];          // dynamic substrate hotspots
  tick: number;
  season: Season;
  seasonTick: number;
  nextPixelId: number;
  emptyTicks: number;
  popHistory: number[];
  prevPopulation: number;
  nextEventTick: number;
  activeEvent: EnvironmentEvent | null;
  weather: import('./weather').Weather; // Weather state
}

export interface FoodPatch {
  x: number;
  y: number;
  radius: number;
  channel: number;                   // 0=R, 1=G, 2=B
  strength: number;
  dx: number;                        // drift direction
  dy: number;
  life: number;                      // ticks remaining
}

export interface EnvironmentEvent {
  type: 'meteor' | 'drought' | 'bloom' | 'plague';
  x: number;
  y: number;
  radius: number;
  ticksLeft: number;
  channel?: number;                  // for drought: which channel stops
}

export interface SimConfig {
  worldWidth: number;
  worldHeight: number;
  pixelScale: number;
  initialPopulation: number;
  substrateEmission: number;
  substrateDiffusion: number;
  substrateDecay: number;
  seasonLength: number;
  upkeepMultiplier: number;
  mutationIntensity: number;
  simSpeed: number;
  viewMode: ViewMode;
  paused: boolean;
  paintChannel: number;             // 0=R, 1=G, 2=B for substrate painting
}

// Event counters per tick for audio batching
export interface TickEvents {
  births: number;
  deaths: number;
  absorbs: number;
  shares: number;
  catalyzes: number;
  repels: number;
  sexualRepros: number;
}

export function createTickEvents(): TickEvents {
  return { births: 0, deaths: 0, absorbs: 0, shares: 0, catalyzes: 0, repels: 0, sexualRepros: 0 };
}
