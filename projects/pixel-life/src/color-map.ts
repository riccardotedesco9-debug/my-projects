import type { Pixel } from './types';
import { MAX_ENERGY } from './constants';
import { getCreatureRole } from './metabolism';

// Convert HSL to RGB (all inputs 0-1 range, output 0-255)
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number): number => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// Role-based base hues with DNA variation for genetic diversity within each role
// 0=plant(green), 1=hunter(orange), 2=apex(red), 3=scavenger(brown),
// 4=parasite(purple), 5=swarm(cyan), 6=nomad(yellow)
const ROLE_HUES = [0.33, 0.08, 0.0, 0.07, 0.8, 0.5, 0.15];

// Bright, distinct role colors for zoomed-out view (high saturation, fixed luminance)
const ROLE_BRIGHT: [number, number, number][] = [
  [80, 220, 80],    // Plant: bright green
  [230, 150, 50],   // Hunter: vivid orange
  [220, 50, 50],    // Apex: bright red
  [180, 140, 80],   // Scavenger: tan/gold
  [180, 70, 220],   // Parasite: vivid purple
  [50, 210, 210],   // Swarm: bright cyan
  [220, 220, 50],   // Nomad: bright yellow
];

export function dnaToColor(dna: Uint8Array, energy: number, role?: number): [number, number, number] {
  const r = role ?? 0;
  // Use harvest + senseTarget + reactType + mutationRate for wider hue spread (~60 degrees)
  const genomeHash = (dna[0] + dna[1] + dna[2] + dna[5] * 2 + dna[6] + dna[13]) & 0xffff;
  const dnaShift = ((genomeHash % 80) - 40) / 360;
  const hue = ((ROLE_HUES[r] ?? 0.33) + dnaShift + 1) % 1;
  // Saturation from adhesion + armor — social vs armored creatures look different
  const sat = 0.45 + (dna[15] / 255) * 0.2 + (dna[14] / 255) * 0.2;
  const lum = 0.25 + (energy / MAX_ENERGY) * 0.45;
  return hslToRgb(hue, sat, lum);
}

// Energy heatmap: red (low) -> yellow (mid) -> green (high)
export function energyToColor(energy: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, energy / MAX_ENERGY));
  if (t < 0.5) {
    const u = t * 2;
    return [255, Math.round(u * 255), 0];
  }
  const u = (t - 0.5) * 2;
  return [Math.round((1 - u) * 255), 255, 0];
}

// Generation/lineage: cool (old) to warm (new)
export function lineageToColor(generation: number): [number, number, number] {
  const hue = (240 - (generation % 240)) / 360; // blue->red as gen increases
  return hslToRgb(hue, 0.8, 0.55);
}

// Role view: distinct colors per creature role
export function roleToColor(pixel: Pixel): [number, number, number] {
  const role = getCreatureRole(pixel);
  const lum = 0.3 + (pixel.energy / MAX_ENERGY) * 0.4;
  const hue = ROLE_HUES[role] ?? 0.33;
  return hslToRgb(hue, 0.85, lum);
}

// Shift hue of an RGB color by degrees (-360 to 360)
export function hueShift(r: number, g: number, b: number, degrees: number): [number, number, number] {
  const rf = r / 255, gf = g / 255, bf = b / 255;
  const max = Math.max(rf, gf, bf), min = Math.min(rf, gf, bf);
  let h = 0;
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d !== 0) {
    if (max === rf) h = ((gf - bf) / d + (gf < bf ? 6 : 0)) / 6;
    else if (max === gf) h = ((bf - rf) / d + 2) / 6;
    else h = ((rf - gf) / d + 4) / 6;
  }
  h = ((h + degrees / 360) % 1 + 1) % 1;
  return hslToRgb(h, s, l);
}

// Role-based hue anchors (exported for sprite palette system)
export const ROLE_HUES_EXPORT = ROLE_HUES;

// Fixed bright color per role — no energy dimming, always visible
export function roleBrightColor(role: number): [number, number, number] {
  return ROLE_BRIGHT[role] ?? [150, 150, 150];
}
