import type { World, SimConfig, Pixel } from './types';
import { GENE, Terrain } from './types';
import { dnaToColor, energyToColor, lineageToColor, roleToColor } from './color-map';
import { getCreatureRole } from './metabolism';
import { terrainColorInContext } from './terrain';
import { SUBSTRATE_RENDER_INTERVAL } from './constants';
import type { Weather } from './weather';
import { renderEffects } from './effects';
import { renderCanvasHud } from './canvas-hud';
import {
  createCamera, updateCamera, applyTransform, resetTransform,
  getVisibleCells, getLOD, zoomAt, pan, clampCamera, resetCamera,
  type Camera,
} from './camera';
import { initTerrainTiles, renderTerrainTile, renderTerrainOverlays, renderEdgeDithering } from './terrain-tiles';
import { initSprites, getSpriteForPixel } from './sprites';
import { renderMinimap, handleMinimapClick, toggleMinimap, resetMinimapCache } from './minimap';
import { centerOn } from './camera';
import { renderInspectorOverlay, getTrackedPixel, isFollowing } from './creature-inspector';
import { renderEcosystemGraph, toggleEcosystemGraph } from './ecosystem-graph';
import { renderSpeciesTree, toggleSpeciesTree } from './species-tree';
import { renderArmsRaceNotifications } from './arms-race';
import { getTerritoryColor } from './territory-system';

let subCanvas: HTMLCanvasElement;
let pixCanvas: HTMLCanvasElement;
let subCtx: CanvasRenderingContext2D;
let pixCtx: CanvasRenderingContext2D;
let frameCount = 0;
let S = 5, W = 200, H = 150;

// Camera state
let camera: Camera;
let _lastWorld: World | null = null;

// Drag state for pan
let isDragging = false;
let lastMouseX = 0;
let lastMouseY = 0;

// Substrate rendering: offscreen buffer holds the raw (untransformed) terrain ImageData
let _rawSubstrate: HTMLCanvasElement | null = null;
let _rawSubstrateCtx: CanvasRenderingContext2D | null = null;
let _subImageData: ImageData | null = null;
let _terrainDirty = true;

// Prevent event listener stacking on reset
let _inputsInitialized = false;

export function getCamera(): Camera { return camera; }

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

  // Create offscreen buffer for raw (untransformed) substrate
  if (!_rawSubstrate || _rawSubstrate.width !== dw || _rawSubstrate.height !== dh) {
    _rawSubstrate = document.createElement('canvas');
    _rawSubstrate.width = dw;
    _rawSubstrate.height = dh;
    _rawSubstrateCtx = _rawSubstrate.getContext('2d', { alpha: false })!;
  }
  _subImageData = _rawSubstrateCtx!.createImageData(dw, dh);
  _terrainDirty = true;
  frameCount = 0;

  camera = createCamera();
  initTerrainTiles();
  initSprites();
  resetMinimapCache();
  if (!_inputsInitialized) {
    initCameraInputs();
    _inputsInitialized = true;
  }
}

export function renderFrame(world: World, config: SimConfig): void {
  frameCount++;
  _lastWorld = world;
  updateCamera(camera, pixCanvas.width, pixCanvas.height);
  clampCamera(camera, W * S, H * S, pixCanvas.width, pixCanvas.height);

  const lod = getLOD(camera);

  // -- Substrate layer --
  if (frameCount % SUBSTRATE_RENDER_INTERVAL === 0 || frameCount === 1) {
    _terrainDirty = true;
  }
  renderSubstrateFrame(world, config, lod);

  // -- Pixel layer (always re-rendered) --
  pixCtx.save();
  resetTransform(pixCtx);
  pixCtx.clearRect(0, 0, pixCanvas.width, pixCanvas.height);
  applyTransform(pixCtx, camera);
  pixCtx.imageSmoothingEnabled = false;

  renderPixels(world, config, lod);
  renderEffects(pixCtx);
  renderInspectorOverlay(pixCtx, world, config);
  renderWeatherWorld(world.weather as Weather);

  // Follow mode: camera tracks the inspected creature
  if (isFollowing()) {
    const tracked = getTrackedPixel(world);
    if (tracked) {
      centerOn(camera, tracked.x * S + S / 2, tracked.y * S + S / 2, pixCanvas.width, pixCanvas.height);
    }
  }

  // Screen-space rendering (HUD, weather overlays, minimap)
  resetTransform(pixCtx);
  renderWeatherOverlays(world.weather as Weather);
  renderCanvasHud(pixCtx, world, config);
  renderEcosystemGraph(pixCtx, pixCanvas.width, pixCanvas.height);
  renderSpeciesTree(pixCtx, pixCanvas.width, pixCanvas.height);
  renderArmsRaceNotifications(pixCtx, pixCanvas.width);
  renderMinimap(pixCtx, world, camera, pixCanvas.width, pixCanvas.height, S);
  pixCtx.restore();
}

