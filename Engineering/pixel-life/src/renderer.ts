import type { World, SimConfig, Pixel } from './types';
import { GENE, Terrain } from './types';
import { dnaToColor, energyToColor, lineageToColor, roleToColor, roleBrightColor } from './color-map';
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
import { getLocomotion } from './locomotion';

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
  updateCamera(camera);
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

  if (lod >= 2) renderPackLines(world);
  renderPixels(world, config, lod);
  renderEffects(pixCtx);
  renderInspectorOverlay(pixCtx, world, config);
  // Cluster labels removed — population bar at bottom + stats panel show distribution
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
        // Food color by terrain type — vivid so you can see food distribution at any zoom
        const t = world.terrain[ci];
        if (t === Terrain.GRASS) { r = Math.min(255, r + ((boost * 2.0) | 0)); g = Math.min(255, g + ((boost * 0.5) | 0)); }
        else if (t === Terrain.FOREST) { g = Math.min(255, g + ((boost * 2.0) | 0)); r = Math.min(255, r + ((boost * 0.3) | 0)); }
        else if (t === Terrain.DIRT) { b = Math.min(255, b + ((boost * 2.0) | 0)); r = Math.min(255, r + ((boost * 0.4) | 0)); }
        else if (t === Terrain.WATER) { b = Math.min(255, b + ((boost * 1.5) | 0)); g = Math.min(255, g + ((boost * 1.0) | 0)); }
        else { r = Math.min(255, r + ((boost * 0.8) | 0)); g = Math.min(255, g + ((boost * 0.8) | 0)); }
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
  // Prune dead creatures from tween map every 60 frames (O(n) via Set)
  if (frameCount % 60 === 0 && _tweenPositions.size > world.pixels.size * 1.5) {
    const alive = new Set<number>();
    for (const p of world.pixels.values()) alive.add(p.id);
    for (const [id] of _tweenPositions) { if (!alive.has(id)) _tweenPositions.delete(id); }
  }
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
      default:
        if (lod < 2) {
          // Zoomed out: fixed bright colors, NO energy dimming — always visible
          [r, g, b] = roleBrightColor(role);
        } else {
          [r, g, b] = dnaToColor(pixel.dna, pixel.energy, role);
        }
    }

    const e = pixel.energy / 100;

    if (lod >= 2) {
      // Only dim at LOD 2 (zoomed in) and only slightly
      if (pixel.age < 3) { r = Math.min(255, r + 80); g = Math.min(255, g + 80); b = Math.min(255, b + 80); }
      if (e < 0.25) { r = (r * 0.6) | 0; g = (g * 0.6) | 0; b = (b * 0.6) | 0; }
    }
    // LOD 0/1: no dimming at all — creatures always bright and visible

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
    let col = `rgb(${r},${g},${b})`;

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
      const walkFrame = ((frameCount + pixel.id * 3) >> 2) & 1;
      const sprite = getSpriteForPixel(pixel, pixel.direction, walkFrame);
      if (sprite) {
        // Smooth movement tweening: interpolate between previous and current position
        const prev = _tweenPositions.get(pixel.id);
        let drawX = pixel.x * S, drawY = pixel.y * S;
        if (prev) {
          if (prev.gx !== pixel.x || prev.gy !== pixel.y) {
            // Creature moved — check for toroidal wrap (skip tween if > 2 cells)
            const dx = Math.abs(pixel.x - prev.gx), dy = Math.abs(pixel.y - prev.gy);
            if (dx <= 2 && dy <= 2) {
              prev.t = Math.min(1, prev.t + 0.25);
              drawX = (prev.gx * S) + (pixel.x * S - prev.gx * S) * prev.t;
              drawY = (prev.gy * S) + (pixel.y * S - prev.gy * S) * prev.t;
              if (prev.t >= 1) { prev.gx = pixel.x; prev.gy = pixel.y; prev.t = 0; }
            } else {
              prev.gx = pixel.x; prev.gy = pixel.y; prev.t = 0;
            }
          }
        } else {
          _tweenPositions.set(pixel.id, { gx: pixel.x, gy: pixel.y, t: 0 });
        }

        // Subtle bob
        const bobY = Math.sin((frameCount + pixel.id * 7) * 0.15) * 0.3;
        drawY += bobY;

        // Urgent state auras: only for panic/dying (not normal behavior)
        const threat = pixel.state[0];
        const auraX = drawX + S / 2, auraY = drawY + S / 2;
        const auraR = S * 0.7;

        if (threat > 100) {
          // Fleeing — pulsing yellow danger aura
          const pulse = 0.2 + Math.sin(frameCount * 0.3) * 0.15;
          pixCtx.globalAlpha = pulse;
          pixCtx.fillStyle = '#ffcc22';
          pixCtx.beginPath(); pixCtx.arc(auraX, auraY, auraR, 0, Math.PI * 2); pixCtx.fill();
          pixCtx.globalAlpha = 1;
        } else if (pixel.energy < 20) {
          // Starving — red flicker aura
          if (Math.sin(frameCount * 0.4) > 0) {
            pixCtx.globalAlpha = 0.2;
            pixCtx.fillStyle = '#ff4444';
            pixCtx.beginPath(); pixCtx.arc(auraX, auraY, auraR * 0.6, 0, Math.PI * 2); pixCtx.fill();
            pixCtx.globalAlpha = 1;
          }
        }

        // Size reflects power: armor + energy scale the sprite (0.7x to 1.15x)
        const armorFactor = pixel.dna[GENE.ARMOR] / 255;
        const sizeMult = 0.7 + armorFactor * 0.35 + e * 0.1;
        const drawSize = S * sizeMult;
        const sizeOffset = (S - drawSize) / 2;

        // Locomotion-specific animations
        const loco = getLocomotion(pixel);
        let spriteDrawX = drawX + sizeOffset;
        let spriteDrawY = drawY + sizeOffset;

        if (loco === 'fly') {
          // Flying: hover above ground + shadow beneath
          const hoverY = Math.sin((frameCount + pixel.id * 5) * 0.2) * 1.2;
          spriteDrawY -= 1.5 + hoverY; // float above the cell

          // Shadow on ground
          pixCtx.globalAlpha = 0.2;
          pixCtx.fillStyle = '#000';
          pixCtx.beginPath();
          pixCtx.ellipse(drawX + S / 2, drawY + S - 0.5, drawSize * 0.35, drawSize * 0.15, 0, 0, Math.PI * 2);
          pixCtx.fill();
          pixCtx.globalAlpha = 1;
        } else if (loco === 'swim') {
          // Swimming: ripple rings underneath + bob horizontally
          const ripplePhase = (frameCount + pixel.id * 3) * 0.12;
          spriteDrawX += Math.sin(ripplePhase) * 0.4; // gentle horizontal sway

          // Water ripple rings
          const rippleR = 1 + ((frameCount + pixel.id * 7) % 20) * 0.15;
          pixCtx.globalAlpha = 0.25 * (1 - rippleR / 4);
          pixCtx.strokeStyle = '#66aadd';
          pixCtx.lineWidth = 0.3;
          pixCtx.beginPath();
          pixCtx.ellipse(drawX + S / 2, drawY + S * 0.7, rippleR, rippleR * 0.4, 0, 0, Math.PI * 2);
          pixCtx.stroke();
          pixCtx.globalAlpha = 1;
        }

        // Draw sprite
        if (e < 0.15) pixCtx.globalAlpha = 0.75;
        pixCtx.drawImage(sprite, spriteDrawX, spriteDrawY, drawSize, drawSize);
        pixCtx.globalAlpha = 1;

        // Status bars underneath — energy (HP) + armor bar
        const barW = S * 0.9;
        const barH = S * 0.15;
        const barX = drawX + (S - barW) / 2;
        const barGap = barH + 0.2;
        const barY1 = drawY + S + 0.4; // energy bar
        const barY2 = barY1 + barGap;  // armor bar

        // Energy bar (HP) — green/yellow/red
        pixCtx.fillStyle = 'rgba(0,0,0,0.6)';
        pixCtx.fillRect(barX - 0.2, barY1 - 0.1, barW + 0.4, barH + 0.2);
        const hpColor = e > 0.6 ? '#22dd44' : e > 0.3 ? '#ddbb22' : '#dd3322';
        pixCtx.fillStyle = hpColor;
        pixCtx.fillRect(barX, barY1, barW * Math.max(0.03, e), barH);

        // Armor bar — blue/grey, shows defense level
        const armorPct = pixel.dna[GENE.ARMOR] / 255;
        if (armorPct > 0.1) {
          pixCtx.fillStyle = 'rgba(0,0,0,0.6)';
          pixCtx.fillRect(barX - 0.2, barY2 - 0.1, barW + 0.4, barH + 0.2);
          pixCtx.fillStyle = '#4488cc';
          pixCtx.fillRect(barX, barY2, barW * armorPct, barH);
        }

        // Generation visuals — veterans show their experience
        if (pixel.generation > 50) {
          // Elite: gold border + crown dots above head
          pixCtx.strokeStyle = 'rgba(220,180,50,0.7)';
          pixCtx.lineWidth = 0.35;
          pixCtx.strokeRect(drawX + sizeOffset, drawY + sizeOffset, drawSize, drawSize);
          // Crown: 3 gold dots above sprite
          pixCtx.fillStyle = '#ddaa33';
          const crownY = spriteDrawY - 1;
          pixCtx.fillRect(drawX + S * 0.3, crownY, 0.7, 0.7);
          pixCtx.fillRect(drawX + S * 0.5 - 0.3, crownY - 0.5, 0.7, 0.7);
          pixCtx.fillRect(drawX + S * 0.7 - 0.5, crownY, 0.7, 0.7);
        } else if (pixel.generation > 20) {
          // Veteran: silver border
          pixCtx.strokeStyle = 'rgba(160,160,180,0.4)';
          pixCtx.lineWidth = 0.2;
          pixCtx.strokeRect(drawX + sizeOffset, drawY + sizeOffset, drawSize, drawSize);
        }

        // Food specialization tint — small colored dot showing dominant harvest gene
        const maxH = Math.max(pixel.dna[GENE.HARVEST_R], pixel.dna[GENE.HARVEST_G], pixel.dna[GENE.HARVEST_B]);
        if (maxH > 150 && role === 0) { // only show on plants/herbivores
          let specColor = '#888';
          if (maxH === pixel.dna[GENE.HARVEST_R]) specColor = '#ff6666'; // R specialist
          else if (maxH === pixel.dna[GENE.HARVEST_G]) specColor = '#66ff66'; // G specialist
          else specColor = '#6666ff'; // B specialist
          pixCtx.fillStyle = specColor;
          pixCtx.globalAlpha = 0.7;
          pixCtx.fillRect(drawX + S - 1.2, drawY + S - 1.2, 1, 1);
          pixCtx.globalAlpha = 1;
        }

        // Direction trail
        if (prev && (prev.gx !== pixel.x || prev.gy !== pixel.y)) {
          pixCtx.strokeStyle = `rgba(${r},${g},${b},0.2)`;
          pixCtx.lineWidth = 0.5;
          pixCtx.beginPath();
          pixCtx.moveTo(prev.gx * S + S / 2, prev.gy * S + S / 2);
          pixCtx.lineTo(drawX + S / 2, drawY + S / 2);
          pixCtx.stroke();
        }

        // Locomotion badge — small wing/fin icon for flyers/swimmers
        if (loco === 'fly') {
          // Tiny wing marks on sides
          pixCtx.strokeStyle = 'rgba(200,220,255,0.5)';
          pixCtx.lineWidth = 0.3;
          const wingX = drawX + S / 2, wingY = drawY + S * 0.3;
          pixCtx.beginPath();
          pixCtx.moveTo(wingX - S * 0.5, wingY);
          pixCtx.quadraticCurveTo(wingX - S * 0.7, wingY - S * 0.3, wingX - S * 0.3, wingY - S * 0.15);
          pixCtx.moveTo(wingX + S * 0.5, wingY);
          pixCtx.quadraticCurveTo(wingX + S * 0.7, wingY - S * 0.3, wingX + S * 0.3, wingY - S * 0.15);
          pixCtx.stroke();
        } else if (loco === 'swim') {
          // Tiny fin/tail flick
          const finPhase = Math.sin((frameCount + pixel.id * 4) * 0.25) * 0.5;
          pixCtx.strokeStyle = 'rgba(100,180,220,0.5)';
          pixCtx.lineWidth = 0.3;
          pixCtx.beginPath();
          pixCtx.moveTo(drawX + S * 0.8, drawY + S * 0.5);
          pixCtx.quadraticCurveTo(drawX + S + 0.5, drawY + S * 0.5 + finPhase, drawX + S * 0.8, drawY + S * 0.7);
          pixCtx.stroke();
        }

        // Behavior icon above the creature
        drawBehaviorIcon(pixel, role, drawX, drawY, world);
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

// Movement tweening state: tracks previous positions for smooth interpolation
const _tweenPositions = new Map<number, { gx: number; gy: number; t: number }>();

// Pack connection lines: draw lines between pack members
function renderPackLines(world: World): void {
  const packMembers = new Map<number, { x: number; y: number }[]>();
  for (const p of world.pixels.values()) {
    if (p.packId === 0) continue;
    if (!packMembers.has(p.packId)) packMembers.set(p.packId, []);
    packMembers.get(p.packId)!.push({ x: p.x * S + S / 2, y: p.y * S + S / 2 });
  }

  for (const [, members] of packMembers) {
    if (members.length < 2) continue;
    // Draw lines between all adjacent pairs (nearest neighbor connections)
    pixCtx.strokeStyle = 'rgba(255,120,60,0.2)';
    pixCtx.lineWidth = 0.4;
    pixCtx.setLineDash([1, 2]); // dashed lines for pack connections
    for (let i = 0; i < members.length; i++) {
      // Connect to nearest other member
      let bestDist = Infinity, bestJ = -1;
      for (let j = i + 1; j < members.length; j++) {
        const dx = members[i].x - members[j].x;
        const dy = members[i].y - members[j].y;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) { bestDist = dist; bestJ = j; }
      }
      if (bestJ >= 0 && bestDist < (S * 8) * (S * 8)) {
        pixCtx.beginPath();
        pixCtx.moveTo(members[i].x, members[i].y);
        pixCtx.lineTo(members[bestJ].x, members[bestJ].y);
        pixCtx.stroke();
      }
    }
    pixCtx.setLineDash([]); // reset dash
  }
}

