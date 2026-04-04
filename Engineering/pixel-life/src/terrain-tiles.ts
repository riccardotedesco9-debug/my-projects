// Procedural 16×16 terrain tiles for LOD 2 rendering
// Each terrain type gets a textured tile with deterministic pseudo-random patterns

import { Terrain } from './types';
import type { World } from './types';
import { TERRAIN_TILE_SIZE, WATER_ANIM_INTERVAL } from './constants';

const T = TERRAIN_TILE_SIZE;

// Base terrain colors [r, g, b]
const TERRAIN_COLORS: Record<number, [number, number, number]> = {
  [Terrain.WATER]:  [10, 26, 48],
  [Terrain.SAND]:   [74, 58, 26],
  [Terrain.DIRT]:   [58, 42, 16],
  [Terrain.GRASS]:  [42, 90, 18],
  [Terrain.FOREST]: [26, 58, 10],
  [Terrain.ROCK]:   [42, 42, 46],
};

// Tile caches
let tileCache: OffscreenCanvas[] = [];
let waterFrames: OffscreenCanvas[] = [];
let initialized = false;

// Simple deterministic hash for pixel variation
function hash(x: number, y: number, seed: number): number {
  return ((x * 7 + y * 13 + seed * 31) * 2654435761) >>> 0;
}

function hashNorm(x: number, y: number, seed: number): number {
  return (hash(x, y, seed) & 0xff) / 255;
}

export function initTerrainTiles(): void {
  tileCache = [];
  for (let t = 0; t <= 5; t++) {
    if (t === Terrain.WATER) {
      // Water gets 2 animation frames
      waterFrames = [generateWaterTile(0), generateWaterTile(1)];
      tileCache.push(waterFrames[0]);
    } else {
      tileCache.push(generateTile(t));
    }
  }
  initialized = true;
}

