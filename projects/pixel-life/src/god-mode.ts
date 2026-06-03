// God Mode: click-to-place tools for world manipulation
// Tools: place-wall, place-food, place-drought, spawn-creature, kill, boost

import type { World, SimConfig } from './types';
import { Terrain } from './types';
import { createPixel, createRandomDna } from './pixel';
import { wrapX, wrapY, cellKey } from './world';
import { isPassable } from './terrain';
import { MAX_ENERGY } from './constants';

export type GodTool = 'none' | 'wall' | 'food' | 'drought' | 'spawn' | 'kill' | 'boost';

let activeTool: GodTool = 'none';
let godModeVisible = false;

export function getGodTool(): GodTool { return activeTool; }
export function setGodTool(tool: GodTool): void { activeTool = tool; }
export function isGodModeActive(): boolean { return activeTool !== 'none'; }
export function isGodModeVisible(): boolean { return godModeVisible; }
export function toggleGodModeVisibility(): void {
  godModeVisible = !godModeVisible;
  if (!godModeVisible) activeTool = 'none';
  updateGodModeUI();
}

// Execute god tool at grid position
export function executeGodTool(world: World, config: SimConfig, gx: number, gy: number): boolean {
  if (activeTool === 'none') return false;
  if (gx < 0 || gx >= world.width || gy < 0 || gy >= world.height) return false;

  const radius = (activeTool === 'spawn' || activeTool === 'kill' || activeTool === 'boost') ? 0 : 3;

  if (radius === 0) {
    applySingleCell(world, config, gx, gy);
  } else {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radius * radius) continue;
        const nx = wrapX(gx + dx, world.width);
        const ny = wrapY(gy + dy, world.height);
        applyAreaCell(world, nx, ny);
      }
    }
  }
  return true;
}

function applySingleCell(world: World, _config: SimConfig, gx: number, gy: number): void {
  const key = cellKey(gx, gy, world.width);

  switch (activeTool) {
    case 'spawn': {
      if (world.pixels.has(key)) return;
      if (!isPassable(world.terrain[key])) return;
      const pixel = createPixel(world.nextPixelId++, gx, gy, createRandomDna());
      world.pixels.set(key, pixel);
      break;
    }
    case 'kill': {
      const pixel = world.pixels.get(key);
      if (pixel) {
        world.pixels.delete(key);
        world.corpses[key] = Math.min(255, world.corpses[key] + Math.floor(pixel.energy * 2));
      }
      break;
    }
    case 'boost': {
      const pixel = world.pixels.get(key);
      if (pixel) pixel.energy = MAX_ENERGY;
      break;
    }
  }
}

function applyAreaCell(world: World, nx: number, ny: number): void {
  const ci = ny * world.width + nx;

  switch (activeTool) {
    case 'wall':
      world.terrain[ci] = Terrain.ROCK;
      // Remove any creature in the walled cell
      const key = cellKey(nx, ny, world.width);
      if (world.pixels.has(key)) world.pixels.delete(key);
      break;
    case 'food':
      world.food[ci] = 1.0;
      break;
    case 'drought':
      world.food[ci] = 0;
      world.pheromone[ci] = 0;
      break;
  }
}

// Update UI button states
function updateGodModeUI(): void {
  const panel = document.getElementById('god-mode-panel');
  if (panel) panel.style.display = godModeVisible ? 'block' : 'none';
}

export function updateGodToolButtons(): void {
  const tools: GodTool[] = ['wall', 'food', 'drought', 'spawn', 'kill', 'boost'];
  for (const t of tools) {
    const btn = document.getElementById(`god-${t}`);
    if (btn) btn.classList.toggle('active', activeTool === t);
  }
}

export function initGodMode(): void {
  const tools: GodTool[] = ['wall', 'food', 'drought', 'spawn', 'kill', 'boost'];
  for (const t of tools) {
    const btn = document.getElementById(`god-${t}`);
    if (btn) {
      btn.addEventListener('click', () => {
        activeTool = activeTool === t ? 'none' : t;
        updateGodToolButtons();
      });
    }
  }
  updateGodModeUI();
}
