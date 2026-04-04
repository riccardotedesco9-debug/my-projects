import type { Pixel } from './types';
import { THREAT_DECAY, SATIETY_DECAY, SOCIAL_DECAY } from './constants';

// Decay internal state registers each tick
export function decayPixelState(pixel: Pixel): void {
  // Threat decays
  if (pixel.state[0] > 0) {
    pixel.state[0] = Math.max(0, pixel.state[0] - THREAT_DECAY);
  }

  // Satiety decays faster
  if (pixel.state[1] > 0) {
    pixel.state[1] = Math.max(0, pixel.state[1] - SATIETY_DECAY);
  }

  // Social decays
  if (pixel.state[2] > 0) {
    pixel.state[2] = Math.max(0, pixel.state[2] - SOCIAL_DECAY);
  }
}

// Format pixel state for tooltip display
export function formatPixelState(pixel: Pixel): string {
  const labels = ['Threat', 'Satiety', 'Social'];
  return labels.map((l, i) => `${l}: ${pixel.state[i]}`).join(' | ');
}

// Check if pixel qualifies as a "wall" (sessile structure)
export function isWallPixel(pixel: Pixel): boolean {
  return pixel.dna[14] > 200 && pixel.dna[3] < 50 && pixel.wallTicks > 50;
}
