// On-canvas HUD: minimal overlay showing season, weather, population bar, and evolution trends
// Renders directly onto the pixel canvas — always visible without reading the side panel

import type { World, SimConfig } from './types';
import { getCreatureRole } from './metabolism';
import { GENE } from './types';

// Track trait averages over time for trend arrows
const TRAIT_HISTORY_LEN = 20; // samples
const traitHistory: { speed: number; armor: number; harvest: number; sense: number }[] = [];
let lastSampleTick = 0;

// Season transition flash
let prevSeason = '';
let seasonFlashAlpha = 0;

const ROLE_COLORS = ['#44cc44', '#cc8844', '#cc3333', '#aa8866', '#aa44cc', '#44cccc', '#cccc44'];
const ROLE_LABELS = ['Plant', 'Hunter', 'Apex', 'Scvgr', 'Para', 'Swarm', 'Nomad'];

export function renderCanvasHud(ctx: CanvasRenderingContext2D, world: World, config: SimConfig): void {
  const dw = config.worldWidth * config.pixelScale;
  const dh = config.worldHeight * config.pixelScale;

  // Sample traits periodically
  if (world.tick - lastSampleTick >= 100 && world.pixels.size > 0) {
    sampleTraits(world);
    lastSampleTick = world.tick;
  }

  // Ensure HUD renders in screen-space (identity transform)
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // -- Season transition flash --
  if (prevSeason && prevSeason !== world.season) {
    seasonFlashAlpha = 0.3;
  }
  prevSeason = world.season;
  if (seasonFlashAlpha > 0.01) {
    const flashColors: Record<string, string> = {
      spring: '#44ff44', summer: '#ffcc22', autumn: '#ff6622', winter: '#4488ff',
    };
    ctx.fillStyle = flashColors[world.season] ?? '#ffffff';
    ctx.globalAlpha = seasonFlashAlpha;
    ctx.fillRect(0, 0, dw, dh);
    ctx.globalAlpha = 1;
    seasonFlashAlpha *= 0.92; // fade out
  }

  // -- Top-left: Season + Weather --
  drawSeasonWeather(ctx, world);

  // -- Bottom: Population role bar --
  drawPopulationBar(ctx, world, dw, dh);

  // -- Top-right: Evolution trends --
  drawEvolutionTrends(ctx, dw);

  ctx.restore();
}

function drawSeasonWeather(ctx: CanvasRenderingContext2D, world: World): void {
  const seasonColors: Record<string, string> = {
    spring: '#66cc66', summer: '#ccaa33', autumn: '#cc6633', winter: '#6688cc',
  };
  const weatherIcons: Record<string, string> = {
    clear: '', rain: 'rain', fog: 'fog', snow: 'snow',
    storm: 'STORM', drought: 'DROUGHT', heatwave: 'HEAT',
  };

  const wType = world.weather?.type ?? 'clear';
  const intensity = world.weather?.intensity ?? 0;

  // Season badge
  ctx.font = '11px Consolas, monospace';
  ctx.fillStyle = '#00000088';
  ctx.fillRect(6, 6, 80, 18);
  ctx.fillStyle = seasonColors[world.season] ?? '#aaa';
  ctx.fillText(world.season.toUpperCase(), 12, 19);

  // Weather badge (only if active)
  if (wType !== 'clear') {
    const label = weatherIcons[wType] ?? wType;
    const pct = Math.round(intensity * 100);
    ctx.fillStyle = '#00000088';
    ctx.fillRect(90, 6, 90, 18);
    ctx.fillStyle = wType === 'storm' || wType === 'drought' ? '#ff6644' : '#aaccee';
    ctx.fillText(`${label} ${pct}%`, 96, 19);
  }
}

