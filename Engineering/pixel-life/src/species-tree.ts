// Species Tree: tracks lineage branching and renders phylogenetic tree
// Species = clusters of genetically similar creatures, tracked across time

import type { World } from './types';
import { getCreatureRole } from './metabolism';
import { SPECIES_DISTANCE_THRESHOLD, SPECIES_COMPUTE_INTERVAL } from './constants';

interface SpeciesNode {
  id: number;
  parentId: number | null;
  firstTick: number;
  lastTick: number;
  alive: boolean;
  roleDistribution: number[];  // count per role
  peakPop: number;
  currentPop: number;
  color: string;               // derived from species DNA centroid
}

const species: Map<number, SpeciesNode> = new Map();
const pixelSpecies = new Map<number, number>(); // pixelId → speciesId
let nextSpeciesId = 1;
let visible = false;
let lastComputeTick = 0;

export function toggleSpeciesTree(): void { visible = !visible; }
export function isSpeciesTreeVisible(): boolean { return visible; }

export function updateSpeciesTree(world: World): void {
  if (world.tick - lastComputeTick < SPECIES_COMPUTE_INTERVAL) return;
  lastComputeTick = world.tick;

  // Clear stale mappings — we reassign all sampled pixels below
  pixelSpecies.clear();

  // Collect pixel DNAs and roles — sample cap for performance
  let pixels = Array.from(world.pixels.values());
  if (pixels.length === 0) return;
  if (pixels.length > 300) {
    // Random sample of 300 to avoid O(n^2) blowup
    for (let i = pixels.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pixels[i], pixels[j]] = [pixels[j], pixels[i]];
    }
    pixels = pixels.slice(0, 300);
  }

  // Simple clustering: group pixels by genome similarity
  const assigned = new Set<number>();
  const clusters: { members: number[]; centroid: Uint8Array; role: number }[] = [];

  for (const p of pixels) {
    if (assigned.has(p.id)) continue;

    const cluster = [p.id];
    assigned.add(p.id);
    const role = getCreatureRole(p);

    // Find all similar unassigned pixels
    for (const other of pixels) {
      if (assigned.has(other.id)) continue;
      if (getCreatureRole(other) !== role) continue;
      let dist = 0;
      for (let g = 0; g < 16; g++) dist += Math.abs(p.dna[g] - other.dna[g]);
      if (dist < SPECIES_DISTANCE_THRESHOLD * 16) {
        cluster.push(other.id);
        assigned.add(other.id);
      }
    }

    if (cluster.length >= 2) {
      clusters.push({ members: cluster, centroid: p.dna, role });
    }
  }

  // Match clusters to existing species or create new ones
  for (const cluster of clusters) {
    let bestMatch: SpeciesNode | null = null;
    let bestOverlap = 0;

    for (const sp of species.values()) {
      if (!sp.alive) continue;
      // Count how many cluster members were in this species last time
      let overlap = 0;
      for (const pid of cluster.members) {
        if (pixelSpecies.get(pid) === sp.id) overlap++;
      }
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestMatch = sp;
      }
    }

    if (bestMatch && bestOverlap > cluster.members.length * 0.3) {
      // Update existing species
      bestMatch.lastTick = world.tick;
      bestMatch.currentPop = cluster.members.length;
      bestMatch.peakPop = Math.max(bestMatch.peakPop, cluster.members.length);
      bestMatch.alive = true;
      for (const pid of cluster.members) pixelSpecies.set(pid, bestMatch.id);
    } else {
      // New species — check if it split from an existing one
      let parentId: number | null = null;
      if (bestMatch) parentId = bestMatch.id;

      const hue = (nextSpeciesId * 137 + cluster.role * 51) % 360;
      const sp: SpeciesNode = {
        id: nextSpeciesId++,
        parentId,
        firstTick: world.tick,
        lastTick: world.tick,
        alive: true,
        roleDistribution: new Array(7).fill(0),
        peakPop: cluster.members.length,
        currentPop: cluster.members.length,
        color: `hsl(${hue},70%,55%)`,
      };
      sp.roleDistribution[cluster.role] = cluster.members.length;
      species.set(sp.id, sp);
      for (const pid of cluster.members) pixelSpecies.set(pid, sp.id);
    }
  }

  // Mark species with no members as extinct
  for (const sp of species.values()) {
    if (!sp.alive) continue;
    if (world.tick - sp.lastTick > SPECIES_COMPUTE_INTERVAL * 3) {
      sp.alive = false;
    }
  }

  // Prune very old extinct species (keep last 50)
  if (species.size > 80) {
    const sorted = Array.from(species.values()).sort((a, b) => a.lastTick - b.lastTick);
    const toRemove = sorted.slice(0, sorted.length - 50);
    for (const sp of toRemove) {
      if (!sp.alive) species.delete(sp.id);
    }
  }
}

export function renderSpeciesTree(ctx: CanvasRenderingContext2D, _canvasW: number, canvasH: number): void {
  if (!visible) return;

  const tw = 260, th = 200;
  const tx = 10, ty = canvasH - th - 30;

  // Background
  ctx.fillStyle = 'rgba(0,0,0,0.8)';
  ctx.fillRect(tx - 5, ty - 18, tw + 10, th + 24);

  ctx.font = '10px Consolas, monospace';
  ctx.fillStyle = '#889';
  ctx.fillText('SPECIES TREE (T to toggle)', tx, ty - 6);

  const activeSpecies = Array.from(species.values())
    .filter(s => s.alive || s.lastTick > (species.values().next().value?.firstTick ?? 0) - 10000)
    .sort((a, b) => a.firstTick - b.firstTick);

  if (activeSpecies.length === 0) {
    ctx.fillStyle = '#556';
    ctx.fillText('No species detected yet...', tx + 10, ty + 20);
    return;
  }

  // Find time range
  const minTick = activeSpecies[0].firstTick;
  const maxTick = Math.max(...activeSpecies.map(s => s.lastTick));
  const tickRange = Math.max(1, maxTick - minTick);

  // Draw each species as a horizontal bar
  const barH = Math.min(12, (th - 10) / activeSpecies.length);
  for (let i = 0; i < activeSpecies.length && i < 15; i++) {
    const sp = activeSpecies[i];
    const y = ty + 4 + i * barH;
    const x0 = tx + ((sp.firstTick - minTick) / tickRange) * (tw - 40) + 30;
    const x1 = tx + ((sp.lastTick - minTick) / tickRange) * (tw - 40) + 30;

    // Bar
    ctx.fillStyle = sp.color;
    ctx.globalAlpha = sp.alive ? 0.8 : 0.3;
    ctx.fillRect(x0, y, Math.max(2, x1 - x0), barH - 2);
    ctx.globalAlpha = 1;

    // Extinction marker
    if (!sp.alive) {
      ctx.fillStyle = '#ff4444';
      ctx.fillRect(x1 - 1, y, 2, barH - 2);
    }

    // Branch line to parent
    if (sp.parentId) {
      const parentIdx = activeSpecies.findIndex(s => s.id === sp.parentId);
      if (parentIdx >= 0) {
        const parentY = ty + 4 + parentIdx * barH + barH / 2;
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(x0, y + barH / 2);
        ctx.lineTo(x0 - 5, y + barH / 2);
        ctx.lineTo(x0 - 5, parentY);
        ctx.stroke();
      }
    }

    // Label
    ctx.fillStyle = sp.alive ? '#bbc' : '#556';
    ctx.font = '7px Consolas, monospace';
    ctx.fillText(`#${sp.id} (${sp.currentPop})`, tx + 2, y + barH - 3);
  }
}