function renderSubstrateFrame(world: World, config: SimConfig, lod: number): void {
  const dw = W * S, dh = H * S;

  if (lod >= 2) {
    // LOD 2: tile-based terrain drawn directly with camera transform onto subCanvas
    subCtx.save();
    resetTransform(subCtx);
    subCtx.clearRect(0, 0, dw, dh);
    applyTransform(subCtx, camera);
    subCtx.imageSmoothingEnabled = false;

    const bounds = getVisibleCells(camera, W, H, S, dw, dh);
    for (let wy = bounds.y0; wy <= bounds.y1; wy++) {
      for (let wx = bounds.x0; wx <= bounds.x1; wx++) {
        const ci = wy * W + wx;
        renderTerrainTile(subCtx, world.terrain[ci], wx * S, wy * S, S, frameCount);
        renderEdgeDithering(subCtx, world, wx, wy, S);
        renderTerrainOverlays(subCtx, world, wx, wy, S);
      }
    }
    subCtx.restore();
    _terrainDirty = true; // force ImageData regen when zooming back to LOD 0/1
    return;
  }

  // LOD 0/1: ImageData fast path
  // Regenerate raw terrain ImageData into the offscreen buffer when dirty
  if (_terrainDirty) {
    renderTerrainImageData(world, config);
    _terrainDirty = false;
  }

  // Always draw: clear subCanvas, apply camera transform, draw raw buffer
  subCtx.save();
  resetTransform(subCtx);
  subCtx.clearRect(0, 0, dw, dh);
  applyTransform(subCtx, camera);
  subCtx.imageSmoothingEnabled = false;
  subCtx.drawImage(_rawSubstrate!, 0, 0);
  subCtx.restore();
}

// Renders terrain into the offscreen _rawSubstrate buffer (no camera transform)
function renderTerrainImageData(world: World, config: SimConfig): void {
  const data = _subImageData!.data;
  const dw = W * S;
  const fullFood = config.viewMode === 'substrate';

  for (let wy = 0; wy < H; wy++) {
    for (let wx = 0; wx < W; wx++) {
      const ci = wy * W + wx;
      const wType = world.weather?.type ?? 'clear';
      let [r, g, b] = terrainColorInContext(world.terrain[ci], wx, wy, wType, world.season, world.wear[ci], world.corpses[ci]);

      const food = world.food[ci];
      if (food > 0.02) {
        const scale = fullFood ? 40 : 25;
        const boost = Math.min(1, food) * scale;
        r = Math.min(255, r + ((boost * 0.2) | 0));
        g = Math.min(255, g + ((boost * 1.4) | 0));
        b = Math.min(255, b + ((boost * 0.1) | 0));
      }
      if (!fullFood && world.terrain[ci] >= Terrain.GRASS && food < 0.1) {
        const deplete = (0.1 - food) / 0.1;
        r = Math.min(255, r + ((deplete * 18) | 0));
        g = Math.max(0, g - ((deplete * 10) | 0));
        b = Math.max(0, b - ((deplete * 4) | 0));
      }

      const ph = world.pheromone[ci];
      if (ph > 0.015) {
        const pi2 = Math.min(1, ph * 2);
        r = Math.min(255, r + ((pi2 * 20) | 0));
        g = Math.min(255, g + ((pi2 * 12) | 0));
        b = Math.min(255, b + ((pi2 * 4) | 0));
      }

      // Territory view mode: tint cells with territory owner color
      if (config.viewMode === 'territory') {
        const tc = getTerritoryColor(world, ci);
        if (tc) {
          const [tr, tg, tb, ta] = tc;
          r = Math.floor(r * (1 - ta) + tr * ta);
          g = Math.floor(g * (1 - ta) + tg * ta);
          b = Math.floor(b * (1 - ta) + tb * ta);
        }
      }

      for (let dy = 0; dy < S; dy++) {
        const rowStart = ((wy * S + dy) * dw + wx * S) * 4;
        for (let dx = 0; dx < S; dx++) {
          const pi = rowStart + dx * 4;
          data[pi] = r; data[pi + 1] = g; data[pi + 2] = b; data[pi + 3] = 255;
        }
      }
    }
  }
  // Write to the offscreen raw buffer (not to subCanvas directly)
  _rawSubstrateCtx!.putImageData(_subImageData!, 0, 0);
}

