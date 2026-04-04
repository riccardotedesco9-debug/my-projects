import type { World, EnvironmentEvent, TickEvents } from './types';
import { addFood, wrapX, wrapY, cellKey, removePixel } from './world';
import {
  EVENT_INTERVAL_MIN, EVENT_INTERVAL_MAX,
  METEOR_RADIUS, METEOR_SUBSTRATE_DEPOSIT,
  DROUGHT_DURATION, BLOOM_DURATION,
  PLAGUE_DURATION, PLAGUE_DAMAGE_MULT,
} from './constants';

export function updateEvents(world: World, events: TickEvents): void {
  // Check for new event
  if (world.tick >= world.nextEventTick && !world.activeEvent) {
    world.activeEvent = spawnEvent(world);
    world.nextEventTick = world.tick + randomInt(EVENT_INTERVAL_MIN, EVENT_INTERVAL_MAX);
  }

  // Process active event
  if (!world.activeEvent) return;
  const ev = world.activeEvent;
  ev.ticksLeft--;

  switch (ev.type) {
    case 'meteor':
      applyMeteor(world, ev, events);
      world.activeEvent = null; // instant
      break;
    case 'drought':
      applyDrought(world, ev);
      if (ev.ticksLeft <= 0) world.activeEvent = null;
      break;
    case 'bloom':
      applyBloom(world, ev);
      if (ev.ticksLeft <= 0) world.activeEvent = null;
      break;
    case 'plague':
      applyPlague(world, ev, events);
      if (ev.ticksLeft <= 0) world.activeEvent = null;
      break;
  }
}

function spawnEvent(world: World): EnvironmentEvent {
  const types: EnvironmentEvent['type'][] = ['meteor', 'drought', 'bloom', 'plague'];
  const type = types[Math.floor(Math.random() * types.length)];
  const x = Math.floor(Math.random() * world.width);
  const y = Math.floor(Math.random() * world.height);

  switch (type) {
    case 'meteor':
      return { type, x, y, radius: METEOR_RADIUS, ticksLeft: 1 };
    case 'drought':
      return { type, x, y, radius: 0, ticksLeft: DROUGHT_DURATION, channel: Math.floor(Math.random() * 3) };
    case 'bloom':
      return { type, x, y, radius: 15 + Math.floor(Math.random() * 10), ticksLeft: BLOOM_DURATION, channel: Math.floor(Math.random() * 3) };
    case 'plague':
      return { type, x, y, radius: 30, ticksLeft: PLAGUE_DURATION };
  }
}

function applyMeteor(world: World, ev: EnvironmentEvent, events: TickEvents): void {
  const r2 = ev.radius * ev.radius;
  for (let dy = -ev.radius; dy <= ev.radius; dy++) {
    for (let dx = -ev.radius; dx <= ev.radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const nx = wrapX(ev.x + dx, world.width);
      const ny = wrapY(ev.y + dy, world.height);
      // Kill pixels in blast radius
      const key = cellKey(nx, ny, world.width);
      const pixel = world.pixels.get(key);
      if (pixel) { removePixel(world, pixel); events.deaths++; }
      // Deposit massive food
      addFood(world, nx, ny, METEOR_SUBSTRATE_DEPOSIT);
    }
  }
}

function applyDrought(world: World, _ev: EnvironmentEvent): void {
  // Global food suppression during drought
  const f = world.food;
  for (let i = 0; i < f.length; i++) {
    f[i] *= 0.95;
  }
}

function applyBloom(world: World, ev: EnvironmentEvent): void {
  const r2 = ev.radius * ev.radius;
  for (let dy = -ev.radius; dy <= ev.radius; dy++) {
    for (let dx = -ev.radius; dx <= ev.radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const nx = wrapX(ev.x + dx, world.width);
      const ny = wrapY(ev.y + dy, world.height);
      addFood(world, nx, ny, 0.05);
    }
  }
}

function applyPlague(world: World, ev: EnvironmentEvent, _events: TickEvents): void {
  const r2 = ev.radius * ev.radius;
  for (let dy = -ev.radius; dy <= ev.radius; dy++) {
    for (let dx = -ev.radius; dx <= ev.radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const nx = wrapX(ev.x + dx, world.width);
      const ny = wrapY(ev.y + dy, world.height);
      const key = cellKey(nx, ny, world.width);
      const pixel = world.pixels.get(key);
      if (pixel) {
        pixel.energy -= 0.3 * PLAGUE_DAMAGE_MULT; // ongoing damage
      }
    }
  }
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
