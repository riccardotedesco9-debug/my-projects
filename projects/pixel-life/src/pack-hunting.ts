// Pack hunting: predators with high adhesion form coordinated packs
// Packs get a kill bonus when members hunt together

import type { Pixel, World } from './types';
import { GENE } from './types';
import { getCreatureRole } from './metabolism';
import { wrapX, wrapY, cellKey } from './world';

const PACK_ADHESION_MIN = 180;
const PACK_PROXIMITY = 5;
const PACK_MIN_MEMBERS = 3;
const PACK_MAX_MEMBERS = 8;
const PACK_FORMATION_INTERVAL = 50;
export const PACK_HUNT_BONUS = 1.5;

interface Pack {
  id: number;
  leader: Pixel;        // live reference — x/y always current while alive
  members: Set<number>; // pixel IDs
}

const packs = new Map<number, Pack>();
let nextPackId = 1;
let lastFormationTick = 0;

// Clear per-run pack state so new-world pixel IDs don't collide with old packs
export function resetPacks(): void {
  packs.clear();
  nextPackId = 1;
  lastFormationTick = 0;
}

// Update pack formations periodically
export function updatePacks(world: World): void {
  if (world.tick - lastFormationTick < PACK_FORMATION_INTERVAL) return;
  lastFormationTick = world.tick;

  // Clear all pack assignments
  for (const p of world.pixels.values()) p.packId = 0;
  packs.clear();

  // Find eligible predators (hunters/apex with high adhesion)
  const candidates: Pixel[] = [];
  for (const p of world.pixels.values()) {
    const role = getCreatureRole(p);
    if ((role === 1 || role === 2) && p.dna[GENE.ADHESION] >= PACK_ADHESION_MIN) {
      candidates.push(p);
    }
  }

  if (candidates.length < PACK_MIN_MEMBERS) return;

  // Cluster nearby candidates via simple flood-fill
  const visited = new Set<number>();
  for (const seed of candidates) {
    if (visited.has(seed.id)) continue;

    const cluster: Pixel[] = [];
    const queue: Pixel[] = [seed];
    visited.add(seed.id);

    while (queue.length > 0 && cluster.length < PACK_MAX_MEMBERS) {
      const current = queue.pop()!;
      cluster.push(current);

      // Find nearby unvisited candidates
      for (const other of candidates) {
        if (visited.has(other.id)) continue;
        const dx = Math.abs(current.x - other.x);
        const dy = Math.abs(current.y - other.y);
        // Handle toroidal wrapping
        const dist = Math.min(dx, world.width - dx) + Math.min(dy, world.height - dy);
        if (dist <= PACK_PROXIMITY) {
          visited.add(other.id);
          queue.push(other);
        }
      }
    }

    if (cluster.length >= PACK_MIN_MEMBERS) {
      const packId = nextPackId++;
      let leader = cluster[0];
      for (const m of cluster) {
        if (m.energy > leader.energy) leader = m;
        m.packId = packId;
      }
      packs.set(packId, {
        id: packId,
        leader,
        members: new Set(cluster.map(c => c.id)),
      });
    }
  }
}

// Get movement bias for pack member: move toward pack leader (live coords)
export function getPackMoveBias(pixel: Pixel, world: World): [number, number] {
  if (pixel.packId === 0) return [0, 0];
  const pack = packs.get(pixel.packId);
  if (!pack) return [0, 0];

  // If we ARE the leader, seek nearest prey instead
  if (pixel === pack.leader) return [0, 0];

  // Live leader coords — no more 50-tick staleness
  let dx = pack.leader.x - pixel.x;
  let dy = pack.leader.y - pixel.y;
  if (Math.abs(dx) > world.width / 2) dx -= Math.sign(dx) * world.width;
  if (Math.abs(dy) > world.height / 2) dy -= Math.sign(dy) * world.height;

  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 2) return [0, 0]; // already close enough

  return [dx / dist, dy / dist];
}

// Check if a pixel has pack members adjacent (for kill bonus)
export function hasPackSupport(pixel: Pixel, world: World): boolean {
  if (pixel.packId === 0) return false;
  const { width: w, height: h } = world;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = wrapX(pixel.x + dx, w);
      const ny = wrapY(pixel.y + dy, h);
      const neighbor = world.pixels.get(cellKey(nx, ny, w));
      if (neighbor && neighbor.packId === pixel.packId && neighbor.id !== pixel.id) {
        return true;
      }
    }
  }
  return false;
}

// Get pack size for a pixel
export function getPackSize(pixel: Pixel): number {
  if (pixel.packId === 0) return 0;
  const pack = packs.get(pixel.packId);
  return pack ? pack.members.size : 0;
}
