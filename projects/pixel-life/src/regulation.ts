import type { Pixel } from './types';
import { CORE_GENOME_SIZE, GENE } from './types';
import { REG_GENE_MODIFIER } from './constants';

// Apply regulatory modifiers to get effective gene value
export function applyRegulation(pixel: Pixel, geneIdx: number): number {
  let val = pixel.dna[geneIdx];

  for (const reg of pixel.regulatoryGenes) {
    if (reg.targetIdx !== geneIdx) continue;
    if (reg.conditionIdx >= CORE_GENOME_SIZE) {
      // Extended condition: index 16-18 maps to internal state [threat, satiety, social]
      const stateIdx = reg.conditionIdx - CORE_GENOME_SIZE;
      if (stateIdx < 3 && pixel.state[stateIdx] > reg.threshold) {
        val = Math.round(val * (1 + REG_GENE_MODIFIER));
      }
    } else {
      if (pixel.dna[reg.conditionIdx] > reg.threshold) {
        val = Math.round(val * (1 + REG_GENE_MODIFIER));
      }
    }
  }
  return Math.max(0, Math.min(255, val));
}

// Behavioral switching: check if internal state should override senseTarget
// Returns modified senseTarget or original value
export function applyBehavioralSwitch(pixel: Pixel, baseSenseTarget: number): number {
  for (const reg of pixel.regulatoryGenes) {
    // Only care about reg genes targeting SENSE_TARGET
    if (reg.targetIdx !== GENE.SENSE_TARGET) continue;

    // Extended condition: state-based switching
    if (reg.conditionIdx >= CORE_GENOME_SIZE) {
      const stateIdx = reg.conditionIdx - CORE_GENOME_SIZE;
      if (stateIdx < 3 && pixel.state[stateIdx] > reg.threshold) {
        // Override senseTarget: high threshold = flee, low = seek
        return reg.threshold > 128 ? 200 : 120; // flee or hunt
      }
    }
  }
  return baseSenseTarget;
}

// Genome complexity score for stats
export function genomeComplexity(pixel: Pixel): number {
  return CORE_GENOME_SIZE + pixel.regulatoryGenes.length * 3;
}
