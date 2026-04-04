import type { World, SimConfig } from './types';
import { getSeasonColor } from './seasons';
import { genomeDistance } from './genome';
import { genomeComplexity } from './regulation';
import { getCreatureRole } from './metabolism';
import { getWeatherLabel } from './weather';
import { SPECIES_DISTANCE_THRESHOLD, SPECIES_COMPUTE_INTERVAL, POP_HISTORY_LENGTH } from './constants';

let miniGraphCanvas: HTMLCanvasElement;
let miniGraphCtx: CanvasRenderingContext2D;
let cachedSpeciesCount = 0;
let cachedDiversity = 0;

export function initStats(_world: World, _config: SimConfig): void {
  miniGraphCanvas = document.getElementById('mini-graph') as HTMLCanvasElement;
  miniGraphCanvas.width = 248;
  miniGraphCanvas.height = 50;
  miniGraphCtx = miniGraphCanvas.getContext('2d')!;
  cachedSpeciesCount = 0;
  cachedDiversity = 0;
}

// TPS tracking (set by main.ts each second)
let _displayTps = 0;
export function setDisplayTps(v: number): void { _displayTps = v; }
export function getDisplayTps(): number { return _displayTps; }

export function updateStatsDisplay(world: World, _config: SimConfig): void {
  setText('stat-tick', String(world.tick));
  setText('stat-tps', String(_displayTps));
  setText('stat-population', String(world.pixels.size));
  setText('stat-season', world.season);

  const indicator = document.getElementById('season-indicator')!;
  indicator.style.backgroundColor = getSeasonColor(world.season);

  let totalEnergy = 0, maxGen = 0, maxGenomeLen = 16;
  const roleCounts = [0, 0, 0, 0, 0, 0, 0]; // plant, hunter, apex, scavenger, parasite, swarm, nomad

  for (const p of world.pixels.values()) {
    totalEnergy += p.energy;
    if (p.generation > maxGen) maxGen = p.generation;
    const c = genomeComplexity(p);
    if (c > maxGenomeLen) maxGenomeLen = c;
    const role = getCreatureRole(p);
    if (role < 7) roleCounts[role]++;
  }

  setText('stat-energy', world.pixels.size > 0 ? (totalEnergy / world.pixels.size).toFixed(1) : '0');
  setText('stat-oldest', String(maxGen));
  setText('stat-genome-len', String(maxGenomeLen));
  setText('stat-producers', String(roleCounts[0]));
  setText('stat-consumers', String(roleCounts[1]));
  setText('stat-apex', String(roleCounts[2]));
  setText('stat-other', `S:${roleCounts[3]} P:${roleCounts[4]} W:${roleCounts[5]} N:${roleCounts[6]}`);

  // Weather
  setText('stat-weather', getWeatherLabel(world.weather));

  // Event display
  if (world.activeEvent) {
    setText('stat-event', `${world.activeEvent.type} (${world.activeEvent.ticksLeft}t)`);
  } else {
    setText('stat-event', 'none');
  }

  // Species (periodic)
  if (world.tick % SPECIES_COMPUTE_INTERVAL === 0 && world.pixels.size > 0) {
    const result = computeSpecies(world);
    cachedSpeciesCount = result.species;
    cachedDiversity = result.diversity;
  }
  setText('stat-species', String(cachedSpeciesCount));
  setText('stat-diversity', cachedDiversity.toFixed(2));

  drawPopGraph(world);
}

function computeSpecies(world: World): { species: number; diversity: number } {
  const pixels = Array.from(world.pixels.values());
  if (pixels.length === 0) return { species: 0, diversity: 0 };

  const sample = pixels.length > 200
    ? pixels.sort(() => Math.random() - 0.5).slice(0, 200) : pixels;
  const assigned = new Set<number>();
  let speciesCount = 0;

  for (let i = 0; i < sample.length; i++) {
    if (assigned.has(i)) continue;
    assigned.add(i);
    speciesCount++;
    for (let j = i + 1; j < sample.length; j++) {
      if (assigned.has(j)) continue;
      if (genomeDistance(sample[i].dna, sample[j].dna) < SPECIES_DISTANCE_THRESHOLD) assigned.add(j);
    }
  }

  let sumST = 0, sumST2 = 0, sumRT = 0, sumRT2 = 0;
  for (const p of sample) {
    sumST += p.dna[5]; sumST2 += p.dna[5] * p.dna[5];
    sumRT += p.dna[6]; sumRT2 += p.dna[6] * p.dna[6];
  }
  const n = sample.length;
  const varST = (sumST2 / n) - (sumST / n) ** 2;
  const varRT = (sumRT2 / n) - (sumRT / n) ** 2;
  const diversity = (Math.sqrt(Math.max(0, varST)) + Math.sqrt(Math.max(0, varRT))) / 255;

  return { species: speciesCount, diversity };
}

function drawPopGraph(world: World): void {
  const ctx = miniGraphCtx;
  const w = miniGraphCanvas.width, h = miniGraphCanvas.height;
  ctx.fillStyle = '#0a0a14';
  ctx.fillRect(0, 0, w, h);

  const history = world.popHistory;
  if (history.length < 2) return;
  const maxPop = Math.max(...history, 1);
  const step = w / POP_HISTORY_LENGTH;

  ctx.strokeStyle = '#00ff8866';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < history.length; i++) {
    const x = i * step;
    const y = h - (history[i] / maxPop) * (h - 4) - 2;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
