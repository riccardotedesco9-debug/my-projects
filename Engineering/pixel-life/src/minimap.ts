// Minimap: small world overview in bottom-right corner when zoomed in
// Shows terrain, creature dots, and viewport rectangle

import type { World } from './types';
import type { Camera } from './camera';
import { getCreatureRole } from './metabolism';
import { getTerrainBaseColor } from './terrain-tiles';

const MM_W = 160;
const MM_H = 120;
const MARGIN = 10;
const BOTTOM_OFFSET = 22; // above population bar

const ROLE_COLORS = ['#44cc44', '#cc8844', '#cc3333', '#aa8866', '#aa44cc', '#44cccc', '#cccc44'];

let visible = true;
let terrainCache: ImageData | null = null;
let lastTerrainHash = 0;

export function toggleMinimap(): void { visible = !visible; }

export function renderMinimap(
  ctx: CanvasRenderingContext2D, world: World, cam: Camera,
  canvasW: number, canvasH: number, cellSize: number,
): void {
  if (!visible || cam.zoom <= 1.2) return;

  const mmX = Math.floor(canvasW - MM_W - MARGIN);
  const mmY = Math.floor(canvasH - MM_H - BOTTOM_OFFSET);
  const sx = MM_W / world.width;
  const sy = MM_H / world.height;

  // Background
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(mmX - 2, mmY - 2, MM_W + 4, MM_H + 4);

  // Terrain (cached — terrain doesn't change during gameplay)
  renderMinimapTerrain(ctx, world, mmX, mmY, sx, sy);

  // Creature dots
  for (const p of world.pixels.values()) {
    const role = getCreatureRole(p);
    ctx.fillStyle = ROLE_COLORS[role] ?? '#888';
    ctx.fillRect(mmX + p.x * sx, mmY + p.y * sy, Math.max(1.5, sx), Math.max(1.5, sy));
  }

  // Viewport rectangle
  const worldPxW = world.width * cellSize;
  const worldPxH = world.height * cellSize;
  const vx = (cam.x / worldPxW) * MM_W;
  const vy = (cam.y / worldPxH) * MM_H;
  const vw = (canvasW / cam.zoom / worldPxW) * MM_W;
  const vh = (canvasH / cam.zoom / worldPxH) * MM_H;
  ctx.strokeStyle = 'rgba(0,255,136,0.7)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(mmX + vx, mmY + vy, vw, vh);

  // Zoom label
  ctx.font = '9px Consolas, monospace';
  ctx.fillStyle = '#889';
  ctx.fillText(`${cam.zoom.toFixed(1)}×`, mmX, mmY - 4);
}

function renderMinimapTerrain(
  ctx: CanvasRenderingContext2D, world: World,
  mmX: number, mmY: number, sx: number, sy: number,
): void {
  // Simple hash to detect terrain changes (shouldn't happen, but handles reset)
  const hash = world.terrain[0] + world.terrain[100] + world.terrain[world.terrain.length - 1] + world.width;
  if (terrainCache && hash === lastTerrainHash) {
    ctx.putImageData(terrainCache, mmX, mmY);
    return;
  }

  // Generate terrain image
  terrainCache = ctx.createImageData(MM_W, MM_H);
  const d = terrainCache.data;
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const [r, g, b] = getTerrainBaseColor(world.terrain[y * world.width + x]);
      // Map to minimap pixel range
      const px0 = Math.floor(x * sx);
      const py0 = Math.floor(y * sy);
      const px1 = Math.ceil((x + 1) * sx);
      const py1 = Math.ceil((y + 1) * sy);
      for (let py = py0; py < py1 && py < MM_H; py++) {
        for (let px = px0; px < px1 && px < MM_W; px++) {
          const i = (py * MM_W + px) * 4;
          d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
        }
      }
    }
  }
  lastTerrainHash = hash;
  ctx.putImageData(terrainCache, mmX, mmY);
}

// Check if a click is within minimap bounds, return world position if so
export function handleMinimapClick(
  screenX: number, screenY: number,
  canvasW: number, canvasH: number,
  world: World, cellSize: number,
): [number, number] | null {
  const mmX = Math.floor(canvasW - MM_W - MARGIN);
  const mmY = Math.floor(canvasH - MM_H - BOTTOM_OFFSET);

  if (screenX < mmX || screenX > mmX + MM_W) return null;
  if (screenY < mmY || screenY > mmY + MM_H) return null;

  const relX = (screenX - mmX) / MM_W;
  const relY = (screenY - mmY) / MM_H;
  return [relX * world.width * cellSize, relY * world.height * cellSize];
}

// Reset terrain cache on world reset
export function resetMinimapCache(): void {
  terrainCache = null;
  lastTerrainHash = 0;
}