function renderPixels(world: World, config: SimConfig, lod: number): void {
  const bounds = getVisibleCells(camera, W, H, S, pixCanvas.width, pixCanvas.height);

  for (const pixel of world.pixels.values()) {
    if (pixel.x < bounds.x0 || pixel.x > bounds.x1 || pixel.y < bounds.y0 || pixel.y > bounds.y1) continue;

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

    if (config.viewMode === 'normal') {
      const t = world.terrain[pixel.y * W + pixel.x];
      const fit = getTerrainFitness(role, t);
      if (fit > 0) {
        const boost = fit * 25;
        r = Math.min(255, r + boost); g = Math.min(255, g + boost); b = Math.min(255, b + boost);
      }
    }

    const cx = pixel.x * S + S / 2;
    const cy = pixel.y * S + S / 2;
    const col = `rgb(${r},${g},${b})`;

    if (config.viewMode === 'normal') {
      const cellFood = world.food[pixel.y * W + pixel.x];
      if (cellFood > 0.1 && role === 0) {
        pixCtx.globalAlpha = 0.2 + cellFood * 0.15;
        pixCtx.fillStyle = '#22cc44';
        pixCtx.beginPath();
        pixCtx.arc(cx, cy, 4, 0, Math.PI * 2);
        pixCtx.fill();
        pixCtx.globalAlpha = 1;
      }
      if (pixel.state[0] > 50 && (role === 1 || role === 2)) {
        pixCtx.globalAlpha = 0.15;
        pixCtx.fillStyle = '#ff4444';
        pixCtx.beginPath();
        pixCtx.arc(cx, cy, 4, 0, Math.PI * 2);
        pixCtx.fill();
        pixCtx.globalAlpha = 1;
      }
    }

    if (lod >= 2) {
      // Animate walk frame based on creature's own phase (id-offset avoids sync)
      const walkFrame = ((frameCount + pixel.id * 3) >> 2) & 1;
      const sprite = getSpriteForPixel(pixel, pixel.direction, walkFrame);
      if (sprite) {
        if (e < 0.25) pixCtx.globalAlpha = 0.4;
        else if (e < 0.5) pixCtx.globalAlpha = 0.7;

        // Subtle bob animation: creatures bounce slightly based on their phase
        const bobPhase = Math.sin((frameCount + pixel.id * 7) * 0.15);
        const bobY = bobPhase * 0.3; // subtle vertical bob in world units

        pixCtx.drawImage(sprite, pixel.x * S, pixel.y * S + bobY, S, S);
        pixCtx.globalAlpha = 1;

        // Generation ring
        if (pixel.generation > 10) {
          pixCtx.strokeStyle = pixel.generation > 50 ? 'rgba(204,170,68,0.6)' : 'rgba(136,136,102,0.3)';
          pixCtx.lineWidth = pixel.generation > 50 ? 0.3 : 0.15;
          pixCtx.strokeRect(pixel.x * S, pixel.y * S + bobY, S, S);
        }

        // Behavior state indicator — small icon above the creature
        drawBehaviorIndicator(pixel, role, pixel.x * S, pixel.y * S + bobY, world);
      } else {
        pixCtx.fillStyle = col;
        pixCtx.fillRect(pixel.x * S + 0.5, pixel.y * S + 0.5, S - 1, S - 1);
      }
    } else {
      drawCreature(pixel, cx, cy, e, role, col, r, g, b);
    }
  }
}

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

  const harvestAvg = (pixel.dna[0] + pixel.dna[1] + pixel.dna[2]) / 3;
  const bodyMass = (pixel.dna[GENE.ARMOR] * 0.4 + harvestAvg * 0.3 + (255 - pixel.dna[GENE.SPEED]) * 0.3) / 255;
  const baseRadius = 1.2 + bodyMass * 2.8;
  const radius = baseRadius * (0.4 + e * 0.6);

  const glowAlpha = e > 0.6 ? 0.08 + e * 0.05 : 0;
  if (glowAlpha > 0) {
    pixCtx.globalAlpha = glowAlpha;
    pixCtx.fillStyle = col;
    pixCtx.beginPath();
    pixCtx.arc(cx, cy, radius + 2, 0, Math.PI * 2);
    pixCtx.fill();
    pixCtx.globalAlpha = 1;
  }

  pixCtx.fillStyle = col;
  switch (role) {
    case 0: pixCtx.beginPath(); pixCtx.arc(cx, cy, radius, 0, Math.PI * 2); pixCtx.fill(); break;
    case 1: drawTriangle(cx, cy, radius, pixel.dna[GENE.SPEED]); break;
    case 2:
      drawDiamond(cx, cy, radius + 0.5);
      pixCtx.fillStyle = '#ff3333';
      pixCtx.fillRect(cx - 0.5, cy - 0.5, 1.5, 1.5);
      break;
    case 3: drawCross(cx, cy, radius); break;
    case 4: drawStar(cx, cy, radius); break;
    case 5:
      drawHexagon(cx, cy, radius);
      pixCtx.strokeStyle = `rgba(${r},${g},${b},0.3)`;
      pixCtx.lineWidth = 0.5;
      pixCtx.beginPath();
      pixCtx.arc(cx, cy, radius + 1.5, 0, Math.PI * 2);
      pixCtx.stroke();
      break;
    case 6: drawArrow(cx, cy, radius); break;
  }

  if (pixel.generation > 10) {
    const lw = pixel.generation > 50 ? 1.0 : 0.5;
    const ringOffset = role === 5 ? 3.5 : 1.5;
    pixCtx.strokeStyle = `rgba(${r},${g},${b},${pixel.generation > 50 ? 0.6 : 0.3})`;
    pixCtx.lineWidth = lw;
    pixCtx.beginPath();
    pixCtx.arc(cx, cy, radius + ringOffset, 0, Math.PI * 2);
    pixCtx.stroke();
  }

  if (radius > 2) {
    const spd = pixel.dna[GENE.SPEED];
    const arm = pixel.dna[GENE.ARMOR];
    const hrv = (pixel.dna[0] + pixel.dna[1] + pixel.dna[2]) / 3;
    const sns = pixel.dna[GENE.SENSE_RANGE];
    const max = Math.max(spd, arm, hrv, sns);
    let pipCol: string;
    if (max === spd) pipCol = '#44aaff';
    else if (max === arm) pipCol = '#ffaa44';
    else if (max === hrv) pipCol = '#44ff88';
    else pipCol = '#ff44aa';
    pixCtx.fillStyle = pipCol;
    pixCtx.fillRect(cx + radius - 0.5, cy - radius - 0.5, 1.5, 1.5);
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

function getTerrainFitness(role: number, t: Terrain): number {
  if (role === 0) return t === Terrain.GRASS ? 1 : t === Terrain.FOREST ? 0.7 : 0;
  if (role === 1 || role === 2) return t === Terrain.FOREST ? 0.8 : 0;
  if (role === 3) return t === Terrain.DIRT ? 0.6 : 0;
  if (role === 6) return t === Terrain.SAND ? 0.5 : t === Terrain.ROCK ? 0.4 : 0;
  return 0;
}

// Behavior state indicators shown above sprites at LOD 2
// Shows what the creature is currently doing via small colored symbols
function drawBehaviorIndicator(pixel: Pixel, role: number, cellX: number, cellY: number, world: World): void {
  const ix = cellX + S / 2;  // center X of cell
  const iy = cellY - 1.2;    // just above sprite

  const threat = pixel.state[0];
  const satiety = pixel.state[1];
  const social = pixel.state[2];
  const senseTarget = pixel.dna[GENE.SENSE_TARGET];

  // Fleeing — red exclamation (high threat state)
  if (threat > 100) {
    const pulse = 0.5 + Math.sin(frameCount * 0.3) * 0.3;
    pixCtx.globalAlpha = pulse;
    pixCtx.fillStyle = '#ff4444';
    // Exclamation mark: dot + line
    pixCtx.fillRect(ix - 0.2, iy - 2.5, 0.5, 1.5);
    pixCtx.fillRect(ix - 0.15, iy - 0.5, 0.4, 0.4);
    pixCtx.globalAlpha = 1;
    return;
  }

  // Hunting — red crosshair (predators seeking prey)
  if ((role === 1 || role === 2) && senseTarget >= 85 && senseTarget < 170) {
    pixCtx.globalAlpha = 0.6;
    pixCtx.strokeStyle = '#ff6644';
    pixCtx.lineWidth = 0.3;
    pixCtx.beginPath();
    pixCtx.moveTo(ix - 1.5, iy - 1); pixCtx.lineTo(ix + 1.5, iy - 1);
    pixCtx.moveTo(ix, iy - 2.5); pixCtx.lineTo(ix, iy + 0.5);
    pixCtx.stroke();
    // Small circle
    pixCtx.beginPath();
    pixCtx.arc(ix, iy - 1, 1, 0, Math.PI * 2);
    pixCtx.stroke();
    pixCtx.globalAlpha = 1;
    return;
  }

  // Grazing/feeding — green leaf (plant harvesting food)
  const cellFood = world.food[pixel.y * W + pixel.x];
  if (role === 0 && cellFood > 0.15) {
    pixCtx.globalAlpha = 0.7;
    pixCtx.fillStyle = '#44dd44';
    // Tiny leaf shape
    pixCtx.beginPath();
    pixCtx.ellipse(ix, iy - 1, 1, 0.6, Math.PI * 0.15, 0, Math.PI * 2);
    pixCtx.fill();
    pixCtx.globalAlpha = 1;
    return;
  }

  // Scavenging — brown nose to ground (scavengers on corpse trail)
  if (role === 3 && (senseTarget >= 60 && senseTarget < 85)) {
    const ph = world.pheromone[pixel.y * W + pixel.x];
    if (ph > 0.03) {
      pixCtx.globalAlpha = 0.5;
      pixCtx.fillStyle = '#aa8844';
      // Small sniff dots
      pixCtx.fillRect(ix - 0.8, iy - 0.8, 0.5, 0.5);
      pixCtx.fillRect(ix + 0.3, iy - 1.2, 0.5, 0.5);
      pixCtx.fillRect(ix - 0.2, iy - 1.8, 0.5, 0.5);
      pixCtx.globalAlpha = 1;
      return;
    }
  }

  // Socializing — blue heart/cluster (high social state, swarm bonding)
  if (social > 100 && role === 5) {
    pixCtx.globalAlpha = 0.5;
    pixCtx.fillStyle = '#44cccc';
    pixCtx.beginPath();
    pixCtx.arc(ix - 0.5, iy - 1.5, 0.5, 0, Math.PI * 2);
    pixCtx.arc(ix + 0.5, iy - 1.5, 0.5, 0, Math.PI * 2);
    pixCtx.fill();
    pixCtx.globalAlpha = 1;
    return;
  }

  // Hungry — yellow low-energy warning (any role, low energy)
  if (pixel.energy < 20 && satiety < 50) {
    const blink = Math.sin(frameCount * 0.4) > 0;
    if (blink) {
      pixCtx.globalAlpha = 0.6;
      pixCtx.fillStyle = '#ffcc22';
      // Small triangle (warning)
      pixCtx.beginPath();
      pixCtx.moveTo(ix, iy - 2.5);
      pixCtx.lineTo(ix - 1, iy - 0.5);
      pixCtx.lineTo(ix + 1, iy - 0.5);
      pixCtx.closePath();
      pixCtx.fill();
      pixCtx.globalAlpha = 1;
    }
    return;
  }

  // Parasitizing — purple link (parasite near host)
  if (role === 4 && pixel.catalyzedUntil > 0) {
    pixCtx.globalAlpha = 0.5;
    pixCtx.fillStyle = '#bb66ff';
    pixCtx.beginPath();
    pixCtx.arc(ix, iy - 1.2, 0.8, 0, Math.PI * 2);
    pixCtx.fill();
    pixCtx.globalAlpha = 1;
  }
}

function renderWeatherWorld(weather: Weather): void {
  if (weather.type === 'clear') return;
  if (weather.type === 'rain' || weather.type === 'storm') {
    pixCtx.strokeStyle = weather.type === 'storm' ? 'rgba(150,180,255,0.3)' : 'rgba(100,140,200,0.2)';
    pixCtx.lineWidth = 0.5; pixCtx.beginPath();
    for (const p of weather.particles) { pixCtx.moveTo(p.x, p.y); pixCtx.lineTo(p.x - p.speed * 1.5, p.y + p.speed * 5); }
    pixCtx.stroke();
  }
  if (weather.type === 'snow') {
    pixCtx.fillStyle = 'rgba(220,230,255,0.5)';
    for (const p of weather.particles) { pixCtx.beginPath(); pixCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2); pixCtx.fill(); }
  }
}

