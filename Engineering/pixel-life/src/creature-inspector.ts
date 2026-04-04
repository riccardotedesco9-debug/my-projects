// Creature Inspector: detailed panel showing genome, state, memory, and sensor info
// Replaces the basic tooltip with a rich side panel

import type { Pixel, World, SimConfig } from './types';
import { GENE } from './types';
import { getCreatureRole } from './metabolism';
import { getEffectiveGene } from './pixel';
import { genomeComplexity } from './regulation';
import { formatPixelState } from './pixel-state';

const GENE_NAMES = [
  'Harvest R', 'Harvest G', 'Harvest B', 'Speed', 'Sense Range',
  'Sense Target', 'React Type', 'React Thresh', 'Waste R', 'Waste G',
  'Waste B', 'Repro Thresh', 'Repro Share', 'Mutation', 'Armor', 'Adhesion',
];
const GENE_COLORS = [
  '#44ff88', '#44ff88', '#44ff88', '#44aaff', '#ff44aa', '#ff44aa',
  '#ff6644', '#ff6644', '#888', '#888', '#888',
  '#ffaa44', '#ffaa44', '#cc44ff', '#ffaa44', '#44cccc',
];
const ROLE_NAMES = ['Plant', 'Hunter', 'Apex', 'Scavenger', 'Parasite', 'Swarm', 'Nomad'];
const ROLE_COLORS_HEX = ['#44cc44', '#cc8844', '#cc3333', '#aa8866', '#aa44cc', '#44cccc', '#cccc44'];

let trackedId: number | null = null;
let followMode = false;
let panelEl: HTMLElement | null = null;
let energyHistory: number[] = [];

export function initInspector(): void {
  panelEl = document.getElementById('inspector-panel');
  if (!panelEl) return;
  panelEl.style.display = 'none';
}

export function showInspector(pixel: Pixel): void {
  trackedId = pixel.id;
  energyHistory = [pixel.energy];
  if (panelEl) panelEl.style.display = 'block';
}

export function hideInspector(): void {
  trackedId = null;
  followMode = false;
  if (panelEl) panelEl.style.display = 'none';
}

export function toggleFollow(): void { followMode = !followMode; }
export function isFollowing(): boolean { return followMode; }
export function getTrackedId(): number | null { return trackedId; }

let _cachedPixel: Pixel | null = null;
let _cacheFrame = 0;

export function getTrackedPixel(world: World): Pixel | null {
  if (trackedId === null) return null;
  // Cache for 1 frame — avoid O(n) scan at 60fps
  const frame = (world as any).tick ?? 0;
  if (_cachedPixel && _cachedPixel.id === trackedId && _cacheFrame === frame) return _cachedPixel;
  _cacheFrame = frame;

  // Check if creature is at its known position first (O(1))
  if (_cachedPixel && _cachedPixel.id === trackedId) {
    const key = _cachedPixel.y * world.width + _cachedPixel.x;
    const atPos = world.pixels.get(key);
    if (atPos && atPos.id === trackedId) return (_cachedPixel = atPos);
  }

  // Fallback: scan (only when creature moved or died)
  for (const p of world.pixels.values()) {
    if (p.id === trackedId) { _cachedPixel = p; return p; }
  }
  trackedId = null;
  followMode = false;
  _cachedPixel = null;
  return null;
}

