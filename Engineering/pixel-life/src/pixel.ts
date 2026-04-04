import type { Pixel, RegulatoryGene } from './types';
import { CORE_GENOME_SIZE, GENE } from './types';
import { applyRegulation } from './regulation';

// 7 archetypes seeded at start — evolution will blend and mutate them
export function createRandomDna(): Uint8Array {
  const roll = Math.random();
  if (roll < 0.35) return createProducerDna();     // 35% plants
  if (roll < 0.50) return createConsumerDna();      // 15% hunters
  if (roll < 0.55) return createApexDna();          // 5% apex predators
  if (roll < 0.70) return createScavengerDna();     // 15% scavengers
  if (roll < 0.82) return createParasiteDna();      // 12% parasites
  if (roll < 0.92) return createSwarmDna();         // 10% swarm organisms
  if (roll < 0.97) return createNomadDna();         // 5% nomads
  return createWildDna();                            // 3% random wildcards
}

// PLANT: slow, high harvest, stays put, soft target
function createProducerDna(): Uint8Array {
  const dna = new Uint8Array(CORE_GENOME_SIZE);
  dna[GENE.HARVEST_R] = 150 + rand(105);
  dna[GENE.HARVEST_G] = 150 + rand(105);
  dna[GENE.HARVEST_B] = 100 + rand(155);
  dna[GENE.SPEED] = 20 + rand(60);
  dna[GENE.SENSE_RANGE] = 40 + rand(80);
  dna[GENE.SENSE_TARGET] = rand(50);             // food seeker
  dna[GENE.REACT_TYPE] = 192 + rand(63);         // repel (defensive)
  dna[GENE.REACT_THRESHOLD] = rand(80);
  dna[GENE.WASTE_R] = 100 + rand(155);
  dna[GENE.WASTE_G] = 100 + rand(155);
  dna[GENE.WASTE_B] = 100 + rand(155);
  dna[GENE.REPRO_THRESHOLD] = 30 + rand(80);
  dna[GENE.REPRO_SHARE] = 80 + rand(100);
  dna[GENE.MUTATION_RATE] = 20 + rand(60);
  dna[GENE.ARMOR] = rand(60);                    // soft
  dna[GENE.ADHESION] = rand(180);
  return dna;
}

// HUNTER: fast, seeks prey, absorbs on contact
function createConsumerDna(): Uint8Array {
  const dna = new Uint8Array(CORE_GENOME_SIZE);
  dna[GENE.HARVEST_R] = 60 + rand(100);
  dna[GENE.HARVEST_G] = 60 + rand(100);
  dna[GENE.HARVEST_B] = 60 + rand(100);
  dna[GENE.SPEED] = 160 + rand(95);
  dna[GENE.SENSE_RANGE] = 150 + rand(105);
  dna[GENE.SENSE_TARGET] = 90 + rand(70);        // pixel seeker
  dna[GENE.REACT_TYPE] = 15 + rand(45);          // absorber
  dna[GENE.REACT_THRESHOLD] = rand(40);
  dna[GENE.WASTE_R] = rand(80);
  dna[GENE.WASTE_G] = rand(80);
  dna[GENE.WASTE_B] = rand(80);
  dna[GENE.REPRO_THRESHOLD] = 70 + rand(80);
  dna[GENE.REPRO_SHARE] = 110 + rand(80);
  dna[GENE.MUTATION_RATE] = 30 + rand(70);
  dna[GENE.ARMOR] = 60 + rand(80);
  dna[GENE.ADHESION] = rand(80);                  // solitary
  return dna;
}

// APEX: maximum predator, rare, powerful
function createApexDna(): Uint8Array {
  const dna = new Uint8Array(CORE_GENOME_SIZE);
  dna[GENE.HARVEST_R] = rand(50);
  dna[GENE.HARVEST_G] = rand(50);
  dna[GENE.HARVEST_B] = rand(50);
  dna[GENE.SPEED] = 210 + rand(45);
  dna[GENE.SENSE_RANGE] = 200 + rand(55);
  dna[GENE.SENSE_TARGET] = 100 + rand(60);
  dna[GENE.REACT_TYPE] = rand(12);               // max absorber
  dna[GENE.REACT_THRESHOLD] = rand(20);
  dna[GENE.WASTE_R] = rand(40);
  dna[GENE.WASTE_G] = rand(40);
  dna[GENE.WASTE_B] = rand(40);
  dna[GENE.REPRO_THRESHOLD] = 100 + rand(60);    // needs lots of energy
  dna[GENE.REPRO_SHARE] = 130 + rand(60);
  dna[GENE.MUTATION_RATE] = 20 + rand(50);
  dna[GENE.ARMOR] = 120 + rand(100);
  dna[GENE.ADHESION] = rand(40);
  return dna;
}

// SCAVENGER: follows pheromone trails, eats corpses, medium speed
function createScavengerDna(): Uint8Array {
  const dna = new Uint8Array(CORE_GENOME_SIZE);
  dna[GENE.HARVEST_R] = 80 + rand(100);          // can eat some food
  dna[GENE.HARVEST_G] = 80 + rand(100);
  dna[GENE.HARVEST_B] = 80 + rand(100);
  dna[GENE.SPEED] = 100 + rand(100);             // medium speed
  dna[GENE.SENSE_RANGE] = 100 + rand(100);
  dna[GENE.SENSE_TARGET] = 60 + rand(25);        // pheromone follower (60-85 range)
  dna[GENE.REACT_TYPE] = 30 + rand(30);          // light absorber (scavenges)
  dna[GENE.REACT_THRESHOLD] = 50 + rand(100);    // high threshold = avoids fights
  dna[GENE.WASTE_R] = 50 + rand(100);
  dna[GENE.WASTE_G] = 50 + rand(100);
  dna[GENE.WASTE_B] = 50 + rand(100);
  dna[GENE.REPRO_THRESHOLD] = 50 + rand(80);
  dna[GENE.REPRO_SHARE] = 90 + rand(80);
  dna[GENE.MUTATION_RATE] = 40 + rand(80);
  dna[GENE.ARMOR] = 40 + rand(80);
  dna[GENE.ADHESION] = rand(120);
  return dna;
}

