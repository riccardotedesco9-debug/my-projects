// Arms Race: detect evolutionary responses (armor spikes, speed surges, population crashes)
// Shows notification banners and maintains an event log

import type { World } from './types';
import { GENE } from './types';
import { getCreatureRole } from './metabolism';

interface ArmsRaceEvent {
  tick: number;
  message: string;
  color: string;
}

interface TraitSnapshot {
  speed: number;
  armor: number;
  harvest: number;
  population: number;
}

const SNAPSHOT_INTERVAL = 200;
const SPIKE_THRESHOLD = 0.15; // 15% change = notable
const CRASH_THRESHOLD = 0.4;  // 40% pop drop = crash

// Per-role trait snapshots
let snapshots: Map<number, TraitSnapshot> = new Map();
let eventLog: ArmsRaceEvent[] = [];
let notifications: { message: string; color: string; age: number }[] = [];
let lastSnapshotTick = 0;

export function updateArmsRace(world: World): void {
  if (world.tick - lastSnapshotTick < SNAPSHOT_INTERVAL) return;
  lastSnapshotTick = world.tick;

  // Compute current per-role averages
  const roleCounts = new Array(7).fill(0);
  const roleTotals: TraitSnapshot[] = Array.from({ length: 7 }, () => ({
    speed: 0, armor: 0, harvest: 0, population: 0,
  }));

  for (const p of world.pixels.values()) {
    const role = getCreatureRole(p);
    if (role >= 7) continue;
    roleCounts[role]++;
    roleTotals[role].speed += p.dna[GENE.SPEED];
    roleTotals[role].armor += p.dna[GENE.ARMOR];
    roleTotals[role].harvest += (p.dna[0] + p.dna[1] + p.dna[2]) / 3;
  }

  const ROLE_NAMES = ['Plant', 'Hunter', 'Apex', 'Scavenger', 'Parasite', 'Swarm', 'Nomad'];

  for (let role = 0; role < 7; role++) {
    if (roleCounts[role] < 3) continue;
    const current: TraitSnapshot = {
      speed: roleTotals[role].speed / roleCounts[role],
      armor: roleTotals[role].armor / roleCounts[role],
      harvest: roleTotals[role].harvest / roleCounts[role],
      population: roleCounts[role],
    };

    const prev = snapshots.get(role);
    if (prev && prev.population > 2) {
      // Detect trait spikes
      const armorChange = (current.armor - prev.armor) / Math.max(1, prev.armor);
      const speedChange = (current.speed - prev.speed) / Math.max(1, prev.speed);
      const popChange = (current.population - prev.population) / prev.population;

      if (armorChange > SPIKE_THRESHOLD) {
        addEvent(world.tick, `${ROLE_NAMES[role]} evolved +${Math.round(armorChange * 100)}% armor`, '#ffaa44');
      }
      if (speedChange > SPIKE_THRESHOLD) {
        addEvent(world.tick, `${ROLE_NAMES[role]} evolved +${Math.round(speedChange * 100)}% speed`, '#44aaff');
      }
      if (popChange < -CRASH_THRESHOLD) {
        addEvent(world.tick, `${ROLE_NAMES[role]} population crash: ${prev.population}→${current.population}`, '#ff4444');
      }
      if (popChange > 0.5 && current.population > 10) {
        addEvent(world.tick, `${ROLE_NAMES[role]} population boom: ${prev.population}→${current.population}`, '#44ff88');
      }
    }

    snapshots.set(role, current);
  }
}

function addEvent(tick: number, message: string, color: string): void {
  eventLog.push({ tick, message, color });
  notifications.push({ message, color, age: 0 });
  if (eventLog.length > 50) eventLog.shift();
  if (notifications.length > 3) notifications.shift();
}

// Render notification banners at top of screen
export function renderArmsRaceNotifications(ctx: CanvasRenderingContext2D, canvasW: number): void {
  // Tick notification ages
  for (let i = notifications.length - 1; i >= 0; i--) {
    notifications[i].age++;
    if (notifications[i].age > 180) { // ~3 seconds at 60fps
      notifications.splice(i, 1);
    }
  }

  if (notifications.length === 0) return;

  for (let i = 0; i < notifications.length; i++) {
    const n = notifications[i];
    const alpha = Math.max(0, 1 - n.age / 180);
    const y = 30 + i * 16;

    // Centered banner
    ctx.font = '10px Consolas, monospace';
    const textW = ctx.measureText(n.message).width;
    const bx = (canvasW - textW) / 2 - 8;

    ctx.fillStyle = `rgba(0,0,0,${alpha * 0.7})`;
    ctx.fillRect(bx, y - 10, textW + 16, 14);

    ctx.fillStyle = n.color;
    ctx.globalAlpha = alpha;
    ctx.fillText(n.message, bx + 8, y);
    ctx.globalAlpha = 1;
  }
}
