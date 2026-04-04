import type { World, SimConfig, Pixel } from './types';
import { GENE } from './types';
import { dnaToColor, energyToColor, lineageToColor, roleToColor } from './color-map';
import { getCreatureRole } from './metabolism';
import { terrainColorInContext } from './terrain';
import { SUBSTRATE_RENDER_INTERVAL } from './constants';
import type { Weather } from './weather';

let subCanvas: HTMLCanvasElement;
let pixCanvas: HTMLCanvasElement;
let subCtx: CanvasRenderingContext2D;
let pixCtx: CanvasRenderingContext2D;
let subImage: ImageData;
let frameCount = 0;
let S = 5, W = 200, H = 150;

export function initRenderer(_world: World, config: SimConfig): void {
  const { worldWidth: w, worldHeight: h, pixelScale: s } = config;
  S = s; W = w; H = h;
  subCanvas = document.getElementById('substrate-canvas') as HTMLCanvasElement;
  pixCanvas = document.getElementById('pixel-canvas') as HTMLCanvasElement;

  const dw = w * s, dh = h * s;
  subCanvas.width = dw; subCanvas.height = dh;
  pixCanvas.width = dw; pixCanvas.height = dh;
  subCanvas.style.width = `${dw}px`; subCanvas.style.height = `${dh}px`;
  pixCanvas.style.width = `${dw}px`; pixCanvas.style.height = `${dh}px`;

  subCtx = subCanvas.getContext('2d', { alpha: false })!;
  pixCtx = pixCanvas.getContext('2d', { alpha: true })!;
  subCtx.imageSmoothingEnabled = false;
  pixCtx.imageSmoothingEnabled = false;
  subImage = subCtx.createImageData(dw, dh);
  frameCount = 0;
}

export function renderFrame(world: World, config: SimConfig): void {
  frameCount++;
  if (frameCount % SUBSTRATE_RENDER_INTERVAL === 0 || frameCount === 1) {
    renderTerrain(world, config);
  }
  renderPixels(world, config);
  renderWeather(world.weather as Weather);
}

function renderTerrain(world: World, config: SimConfig): void {
  const data = subImage.data;
  const dw = W * S;
  const showFood = config.viewMode === 'substrate';

  for (let wy = 0; wy < H; wy++) {
    for (let wx = 0; wx < W; wx++) {
      const ci = wy * W + wx;
      const wType = world.weather?.type ?? 'clear';
      let [r, g, b] = terrainColorInContext(world.terrain[ci], wx, wy, wType, world.season, world.wear[ci]);

      // Food overlay in substrate view
      if (showFood) {
        const food = world.food[ci];
        if (food > 0.05) {
          const boost = Math.min(1, food) * 35;
          r = Math.min(255, r + (boost * 0.3) | 0);
          g = Math.min(255, g + (boost * 1.2) | 0);
        }
      }

      // Pheromone: subtle warm glow
      const ph = world.pheromone[ci];
      if (ph > 0.02) { r = Math.min(255, r + (ph * 8) | 0); g = Math.min(255, g + (ph * 5) | 0); }

      // Corpses: brownish marks
      const corpse = world.corpses[ci];
      if (corpse > 0) {
        const cf = Math.min(1, corpse / 50);
        r = Math.min(255, r + (cf * 40) | 0); g = Math.min(255, g + (cf * 15) | 0);
      }

      // Fill S×S block
      for (let dy = 0; dy < S; dy++) {
        const rowStart = ((wy * S + dy) * dw + wx * S) * 4;
        for (let dx = 0; dx < S; dx++) {
          const pi = rowStart + dx * 4;
          data[pi] = r; data[pi + 1] = g; data[pi + 2] = b; data[pi + 3] = 255;
        }
      }
    }
  }
  subCtx.putImageData(subImage, 0, 0);
}

