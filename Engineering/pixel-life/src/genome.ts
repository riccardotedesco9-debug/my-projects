import type { RegulatoryGene } from './types';
import { CORE_GENOME_SIZE, MAX_REGULATORY_GENES } from './types';
import { GENE_CLOSENESS, REG_GENE_ADD_CHANCE, REG_GENE_REMOVE_CHANCE } from './constants';

// Count how many core genes are "close" (within GENE_CLOSENESS)
export function genomeSimilarity(a: Uint8Array, b: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < CORE_GENOME_SIZE; i++) {
    if (Math.abs(a[i] - b[i]) <= GENE_CLOSENESS) count++;
  }
  return count;
}

// Hamming-style distance for species clustering (sum of absolute diffs)
export function genomeDistance(a: Uint8Array, b: Uint8Array): number {
  let dist = 0;
  for (let i = 0; i < CORE_GENOME_SIZE; i++) {
    dist += Math.abs(a[i] - b[i]);
  }
  return dist;
}

// Mutate a DNA copy: flip N genes by +/- intensity
export function mutateDna(
  source: Uint8Array,
  mutationRate: number,
  intensity: number,
): Uint8Array {
  const dna = new Uint8Array(source);
  const numMutations = Math.floor((mutationRate / 255) * 8);
  for (let i = 0; i < numMutations; i++) {
    const geneIdx = Math.floor(Math.random() * CORE_GENOME_SIZE);
    const delta = Math.floor(Math.random() * intensity * 2 + 1) - intensity;
    dna[geneIdx] = Math.max(0, Math.min(255, dna[geneIdx] + delta));
  }
  return dna;
}

// Mutate regulatory genes: possibly add/remove/modify
export function mutateRegulatoryGenes(
  source: RegulatoryGene[],
): RegulatoryGene[] {
  const genes = source.map(g => ({ ...g }));

  // Chance to add a new regulatory gene
  if (genes.length < MAX_REGULATORY_GENES && Math.random() < REG_GENE_ADD_CHANCE) {
    // conditionIdx 0-15 = core genes, 16-18 = internal state (threat, satiety, social)
    genes.push({
      conditionIdx: Math.floor(Math.random() * (CORE_GENOME_SIZE + 3)),
      threshold: Math.floor(Math.random() * 256),
      targetIdx: Math.floor(Math.random() * CORE_GENOME_SIZE),
    });
  }

  // Chance to remove a random regulatory gene
  if (genes.length > 0 && Math.random() < REG_GENE_REMOVE_CHANCE) {
    genes.splice(Math.floor(Math.random() * genes.length), 1);
  }

  // Slightly mutate existing regulatory genes
  for (const g of genes) {
    if (Math.random() < 0.1) {
      g.threshold = Math.max(0, Math.min(255, g.threshold + Math.floor(Math.random() * 21) - 10));
    }
  }

  return genes;
}

// Crossover for sexual reproduction: single-point crossover
export function crossoverDna(
  parentA: Uint8Array,
  parentB: Uint8Array,
): Uint8Array {
  const crossPoint = Math.floor(Math.random() * (CORE_GENOME_SIZE - 2)) + 1;
  const child = new Uint8Array(CORE_GENOME_SIZE);
  for (let i = 0; i < CORE_GENOME_SIZE; i++) {
    child[i] = i < crossPoint ? parentA[i] : parentB[i];
  }
  return child;
}

// Crossover regulatory genes from two parents
export function crossoverRegulatoryGenes(
  a: RegulatoryGene[],
  b: RegulatoryGene[],
): RegulatoryGene[] {
  const result: RegulatoryGene[] = [];
  const maxLen = Math.max(a.length, b.length);
  for (let i = 0; i < maxLen; i++) {
    // Alternate picking from each parent
    const source = i % 2 === 0 ? a : b;
    if (i < source.length) {
      result.push({ ...source[i] });
    }
  }
  return result.slice(0, MAX_REGULATORY_GENES);
}

// Camouflage is now terrain-based (forest cover) — see terrain.ts:givesCover()