// Behavior icons: drawn above creatures at LOD 2
// Each icon has a dark pill background so it's readable against any terrain
function drawBehaviorIcon(pixel: Pixel, role: number, cellX: number, cellY: number, world: World): void {
  const iconX = cellX + S / 2;
  const iconY = cellY - 1.8;
  const threat = pixel.state[0];
  const social = pixel.state[2];
  const senseTarget = pixel.dna[GENE.SENSE_TARGET];

  let icon = '';
  let color = '';

  // Priority order: fleeing > hunting > feeding > scavenging > socializing > parasiting > starving
  if (threat > 100) {
    icon = '!!'; color = '#ff4444';
  } else if ((role === 1 || role === 2) && senseTarget >= 85 && senseTarget < 170) {
    icon = 'hunt'; color = '#ff6644';
  } else if (role === 0 && world.food[pixel.y * W + pixel.x] > 0.15) {
    icon = 'feed'; color = '#44dd44';
  } else if (role === 3 && senseTarget >= 60 && senseTarget < 85 && world.pheromone[pixel.y * W + pixel.x] > 0.03) {
    icon = 'sniff'; color = '#aa8844';
  } else if (social > 100 && role === 5) {
    icon = 'bond'; color = '#44cccc';
  } else if (role === 4 && pixel.catalyzedUntil > 0) {
    icon = 'para'; color = '#bb66ff';
  } else if (pixel.energy < 20 && pixel.state[1] < 50) {
    icon = 'FOOD'; color = '#ffcc22';
  }

  if (!icon) return;

  // All icons drawn as canvas shapes — no font/unicode dependency
  const sz = S * 0.18;
  // Background pill
  pixCtx.fillStyle = 'rgba(0,0,0,0.6)';
  pixCtx.fillRect(iconX - sz * 3, iconY - sz * 2.5, sz * 6, sz * 3.5);

  pixCtx.fillStyle = color;
  pixCtx.strokeStyle = color;
  pixCtx.lineWidth = sz * 0.4;

  switch (icon) {
    case '!!': // Fleeing — two red lines
      pixCtx.fillRect(iconX - sz, iconY - sz * 2, sz * 0.5, sz * 2);
      pixCtx.fillRect(iconX + sz * 0.5, iconY - sz * 2, sz * 0.5, sz * 2);
      break;
    case 'hunt': // Hunting — crosshair
      pixCtx.beginPath();
      pixCtx.arc(iconX, iconY - sz * 0.5, sz * 1.2, 0, Math.PI * 2);
      pixCtx.stroke();
      pixCtx.beginPath();
      pixCtx.moveTo(iconX - sz * 2, iconY - sz * 0.5); pixCtx.lineTo(iconX + sz * 2, iconY - sz * 0.5);
      pixCtx.moveTo(iconX, iconY - sz * 2.5); pixCtx.lineTo(iconX, iconY + sz * 1.5);
      pixCtx.stroke();
      break;
    case 'feed': // Feeding — leaf shape
      pixCtx.beginPath();
      pixCtx.ellipse(iconX, iconY - sz * 0.5, sz * 1.5, sz * 0.8, Math.PI * 0.15, 0, Math.PI * 2);
      pixCtx.fill();
      break;
    case 'sniff': // Scavenging — three dots rising
      pixCtx.fillRect(iconX - sz, iconY - sz * 0.3, sz * 0.6, sz * 0.6);
      pixCtx.fillRect(iconX + sz * 0.2, iconY - sz * 1.2, sz * 0.6, sz * 0.6);
      pixCtx.fillRect(iconX - sz * 0.3, iconY - sz * 2, sz * 0.6, sz * 0.6);
      break;
    case 'bond': // Bonding — two dots close
      pixCtx.beginPath();
      pixCtx.arc(iconX - sz * 0.6, iconY - sz * 0.5, sz * 0.6, 0, Math.PI * 2);
      pixCtx.arc(iconX + sz * 0.6, iconY - sz * 0.5, sz * 0.6, 0, Math.PI * 2);
      pixCtx.fill();
      break;
    case 'para': // Parasite — circle with dot
      pixCtx.beginPath();
      pixCtx.arc(iconX, iconY - sz * 0.5, sz * 1.2, 0, Math.PI * 2);
      pixCtx.stroke();
      pixCtx.beginPath();
      pixCtx.arc(iconX, iconY - sz * 0.5, sz * 0.4, 0, Math.PI * 2);
      pixCtx.fill();
      break;
    case 'FOOD': // Hungry — drumstick
      pixCtx.fillStyle = '#cc8844';
      pixCtx.beginPath();
      pixCtx.arc(iconX - sz, iconY - sz * 0.3, sz * 1.1, 0, Math.PI * 2);
      pixCtx.fill();
      pixCtx.strokeStyle = '#eedd99';
      pixCtx.lineWidth = sz * 0.5;
      pixCtx.beginPath();
      pixCtx.moveTo(iconX - sz * 0.2, iconY - sz * 0.3);
      pixCtx.lineTo(iconX + sz * 1.8, iconY - sz * 0.3);
      pixCtx.stroke();
      break;
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
