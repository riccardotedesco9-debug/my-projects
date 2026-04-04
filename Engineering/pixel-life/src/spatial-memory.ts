// Spatial memory: creatures remember food-rich and dangerous locations
// Biases movement toward good memories, away from bad ones

import type { Pixel, World, MemoryEntry } from './types';
import {
  MEMORY_MAX_ENTRIES, MEMORY_DECAY_RATE,
  MEMORY_FOOD_THRESHOLD, MEMORY_DANGER_THRESHOLD,
} from './constants';

// Record a memory based on current state
export function recordMemory(pixel: Pixel, world: World): void {
  const idx = pixel.y * world.width + pixel.x;
  const food = world.food[idx];
  const threat = pixel.state[0];

  // Remember high-food locations
  if (food > MEMORY_FOOD_THRESHOLD) {
    addMemory(pixel, pixel.x, pixel.y, 'food', Math.floor(food * 200), world.tick);
  }

  // Remember dangerous locations (high threat state)
  if (threat > MEMORY_DANGER_THRESHOLD) {
    addMemory(pixel, pixel.x, pixel.y, 'danger', threat, world.tick);
  }

  // Remember safe spots where energy was gained significantly
  if (pixel.energy > 60 && pixel.state[1] > 150) {
    addMemory(pixel, pixel.x, pixel.y, 'safe', Math.floor(pixel.energy * 2), world.tick);
  }
}

function addMemory(pixel: Pixel, x: number, y: number, type: MemoryEntry['type'], strength: number, tick: number): void {
  // Don't duplicate nearby memories of the same type
  for (const m of pixel.memory) {
    if (m.type === type && Math.abs(m.x - x) <= 2 && Math.abs(m.y - y) <= 2) {
      // Refresh existing memory instead
      m.strength = Math.min(255, Math.max(m.strength, strength));
      m.tick = tick;
      m.x = x;
      m.y = y;
      return;
    }
  }

  const entry: MemoryEntry = { x, y, type, strength: Math.min(255, strength), tick };

  if (pixel.memory.length < MEMORY_MAX_ENTRIES) {
    pixel.memory.push(entry);
  } else {
    // Replace weakest memory
    let weakest = 0;
    for (let i = 1; i < pixel.memory.length; i++) {
      if (pixel.memory[i].strength < pixel.memory[weakest].strength) weakest = i;
    }
    pixel.memory[weakest] = entry;
  }
}

// Decay all memory strengths each tick
export function decayMemory(pixel: Pixel): void {
  for (let i = pixel.memory.length - 1; i >= 0; i--) {
    pixel.memory[i].strength *= MEMORY_DECAY_RATE;
    if (pixel.memory[i].strength < 1) {
      pixel.memory.splice(i, 1);
    }
  }
}

// Get a directional bias from memories: toward food/safe, away from danger
export function getMemoryBias(pixel: Pixel, worldW: number, worldH: number): [number, number] {
  if (pixel.memory.length === 0) return [0, 0];

  let bx = 0, by = 0;

  for (const m of pixel.memory) {
    // Distance with toroidal wrapping
    let dx = m.x - pixel.x;
    let dy = m.y - pixel.y;
    if (Math.abs(dx) > worldW / 2) dx -= Math.sign(dx) * worldW;
    if (Math.abs(dy) > worldH / 2) dy -= Math.sign(dy) * worldH;

    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) continue;

    // Normalize direction and weight by strength and inverse distance
    const weight = (m.strength / 255) / dist;
    const ndx = dx / dist;
    const ndy = dy / dist;

    if (m.type === 'food' || m.type === 'safe') {
      bx += ndx * weight;
      by += ndy * weight;
    } else {
      // Danger: move away
      bx -= ndx * weight * 1.5; // danger has stronger repulsion
      by -= ndy * weight * 1.5;
    }
  }

  // Normalize to unit vector
  const mag = Math.sqrt(bx * bx + by * by);
  if (mag < 0.01) return [0, 0];
  return [bx / mag, by / mag];
}
