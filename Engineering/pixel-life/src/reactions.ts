import type { Pixel, World, SimConfig, TickEvents } from './types';
import { GENE } from './types';
import { getEffectiveGene } from './pixel';
import { wrapX, wrapY, cellKey, movePixelTo } from './world';
import { isPassable } from './terrain';
import {
  ABSORB_EFFICIENCY, CATALYZE_COST, CATALYZE_DURATION,
  REPEL_COST, MAX_ENERGY, ABSORB_SKILL_THRESHOLD,
} from './constants';

const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
const DY = [-1, -1, -1, 0, 0, 1, 1, 1];

export function resolveReaction(
  attacker: Pixel, defender: Pixel,
  world: World, _config: SimConfig, events: TickEvents,
): void {
  const reactType = getEffectiveGene(attacker, GENE.REACT_TYPE);

  if (reactType < 64) {
    // ABSORB: always attack on collision — predators don't hesitate
    resolveAbsorb(attacker, defender, world, events);
  } else {
    // Non-violent reactions: threshold gated
    const threshold = getEffectiveGene(attacker, GENE.REACT_THRESHOLD) / 255 * 30;
    if (Math.abs(attacker.energy - defender.energy) < threshold) return;
    if (reactType < 128) resolveShare(attacker, defender, events);
    else if (reactType < 192) resolveCatalyze(attacker, defender, world, events);
    else resolveRepel(attacker, world, events);
  }
}

function resolveAbsorb(attacker: Pixel, defender: Pixel, world: World, events: TickEvents): void {
  const defenderArmor = getEffectiveGene(defender, GENE.ARMOR);
  const reactType = getEffectiveGene(attacker, GENE.REACT_TYPE);

  const absorbSkill = reactType < ABSORB_SKILL_THRESHOLD
    ? (ABSORB_SKILL_THRESHOLD - reactType) / ABSORB_SKILL_THRESHOLD : 0.1;

  let amount = defender.energy * ABSORB_EFFICIENCY * (0.3 + absorbSkill * 0.7);

  // Armor defense
  if (defenderArmor > reactType * 4) amount *= 0.5;
  amount *= (1 - defenderArmor / 255);

  attacker.energy = Math.min(MAX_ENERGY, attacker.energy + amount);
  defender.energy -= amount;
  defender.state[0] = Math.min(255, defender.state[0] + 50);
  events.absorbs++;

  // If prey dies from this attack, predator moves into its spot
  if (defender.energy <= 0) {
    const px = defender.x, py = defender.y;
    const cellIdx = py * world.width + px;
    // Remove dead prey + create corpse + release nutrients (proper death cycle)
    world.pixels.delete(cellIdx);
    world.corpses[cellIdx] = Math.min(255, world.corpses[cellIdx] + Math.floor(Math.max(5, amount) * 2));
    // Release some food back to terrain (nutrient cycling)
    if (world.food[cellIdx] < 1) world.food[cellIdx] = Math.min(1, world.food[cellIdx] + amount * 0.05);
    // Predator advances to prey's spot
    movePixelTo(world, attacker, px, py);
    events.deaths++;
  }
}

function resolveShare(a: Pixel, b: Pixel, events: TickEvents): void {
  const avg = (a.energy + b.energy) / 2;
  a.energy = avg;
  b.energy = avg;
  a.state[2] = Math.min(255, a.state[2] + 20);
  b.state[2] = Math.min(255, b.state[2] + 20);
  events.shares++;
}

function resolveCatalyze(catalyst: Pixel, target: Pixel, world: World, events: TickEvents): void {
  if (catalyst.energy < CATALYZE_COST) return;
  catalyst.energy -= CATALYZE_COST;
  target.catalyzedUntil = world.tick + CATALYZE_DURATION;
  events.catalyzes++;
}

function resolveRepel(pixel: Pixel, world: World, events: TickEvents): void {
  pixel.energy -= REPEL_COST;
  const order = shuffled8();
  for (const i of order) {
    const nx = wrapX(pixel.x + DX[i], world.width);
    const ny = wrapY(pixel.y + DY[i], world.height);
    if (!world.pixels.has(cellKey(nx, ny, world.width)) && isPassable(world.terrain[ny * world.width + nx])) {
      movePixelTo(world, pixel, nx, ny);
      break;
    }
  }
  events.repels++;
}

function shuffled8(): number[] {
  const arr = [0, 1, 2, 3, 4, 5, 6, 7];
  for (let i = 7; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