export function updateInspector(world: World, _config: SimConfig): void {
  if (!panelEl || trackedId === null) return;
  const pixel = getTrackedPixel(world);
  if (!pixel) {
    panelEl.innerHTML = '<div style="color:#ff6644;padding:8px;">Creature died</div>';
    return;
  }

  // Track energy history
  energyHistory.push(pixel.energy);
  if (energyHistory.length > 60) energyHistory.shift();

  const role = getCreatureRole(pixel);
  const complexity = genomeComplexity(pixel);
  const stateStr = formatPixelState(pixel);

  // Build gene bars HTML
  let geneBars = '';
  for (let i = 0; i < 16; i++) {
    const raw = pixel.dna[i];
    const eff = getEffectiveGene(pixel, i);
    const pct = (eff / 255) * 100;
    const diff = eff !== raw ? ` (${raw}→${eff})` : '';
    geneBars += `<div style="display:flex;align-items:center;gap:4px;font-size:9px;margin:1px 0">
      <span style="width:58px;color:${GENE_COLORS[i]}">${GENE_NAMES[i]}</span>
      <div style="flex:1;height:6px;background:#1a1a2e;border-radius:2px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${GENE_COLORS[i]}80"></div>
      </div>
      <span style="width:32px;text-align:right;color:#aab">${eff}${diff}</span>
    </div>`;
  }

  // Energy sparkline (ASCII-style)
  const maxE = Math.max(...energyHistory, 1);
  const sparkline = energyHistory.map(e => {
    const h = Math.floor((e / maxE) * 8);
    return '▁▂▃▄▅▆▇█'[Math.min(8, h)];
  }).join('');

  // Memory entries
  let memoryHtml = '';
  if (pixel.memory.length > 0) {
    memoryHtml = pixel.memory.map(m => {
      const typeColor = m.type === 'food' ? '#44ff88' : m.type === 'danger' ? '#ff4444' : '#4488ff';
      return `<span style="color:${typeColor}">${m.type}</span>(${m.x},${m.y}) str:${Math.floor(m.strength)}`;
    }).join('<br/>');
  } else {
    memoryHtml = '<span style="color:#556">none</span>';
  }

  // State bars
  const threatPct = (pixel.state[0] / 255) * 100;
  const satietyPct = (pixel.state[1] / 255) * 100;
  const socialPct = (pixel.state[2] / 255) * 100;

  panelEl.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <span style="color:${ROLE_COLORS_HEX[role]};font-weight:bold">${ROLE_NAMES[role]} #${pixel.id}</span>
      <span style="color:#556;font-size:9px">Gen ${pixel.generation} | Age ${pixel.age}</span>
    </div>
    <div style="margin:4px 0;font-size:10px">
      Energy: <span style="color:#ffcc44">${pixel.energy.toFixed(1)}</span>
      | Pos: (${pixel.x},${pixel.y})
      | ${followMode ? '<span style="color:#00ff88">FOLLOW</span>' : '<span style="color:#556">F=follow</span>'}
    </div>
    <div style="font-size:9px;color:#667;margin:2px 0">${sparkline}</div>
    <div style="font-size:9px;color:#889;margin:2px 0">${stateStr}</div>
    <div style="margin:4px 0">
      <div style="display:flex;gap:4px;align-items:center;font-size:9px">
        <span style="color:#ff4444;width:36px">Threat</span>
        <div style="flex:1;height:4px;background:#1a1a2e;border-radius:2px"><div style="width:${threatPct}%;height:100%;background:#ff4444"></div></div>
      </div>
      <div style="display:flex;gap:4px;align-items:center;font-size:9px">
        <span style="color:#44ff88;width:36px">Satiety</span>
        <div style="flex:1;height:4px;background:#1a1a2e;border-radius:2px"><div style="width:${satietyPct}%;height:100%;background:#44ff88"></div></div>
      </div>
      <div style="display:flex;gap:4px;align-items:center;font-size:9px">
        <span style="color:#44cccc;width:36px">Social</span>
        <div style="flex:1;height:4px;background:#1a1a2e;border-radius:2px"><div style="width:${socialPct}%;height:100%;background:#44cccc"></div></div>
      </div>
    </div>
    <div style="border-top:1px solid #1a1a2e;margin:4px 0;padding-top:4px">
      <div style="font-size:9px;color:#556;margin-bottom:2px">GENOME (${complexity} complexity, ${pixel.regulatoryGenes.length} reg)</div>
      ${geneBars}
    </div>
    <div style="border-top:1px solid #1a1a2e;margin:4px 0;padding-top:4px">
      <div style="font-size:9px;color:#556;margin-bottom:2px">MEMORY (${pixel.memory.length}/8)</div>
      <div style="font-size:9px;line-height:1.5">${memoryHtml}</div>
    </div>
  `;
}

// Draw inspector overlays on the pixel canvas (sensor range, highlight ring)
export function renderInspectorOverlay(ctx: CanvasRenderingContext2D, world: World, config: SimConfig): void {
  const pixel = getTrackedPixel(world);
  if (!pixel) return;

  const S = config.pixelScale;
  const cx = pixel.x * S + S / 2;
  const cy = pixel.y * S + S / 2;

  // Highlight ring around tracked creature
  ctx.strokeStyle = '#00ff88';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.arc(cx, cy, S * 0.8, 0, Math.PI * 2);
  ctx.stroke();

  // Sensor range circle
  const senseRange = Math.floor(getEffectiveGene(pixel, GENE.SENSE_RANGE) / 255 * 5);
  if (senseRange > 0) {
    ctx.strokeStyle = 'rgba(0,255,136,0.15)';
    ctx.lineWidth = 0.3;
    ctx.beginPath();
    ctx.arc(cx, cy, senseRange * S, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Memory location markers
  for (const m of pixel.memory) {
    const mx = m.x * S + S / 2;
    const my = m.y * S + S / 2;
    const alpha = (m.strength / 255) * 0.5;
    if (m.type === 'food') {
      ctx.fillStyle = `rgba(68,255,136,${alpha})`;
    } else if (m.type === 'danger') {
      ctx.fillStyle = `rgba(255,68,68,${alpha})`;
    } else {
      ctx.fillStyle = `rgba(68,136,255,${alpha})`;
    }
    ctx.fillRect(mx - 1, my - 1, 2, 2);
    // Line from creature to memory
    ctx.strokeStyle = `rgba(0,255,136,${alpha * 0.3})`;
    ctx.lineWidth = 0.2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(mx, my);
    ctx.stroke();
  }
}