function renderWeatherOverlays(weather: Weather): void {
  if (weather.type === 'clear') return;
  const dw = pixCanvas.width, dh = pixCanvas.height;
  const overlay = (color: string, alpha: number) => {
    pixCtx.globalAlpha = alpha; pixCtx.fillStyle = color;
    pixCtx.fillRect(0, 0, dw, dh); pixCtx.globalAlpha = 1;
  };
  if (weather.type === 'fog') overlay('#8899aa', weather.intensity * 0.25);
  if (weather.type === 'drought') overlay('#cc8844', weather.intensity * 0.08);
  if (weather.type === 'heatwave') overlay('#ff6622', weather.intensity * 0.1);
  if (weather.type === 'storm') {
    if (weather.lightningFlash > 0.1) overlay('#ffffff', weather.lightningFlash * 0.3);
    overlay('#0a0a20', weather.intensity * 0.15);
  }
}

// -- Camera input handlers (registered once) --
function initCameraInputs(): void {
  pixCanvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomAt(camera, e.offsetX, e.offsetY, e.deltaY);
  }, { passive: false });

  // Shift+click or middle-click = pan
  pixCanvas.addEventListener('mousedown', (e) => {
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      isDragging = true;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      e.preventDefault();
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    pan(camera, e.clientX - lastMouseX, e.clientY - lastMouseY);
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  });

  window.addEventListener('mouseup', () => { isDragging = false; });

  // Minimap click-to-jump
  pixCanvas.addEventListener('click', (e) => {
    if (!_lastWorld) return;
    const rect = pixCanvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) / rect.width * pixCanvas.width;
    const sy = (e.clientY - rect.top) / rect.height * pixCanvas.height;
    const worldPos = handleMinimapClick(sx, sy, pixCanvas.width, pixCanvas.height, _lastWorld, S);
    if (worldPos) {
      centerOn(camera, worldPos[0], worldPos[1], pixCanvas.width, pixCanvas.height);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Home') { resetCamera(camera); e.preventDefault(); }
    if (e.key === 'm' || e.key === 'M') { toggleMinimap(); e.preventDefault(); }
    if (e.key === 'e' || e.key === 'E') { toggleEcosystemGraph(); e.preventDefault(); }
    if (e.key === 't' || e.key === 'T') { toggleSpeciesTree(); e.preventDefault(); }
    if (e.key === '+' || e.key === '=') {
      camera.targetZoom = Math.min(6, camera.targetZoom * 1.3);
      e.preventDefault();
    }
    if (e.key === '-') {
      camera.targetZoom = Math.max(1, camera.targetZoom / 1.3);
      e.preventDefault();
    }
  });
}

// Export for ui-controls coordinate conversion
export { screenToWorld } from './camera';
