// Species Tree: tracks lineage branching and renders phylogenetic tree
// Species = clusters of genetically similar creatures, tracked across time

import type { World } from './types';
import { getCreatureRole } from './metabolism';
import { SPECIES_DISTANCE_THRESHOLD, SPECIES_COMPUTE_INTERVAL } from './constants';
import { pushNotification } from './arms-race';

const ROLE_NAMES = ['Plant', 'Hunter', 'Apex', 'Scavenger', 'Parasite', 'Swarm', 'Nomad'];
const NEW_SPECIES_NOTIFY_AFTER_TICK = 500; // suppress startup flurry

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
let visible = true;
let lastComputeTick = 0;

export function toggleSpeciesTree(): void { visible = !visible; }
export function isSpeciesTreeVisible(): boolean { return visible; }

// Clear all per-run state so a fresh world doesn't inherit ghost species
export function resetSpeciesTree(): void {
  species.clear();
  pixelSpecies.clear();
  nextSpeciesId = 1;
  lastComputeTick = 0;
}

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

      // Visual moment: surface new species as a notification banner (after startup)
      if (world.tick >= NEW_SPECIES_NOTIFY_AFTER_TICK) {
        const parentLabel = parentId ? ` from #${parentId}` : '';
        const roleName = ROLE_NAMES[cluster.role] ?? 'Unknown';
        pushNotification(`* NEW SPECIES #${sp.id} (${roleName})${parentLabel}`, sp.color);
      }
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

  const pw = 280, ph = 190;
  const px = 10, py = canvasH - ph - 24;

  // Panel background
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.fillRect(px - 6, py - 22, pw + 12, ph + 30);

  // Title
  ctx.font = 'bold 11px Consolas, monospace';
  ctx.fillStyle = '#00ff88';
  ctx.fillText('SPECIES ALIVE', px, py - 8);
  ctx.font = '9px Consolas, monospace';
  ctx.fillStyle = '#556';
  ctx.fillText('(T to hide)', px + 110, py - 8);

  // Sort: alive by population desc
  const all = Array.from(species.values());
  const alive = all.filter(s => s.alive).sort((a, b) => b.currentPop - a.currentPop);
  const extinct = all.filter(s => !s.alive).length;

  if (alive.length === 0) {
    ctx.font = '10px Consolas, monospace';
    ctx.fillStyle = '#556';
    ctx.fillText('No species detected yet...', px + 10, py + 20);
    return;
  }

  // Normalize population for bar width
  const maxPop = Math.max(5, ...alive.map(s => s.currentPop));
  const rowH = 18;
  const maxRows = Math.min(alive.length, 8);
  const listStartY = py + 6;

  ctx.font = '10px Consolas, monospace';
  for (let i = 0; i < maxRows; i++) {
    const sp = alive[i];
    const y = listStartY + i * rowH;

    // Role color dot
    ctx.fillStyle = sp.color;
    ctx.beginPath();
    ctx.arc(px + 6, y + 4, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // Dominant role name
    let domRole = 0, domCount = 0;
    for (let r = 0; r < 7; r++) {
      if (sp.roleDistribution[r] > domCount) {
        domCount = sp.roleDistribution[r];
        domRole = r;
      }
    }
    const roleName = ROLE_NAMES[domRole] ?? '?';

    // Role + id
    ctx.fillStyle = '#ccd';
    ctx.fillText(roleName, px + 14, y + 7);
    ctx.fillStyle = '#667';
    ctx.fillText(`#${sp.id}`, px + 86, y + 7);

    // Population bar
    const barX = px + 120;
    const barMaxW = pw - 170;
    const barW = barMaxW * (sp.currentPop / maxPop);
    ctx.fillStyle = 'rgba(40,40,60,0.6)';
    ctx.fillRect(barX, y, barMaxW, 10);
    ctx.fillStyle = sp.color;
    ctx.globalAlpha = 0.8;
    ctx.fillRect(barX, y, barW, 10);
    ctx.globalAlpha = 1;

    // Count
    ctx.fillStyle = '#ccd';
    const countStr = `${sp.currentPop}`;
    ctx.fillText(countStr, px + pw - 28, y + 7);

    // Parent indicator (origin)
    if (sp.parentId) {
      ctx.fillStyle = '#446';
      ctx.font = '8px Consolas, monospace';
      ctx.fillText(`from #${sp.parentId}`, px + 14, y + 14);
      ctx.font = '10px Consolas, monospace';
    }
  }

  // Truncation indicator
  if (alive.length > maxRows) {
    ctx.font = '8px Consolas, monospace';
    ctx.fillStyle = '#556';
    ctx.fillText(`+${alive.length - maxRows} more...`, px + 14, listStartY + maxRows * rowH + 4);
  }

  // Footer summary
  ctx.font = '9px Consolas, monospace';
  ctx.fillStyle = '#667';
  ctx.fillText(`${alive.length} alive  •  ${extinct} extinct`, px, py + ph - 2);
}