function drawPopulationBar(ctx: CanvasRenderingContext2D, world: World, dw: number, dh: number): void {
  if (world.pixels.size === 0) return;

  const roleCounts = [0, 0, 0, 0, 0, 0, 0];
  for (const p of world.pixels.values()) {
    const role = getCreatureRole(p);
    if (role < 7) roleCounts[role]++;
  }

  const total = world.pixels.size;
  const barY = dh - 12;
  const barW = Math.min(dw - 20, 300);
  const barX = (dw - barW) / 2;
  const barH = 6;

  // Background
  ctx.fillStyle = '#00000066';
  ctx.fillRect(barX - 2, barY - 2, barW + 4, barH + 4);

  // Stacked bar
  let x = barX;
  for (let i = 0; i < 7; i++) {
    if (roleCounts[i] === 0) continue;
    const w = (roleCounts[i] / total) * barW;
    ctx.fillStyle = ROLE_COLORS[i];
    ctx.fillRect(x, barY, Math.max(1, w), barH);
    // Label if segment is wide enough
    if (w > 25) {
      ctx.font = '8px Consolas, monospace';
      ctx.fillStyle = '#000';
      ctx.fillText(ROLE_LABELS[i], x + 2, barY + 5);
    }
    x += w;
  }
}

function sampleTraits(world: World): void {
  let sumSpeed = 0, sumArmor = 0, sumHarvest = 0, sumSense = 0;
  let n = 0;
  for (const p of world.pixels.values()) {
    sumSpeed += p.dna[GENE.SPEED];
    sumArmor += p.dna[GENE.ARMOR];
    sumHarvest += (p.dna[GENE.HARVEST_R] + p.dna[GENE.HARVEST_G] + p.dna[GENE.HARVEST_B]) / 3;
    sumSense += p.dna[GENE.SENSE_RANGE];
    n++;
  }
  if (n === 0) return;
  traitHistory.push({
    speed: sumSpeed / n, armor: sumArmor / n,
    harvest: sumHarvest / n, sense: sumSense / n,
  });
  if (traitHistory.length > TRAIT_HISTORY_LEN) traitHistory.shift();
}

function drawEvolutionTrends(ctx: CanvasRenderingContext2D, dw: number): void {
  if (traitHistory.length < 3) return;

  const recent = traitHistory[traitHistory.length - 1];
  const old = traitHistory[Math.max(0, traitHistory.length - 6)];

  const traits: { name: string; key: keyof typeof recent; delta: number; color: string }[] = [
    { name: 'SPD', key: 'speed', delta: recent.speed - old.speed, color: '#44aaff' },
    { name: 'ARM', key: 'armor', delta: recent.armor - old.armor, color: '#ffaa44' },
    { name: 'HRV', key: 'harvest', delta: recent.harvest - old.harvest, color: '#44ff66' },
    { name: 'SNS', key: 'sense', delta: recent.sense - old.sense, color: '#ff44aa' },
  ];

  const panelX = dw - 120;
  const panelH = 72;
  ctx.fillStyle = '#00000099';
  ctx.fillRect(panelX - 4, 4, 122, panelH);

  ctx.font = '8px Consolas, monospace';
  ctx.fillStyle = '#889';
  ctx.fillText('EVOLUTION', panelX, 14);

  for (let i = 0; i < traits.length; i++) {
    const t = traits[i];
    const y = 24 + i * 13;
    const arrow = t.delta > 3 ? '\u25B2' : t.delta < -3 ? '\u25BC' : '\u25CF';
    const arrowColor = t.delta > 3 ? '#44ff66' : t.delta < -3 ? '#ff4444' : '#556';

    // Label + value
    ctx.fillStyle = t.color;
    ctx.fillText(t.name, panelX, y);
    ctx.fillStyle = '#bbc';
    ctx.fillText(Math.round(recent[t.key]).toString(), panelX + 26, y);

    // Trend arrow
    ctx.fillStyle = arrowColor;
    ctx.fillText(arrow, panelX + 46, y);

    // Sparkline (mini graph of trait history)
    const sparkX = panelX + 58;
    const sparkW = 55;
    const sparkH = 8;
    const sparkY = y - 6;
    drawSparkline(ctx, sparkX, sparkY, sparkW, sparkH, t.key, t.color);
  }
}

function drawSparkline(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number,
  key: string, color: string,
): void {
  if (traitHistory.length < 2) return;

  // Get min/max for scale
  let min = 255, max = 0;
  for (const s of traitHistory) {
    const v = s[key as keyof typeof s] as number;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = Math.max(1, max - min);

  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  for (let i = 0; i < traitHistory.length; i++) {
    const v = traitHistory[i][key as keyof typeof traitHistory[0]] as number;
    const px = x + (i / (traitHistory.length - 1)) * w;
    const py = y + h - ((v - min) / range) * h;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}