function renderPixels(world: World, config: SimConfig): void {
  pixCtx.clearRect(0, 0, pixCanvas.width, pixCanvas.height);

  for (const pixel of world.pixels.values()) {
    let r: number, g: number, b: number;
    const role = getCreatureRole(pixel);

    switch (config.viewMode) {
      case 'energy': [r, g, b] = energyToColor(pixel.energy); break;
      case 'lineage': [r, g, b] = lineageToColor(pixel.generation); break;
      case 'substrate': [r, g, b] = dnaToColor(pixel.dna, pixel.energy, role); break;
      case 'trophic': [r, g, b] = roleToColor(pixel); break;
      default: [r, g, b] = dnaToColor(pixel.dna, pixel.energy, role);
    }

    if (pixel.age < 3) { r = Math.min(255, r + 120); g = Math.min(255, g + 120); b = Math.min(255, b + 120); }

    const e = pixel.energy / 100;
    if (e < 0.25) { r = (r * 0.4) | 0; g = (g * 0.4) | 0; b = (b * 0.4) | 0; }

    const cx = pixel.x * S + S / 2;
    const cy = pixel.y * S + S / 2;
    const col = `rgb(${r},${g},${b})`;
    drawCreature(pixel, cx, cy, e, role, col, r, g, b);
  }
}

// Roles: 0=plant, 1=hunter, 2=apex, 3=scavenger, 4=parasite, 5=swarm, 6=nomad
function drawCreature(
  pixel: Pixel, cx: number, cy: number, e: number,
  role: number, col: string, r: number, g: number, b: number,
): void {
  const isWall = pixel.dna[14] > 200 && pixel.dna[3] < 50 && pixel.wallTicks > 50;
  if (isWall) {
    pixCtx.fillStyle = `rgb(${(r * 0.3) | 0},${(g * 0.3) | 0},${(b * 0.3) | 0})`;
    pixCtx.fillRect(pixel.x * S, pixel.y * S, S, S);
    return;
  }

  const radius = 2 + e * 2.5;

  // Glow for well-fed
  if (e > 0.6) {
    pixCtx.globalAlpha = 0.08 + e * 0.05;
    pixCtx.fillStyle = col;
    pixCtx.beginPath();
    pixCtx.arc(cx, cy, radius + 2, 0, Math.PI * 2);
    pixCtx.fill();
    pixCtx.globalAlpha = 1;
  }

  pixCtx.fillStyle = col;

  switch (role) {
    case 0: // PLANT: circle
      pixCtx.beginPath();
      pixCtx.arc(cx, cy, radius, 0, Math.PI * 2);
      pixCtx.fill();
      break;
    case 1: // HUNTER: triangle
      drawTriangle(cx, cy, radius, pixel.dna[GENE.SPEED]);
      break;
    case 2: // APEX: diamond + red core
      drawDiamond(cx, cy, radius + 0.5);
      pixCtx.fillStyle = '#ff3333';
      pixCtx.fillRect(cx - 0.5, cy - 0.5, 1.5, 1.5);
      break;
    case 3: // SCAVENGER: X shape (cross)
      drawCross(cx, cy, radius);
      break;
    case 4: // PARASITE: star burst
      drawStar(cx, cy, radius);
      break;
    case 5: // SWARM: hexagon + ring
      drawHexagon(cx, cy, radius);
      pixCtx.strokeStyle = `rgba(${r},${g},${b},0.3)`;
      pixCtx.lineWidth = 0.5;
      pixCtx.beginPath();
      pixCtx.arc(cx, cy, radius + 1.5, 0, Math.PI * 2);
      pixCtx.stroke();
      break;
    case 6: // NOMAD: arrow pointing forward
      drawArrow(cx, cy, radius);
      break;
  }
}