function generateTile(type: number): OffscreenCanvas {
  const canvas = new OffscreenCanvas(T, T);
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(T, T);
  const d = img.data;

  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const [r, g, b] = getTerrainPixel(type, x, y);
      const i = (y * T + x) * 4;
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function generateWaterTile(frame: number): OffscreenCanvas {
  const canvas = new OffscreenCanvas(T, T);
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(T, T);
  const d = img.data;
  const [br, bg, bb] = TERRAIN_COLORS[Terrain.WATER];

  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      let r = br, g = bg, b = bb;
      // Horizontal wave pattern
      const waveY = (y + frame * 2) % 4;
      if (waveY === 0) {
        r += 8; g += 12; b += 25; // wave crest
      } else if (waveY === 2) {
        r += 3; g += 6; b += 14; // secondary shimmer
      }
      // Subtle sparkle
      if (hashNorm(x, y, frame * 17) > 0.92) {
        r += 15; g += 20; b += 35;
      }
      const i = (y * T + x) * 4;
      d[i] = Math.min(255, r); d[i + 1] = Math.min(255, g); d[i + 2] = Math.min(255, b); d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function getTerrainPixel(type: number, x: number, y: number): [number, number, number] {
  const [br, bg, bb] = TERRAIN_COLORS[type] ?? [40, 40, 40];
  let r = br, g = bg, b = bb;
  const h = hashNorm(x, y, type);

  switch (type) {
    case Terrain.SAND: {
      // Scattered grain dots
      if (h > 0.85) { r += 12; g += 10; b += 4; }
      if (h < 0.15) { r -= 6; g -= 5; b -= 2; }
      // Subtle horizontal streaks
      if (y % 5 === 0 && h > 0.5) { r += 5; g += 4; b += 2; }
      break;
    }
    case Terrain.DIRT: {
      // Pebble clusters
      if (h > 0.82) { r += 15; g += 10; b += 5; } // light pebble
      if (h < 0.12) { r -= 10; g -= 8; b -= 3; }  // dark spot
      // Occasional larger pebble (2px feel via adjacency)
      if (hashNorm(x, y, type + 7) > 0.93) { r += 8; g += 6; b += 3; }
      break;
    }
    case Terrain.GRASS: {
      // Vertical grass blades at varying heights
      if (x % 3 === 0) {
        const bladeH = Math.floor(hashNorm(x, 0, type) * 10) + 4;
        if (y < bladeH) {
          g += 18 + Math.floor(h * 12); // grass tip = lighter
          if (y < 3) { g += 10; r += 4; } // very tip = brightest
        }
      }
      // Base variation
      if (h > 0.7) { g += 8; }
      if (h < 0.2) { g -= 5; r -= 2; }
      break;
    }
    case Terrain.FOREST: {
      // Dense leaf canopy clusters
      const leafCluster = hashNorm(x >> 1, y >> 1, type);
      if (leafCluster > 0.6) {
        g += 12 + Math.floor(h * 10); // leaf cluster
        if (h > 0.85) { r += 3; g += 5; } // highlight leaf
      } else {
        r -= 4; g -= 6; b -= 2; // shadow between canopy
      }
      // Occasional trunk pixel
      if (h > 0.96) { r = 50; g = 35; b = 15; }
      break;
    }
    case Terrain.ROCK: {
      // Crack lines (diagonal)
      const onCrack = Math.abs((x + y) % 7) < 1 && h > 0.4;
      if (onCrack) { r -= 12; g -= 12; b -= 10; }
      // Vein patterns
      if (hashNorm(x, y, type + 11) > 0.88) { r += 10; g += 10; b += 12; }
      // General noise
      const noise = Math.floor(h * 12) - 6;
      r += noise; g += noise; b += noise;
      break;
    }
  }

  return [Math.max(0, Math.min(255, r)), Math.max(0, Math.min(255, g)), Math.max(0, Math.min(255, b))];
}

// Render a terrain tile at world position with camera transform active
export function renderTerrainTile(
  ctx: CanvasRenderingContext2D, terrainType: number,
  worldX: number, worldY: number, cellSize: number, frameCount: number,
): void {
  if (!initialized) return;

  let tile: OffscreenCanvas;
  if (terrainType === Terrain.WATER) {
    const frame = Math.floor(frameCount / WATER_ANIM_INTERVAL) & 1;
    tile = waterFrames[frame];
  } else {
    tile = tileCache[terrainType];
  }
  if (!tile) return;

  ctx.drawImage(tile, 0, 0, T, T, worldX, worldY, cellSize, cellSize);
}

// Render dynamic overlays on top of base tile
export function renderTerrainOverlays(
  ctx: CanvasRenderingContext2D, world: World,
  cellX: number, cellY: number, cellSize: number,
): void {
  const ci = cellY * world.width + cellX;
  const wx = cellX * cellSize;
  const wy = cellY * cellSize;

  // Food abundance: bright green dots
  const food = world.food[ci];
  if (food > 0.05) {
    const dots = Math.min(5, Math.floor(food * 6));
    ctx.fillStyle = '#44cc44';
    for (let i = 0; i < dots; i++) {
      const dx = (hash(cellX, cellY, i * 3) % (cellSize - 2)) + 1;
      const dy = (hash(cellX, cellY, i * 3 + 1) % (cellSize - 2)) + 1;
      ctx.fillRect(wx + dx, wy + dy, 1, 1);
    }
  }

  // Depletion tint on fertile terrain
  if (world.terrain[ci] >= Terrain.GRASS && food < 0.1) {
    const deplete = (0.1 - food) / 0.1;
    ctx.globalAlpha = deplete * 0.3;
    ctx.fillStyle = '#6a4a20';
    ctx.fillRect(wx, wy, cellSize, cellSize);
    ctx.globalAlpha = 1;
  }

  // Pheromone trails: amber glow
  const ph = world.pheromone[ci];
  if (ph > 0.02) {
    const dots = Math.min(3, Math.floor(ph * 5));
    ctx.fillStyle = '#cc9944';
    ctx.globalAlpha = Math.min(0.6, ph);
    for (let i = 0; i < dots; i++) {
      const dx = (hash(cellX, cellY, i * 5 + 50) % (cellSize - 2)) + 1;
      const dy = (hash(cellX, cellY, i * 5 + 51) % (cellSize - 2)) + 1;
      ctx.fillRect(wx + dx, wy + dy, 1, 1);
    }
    ctx.globalAlpha = 1;
  }

  // Wear: lighten center
  const wear = world.wear[ci];
  if (wear > 30) {
    ctx.globalAlpha = (wear / 255) * 0.25;
    ctx.fillStyle = '#ccaa88';
    const inset = Math.floor(cellSize * 0.2);
    ctx.fillRect(wx + inset, wy + inset, cellSize - inset * 2, cellSize - inset * 2);
    ctx.globalAlpha = 1;
  }

  // Corpse stain: dark red
  if (world.corpses[ci] > 0) {
    ctx.globalAlpha = Math.min(0.4, world.corpses[ci] / 60);
    ctx.fillStyle = '#662222';
    ctx.fillRect(wx, wy, cellSize, cellSize);
    ctx.globalAlpha = 1;
  }
}

// Edge dithering between different terrain types
export function renderEdgeDithering(
  ctx: CanvasRenderingContext2D, world: World,
  cellX: number, cellY: number, cellSize: number,
): void {
  const ci = cellY * world.width + cellX;
  const myType = world.terrain[ci];
  const w = world.width, h = world.height;

  // Check 4 cardinal neighbors
  const neighbors: [number, number, number, number][] = [ // [nx, ny, edgeAxis, edgeSide]
    [cellX, cellY - 1, 0, 0], // top
    [cellX, cellY + 1, 0, 1], // bottom
    [cellX - 1, cellY, 1, 0], // left
    [cellX + 1, cellY, 1, 1], // right
  ];

  for (const [nx, ny, axis, side] of neighbors) {
    if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
    const neighborType = world.terrain[ny * w + nx];
    if (neighborType === myType) continue;

    const [nr, ng, nb] = TERRAIN_COLORS[neighborType] ?? [40, 40, 40];
    ctx.fillStyle = `rgb(${nr},${ng},${nb})`;
    ctx.globalAlpha = 0.4;

    const wx = cellX * cellSize;
    const wy = cellY * cellSize;

    // 2px dithered edge: checkerboard pattern
    for (let i = 0; i < cellSize; i++) {
      if ((i & 1) === 0) continue; // checkerboard: every other pixel
      if (axis === 0) {
        // Horizontal edge (top/bottom)
        const edgeY = side === 0 ? wy : wy + cellSize - 1;
        ctx.fillRect(wx + i, edgeY, 1, 1);
      } else {
        // Vertical edge (left/right)
        const edgeX = side === 0 ? wx : wx + cellSize - 1;
        ctx.fillRect(edgeX, wy + i, 1, 1);
      }
    }
    ctx.globalAlpha = 1;
  }
}

// Export base terrain colors for minimap use
export function getTerrainBaseColor(type: number): [number, number, number] {
  return TERRAIN_COLORS[type] ?? [40, 40, 40];
}
