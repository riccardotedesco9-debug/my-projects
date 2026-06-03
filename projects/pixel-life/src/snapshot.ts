// Snapshot: compact world state capture for time-lapse replay
// Each snapshot stores ~3KB for a 500-creature world

import type { World, Season } from './types';
import { getCreatureRole } from './metabolism';

export interface WorldSnapshot {
  tick: number;
  season: Season;
  population: number;
  // Packed creature data: arrays of same length
  xs: Uint8Array;       // x positions (0-199)
  ys: Uint8Array;       // y positions (0-149)
  energies: Uint8Array; // energy scaled to 0-255
  roles: Uint8Array;    // role (0-6)
}

export function captureSnapshot(world: World): WorldSnapshot {
  const n = world.pixels.size;
  const xs = new Uint8Array(n);
  const ys = new Uint8Array(n);
  const energies = new Uint8Array(n);
  const roles = new Uint8Array(n);

  let i = 0;
  for (const p of world.pixels.values()) {
    xs[i] = p.x;
    ys[i] = p.y;
    energies[i] = Math.min(255, Math.floor(p.energy * 2.55));
    roles[i] = getCreatureRole(p);
    i++;
  }

  return {
    tick: world.tick,
    season: world.season,
    population: n,
    xs, ys, energies, roles,
  };
}