function drawDiamond(cx: number, cy: number, r: number): void {
  pixCtx.beginPath(); pixCtx.moveTo(cx, cy-r); pixCtx.lineTo(cx+r, cy);
  pixCtx.lineTo(cx, cy+r); pixCtx.lineTo(cx-r, cy); pixCtx.closePath(); pixCtx.fill();
}
function drawTriangle(cx: number, cy: number, r: number, speed: number): void {
  const p = 0.6 + (speed / 255) * 0.8; pixCtx.beginPath();
  pixCtx.moveTo(cx, cy-r*p); pixCtx.lineTo(cx+r*0.7, cy+r*0.5);
  pixCtx.lineTo(cx-r*0.7, cy+r*0.5); pixCtx.closePath(); pixCtx.fill();
}
function drawCross(cx: number, cy: number, r: number): void {
  const t = r*0.3; pixCtx.fillRect(cx-r, cy-t, r*2, t*2); pixCtx.fillRect(cx-t, cy-r, t*2, r*2);
}
function drawStar(cx: number, cy: number, r: number): void {
  pixCtx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = (i*Math.PI*2)/5-Math.PI/2, ia = a+Math.PI/5;
    if (i === 0) pixCtx.moveTo(cx+Math.cos(a)*r, cy+Math.sin(a)*r);
    else pixCtx.lineTo(cx+Math.cos(a)*r, cy+Math.sin(a)*r);
    pixCtx.lineTo(cx+Math.cos(ia)*r*0.4, cy+Math.sin(ia)*r*0.4);
  }
  pixCtx.closePath(); pixCtx.fill();
}
function drawHexagon(cx: number, cy: number, r: number): void {
  pixCtx.beginPath();
  for (let i = 0; i < 6; i++) { const a = (i*Math.PI)/3;
    if (i === 0) pixCtx.moveTo(cx+Math.cos(a)*r, cy+Math.sin(a)*r);
    else pixCtx.lineTo(cx+Math.cos(a)*r, cy+Math.sin(a)*r);
  } pixCtx.closePath(); pixCtx.fill();
}
function drawArrow(cx: number, cy: number, r: number): void {
  pixCtx.beginPath(); pixCtx.moveTo(cx+r, cy); pixCtx.lineTo(cx-r*0.5, cy-r*0.6);
  pixCtx.lineTo(cx-r*0.2, cy); pixCtx.lineTo(cx-r*0.5, cy+r*0.6); pixCtx.closePath(); pixCtx.fill();
}

function renderWeather(weather: Weather): void {
  if (weather.type === 'clear') return;
  const dw = W * S, dh = H * S;
  const overlay = (color: string, alpha: number) => {
    pixCtx.globalAlpha = alpha; pixCtx.fillStyle = color;
    pixCtx.fillRect(0, 0, dw, dh); pixCtx.globalAlpha = 1;
  };

  if (weather.type === 'fog') overlay('#8899aa', weather.intensity * 0.25);
  if (weather.type === 'drought') overlay('#cc8844', weather.intensity * 0.08);
  if (weather.type === 'heatwave') overlay('#ff6622', weather.intensity * 0.1);

  // Rain/storm particles
  if (weather.type === 'rain' || weather.type === 'storm') {
    pixCtx.strokeStyle = weather.type === 'storm' ? 'rgba(150,180,255,0.3)' : 'rgba(100,140,200,0.2)';
    pixCtx.lineWidth = 0.5; pixCtx.beginPath();
    for (const p of weather.particles) { pixCtx.moveTo(p.x, p.y); pixCtx.lineTo(p.x - p.speed * 1.5, p.y + p.speed * 5); }
    pixCtx.stroke();
  }
  // Snow particles
  if (weather.type === 'snow') {
    pixCtx.fillStyle = 'rgba(220,230,255,0.5)';
    for (const p of weather.particles) { pixCtx.beginPath(); pixCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2); pixCtx.fill(); }
  }
  // Storm: lightning flash + darkness
  if (weather.type === 'storm') {
    if (weather.lightningFlash > 0.1) overlay('#ffffff', weather.lightningFlash * 0.3);
    overlay('#0a0a20', weather.intensity * 0.15);
  }
}