// PARASITE: catalyzes hosts (boosts their metabolism but steals waste)
function createParasiteDna(): Uint8Array {
  const dna = new Uint8Array(CORE_GENOME_SIZE);
  dna[GENE.HARVEST_R] = 100 + rand(100);         // moderate harvest
  dna[GENE.HARVEST_G] = 100 + rand(100);
  dna[GENE.HARVEST_B] = 100 + rand(100);
  dna[GENE.SPEED] = 80 + rand(120);
  dna[GENE.SENSE_RANGE] = 120 + rand(100);
  dna[GENE.SENSE_TARGET] = 90 + rand(70);        // pixel seeker
  dna[GENE.REACT_TYPE] = 128 + rand(63);         // catalyzer (128-191)
  dna[GENE.REACT_THRESHOLD] = rand(60);
  dna[GENE.WASTE_R] = 150 + rand(105);           // high waste = feeds off host's boosted output
  dna[GENE.WASTE_G] = 150 + rand(105);
  dna[GENE.WASTE_B] = 150 + rand(105);
  dna[GENE.REPRO_THRESHOLD] = 40 + rand(80);
  dna[GENE.REPRO_SHARE] = 70 + rand(100);
  dna[GENE.MUTATION_RATE] = 50 + rand(80);
  dna[GENE.ARMOR] = 30 + rand(60);               // fragile
  dna[GENE.ADHESION] = 80 + rand(120);           // sticks near hosts
  return dna;
}

// SWARM: highly social, shares energy, clusters tightly, strength in numbers
function createSwarmDna(): Uint8Array {
  const dna = new Uint8Array(CORE_GENOME_SIZE);
  dna[GENE.HARVEST_R] = 120 + rand(100);
  dna[GENE.HARVEST_G] = 120 + rand(100);
  dna[GENE.HARVEST_B] = 120 + rand(100);
  dna[GENE.SPEED] = 60 + rand(80);               // moderate
  dna[GENE.SENSE_RANGE] = 60 + rand(80);
  dna[GENE.SENSE_TARGET] = 85 + rand(80);        // seeks other pixels
  dna[GENE.REACT_TYPE] = 64 + rand(63);          // sharer (64-127)
  dna[GENE.REACT_THRESHOLD] = rand(40);
  dna[GENE.WASTE_R] = 80 + rand(120);
  dna[GENE.WASTE_G] = 80 + rand(120);
  dna[GENE.WASTE_B] = 80 + rand(120);
  dna[GENE.REPRO_THRESHOLD] = 35 + rand(60);     // reproduces easily
  dna[GENE.REPRO_SHARE] = 100 + rand(80);
  dna[GENE.MUTATION_RATE] = 20 + rand(40);       // low mutation = stable lineage
  dna[GENE.ARMOR] = 30 + rand(60);
  dna[GENE.ADHESION] = 200 + rand(55);           // VERY social
  return dna;
}

// NOMAD: fast explorer, no territory, survives everywhere, fleeing type
function createNomadDna(): Uint8Array {
  const dna = new Uint8Array(CORE_GENOME_SIZE);
  dna[GENE.HARVEST_R] = 100 + rand(100);
  dna[GENE.HARVEST_G] = 100 + rand(100);
  dna[GENE.HARVEST_B] = 100 + rand(100);
  dna[GENE.SPEED] = 180 + rand(75);              // very fast
  dna[GENE.SENSE_RANGE] = 160 + rand(95);        // good sensing
  dna[GENE.SENSE_TARGET] = rand(50);             // food seeker (always looking for food)
  dna[GENE.REACT_TYPE] = 200 + rand(55);         // repeller (avoids conflict)
  dna[GENE.REACT_THRESHOLD] = rand(50);
  dna[GENE.WASTE_R] = rand(60);                  // low waste = no trail
  dna[GENE.WASTE_G] = rand(60);
  dna[GENE.WASTE_B] = rand(60);
  dna[GENE.REPRO_THRESHOLD] = 45 + rand(80);
  dna[GENE.REPRO_SHARE] = 80 + rand(100);
  dna[GENE.MUTATION_RATE] = 60 + rand(80);       // high mutation = adapts fast
  dna[GENE.ARMOR] = 20 + rand(60);               // light
  dna[GENE.ADHESION] = rand(40);                  // solitary wanderer
  return dna;
}

function createWildDna(): Uint8Array {
  const dna = new Uint8Array(CORE_GENOME_SIZE);
  for (let i = 0; i < CORE_GENOME_SIZE; i++) dna[i] = rand(256);
  return dna;
}

function rand(max: number): number {
  return Math.floor(Math.random() * max);
}

export function createPixel(
  id: number, x: number, y: number, dna: Uint8Array,
  regulatoryGenes: RegulatoryGene[] = [], energy = 50, generation = 0,
): Pixel {
  return {
    id, x, y, energy, dna, regulatoryGenes,
    age: 0, generation, catalyzedUntil: 0, wallTicks: 0,
    state: new Uint8Array(3),
  };
}

export function getEffectiveGene(pixel: Pixel, geneIdx: number): number {
  return applyRegulation(pixel, geneIdx);
}
