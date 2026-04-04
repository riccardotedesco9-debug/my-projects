// Ecosystem Graph: live food web showing energy flow between creature roles
// Toggle with E key, renders as canvas overlay

import { getCreatureRole } from './metabolism';
import type { World } from './types';

const ROLE_NAMES = ['Plant', 'Hunter', 'Apex', 'Scvgr', 'Para', 'Swarm', 'Nomad'];
const ROLE_COLORS = ['#44cc44', '#cc8844', '#cc3333', '#aa8866', '#aa44cc', '#44cccc', '#cccc44'];

// 7x7 energy flow matrix: flowMatrix[from][to] = energy transferred this window
let flowMatrix: number[][] = Array.from({ length: 7 }, () => new Array(7).fill(0));
let windowTicks = 0;
const SAMPLE_WINDOW = 200;
let visible = false;

// Role populations for node sizing
let rolePopulations: number[] = new Array(7).fill(0);

export function toggleEcosystemGraph(): void { visible = !visible; }
export function isEcosystemGraphVisible(): boolean { return visible; }

// Record energy flow between roles (called from reactions)
export function recordEnergyFlow(fromRole: number, toRole: number, amount: number): void {
  if (fromRole >= 0 && fromRole < 7 && toRole >= 0 && toRole < 7) {
    flowMatrix[fromRole][toRole] += amount;
  }
}

// Update population counts + reset flow matrix periodically
export function updateEcosystemGraph(world: World): void {
  rolePopulations.fill(0);
  for (const p of world.pixels.values()) {
    const role = getCreatureRole(p);
    if (role < 7) rolePopulations[role]++;
  }

  windowTicks++;
  if (windowTicks >= SAMPLE_WINDOW) {
    // Average the flow matrix over the window, then reset
    for (let i = 0; i < 7; i++)
      for (let j = 0; j < 7; j++)
        flowMatrix[i][j] /= SAMPLE_WINDOW;
    windowTicks = 0;
  }
}

// Render the food web graph as a canvas overlay
export function renderEcosystemGraph(ctx: CanvasRenderingContext2D, _canvasW: number, _canvasH: number): void {
  if (!visible) return;

  const gw = 220, gh = 220;
  const gx = 10, gy = 30;
  const cx = gx + gw / 2, cy = gy + gh / 2;
  const radius = 80;

  // Semi-transparent background
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(gx - 5, gy - 18, gw + 10, gh + 24);

  ctx.font = '10px Consolas, monospace';
  ctx.fillStyle = '#889';
  ctx.fillText('FOOD WEB (E to toggle)', gx, gy - 6);

  // Position nodes in a circle
  const positions: [number, number][] = [];
  const totalPop = Math.max(1, rolePopulations.reduce((a, b) => a + b, 0));

  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2 - Math.PI / 2;
    positions.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
  }

  // Draw edges (energy flow)
  for (let from = 0; from < 7; from++) {
    for (let to = 0; to < 7; to++) {
      if (from === to) continue;
      const flow = flowMatrix[from][to];
      if (flow < 0.01) continue;

      const [x1, y1] = positions[from];
      const [x2, y2] = positions[to];
      const thickness = Math.min(3, flow * 2);
      const alpha = Math.min(0.8, flow * 0.5 + 0.1);

      ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
      ctx.lineWidth = thickness;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      // Arrow head
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1) continue;
      const nx = dx / len, ny = dy / len;
      const ax = x2 - nx * 12, ay = y2 - ny * 12;
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.beginPath();
      ctx.moveTo(x2 - nx * 8, y2 - ny * 8);
      ctx.lineTo(ax - ny * 3, ay + nx * 3);
      ctx.lineTo(ax + ny * 3, ay - nx * 3);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Draw nodes
  for (let i = 0; i < 7; i++) {
    const [nx, ny] = positions[i];
    const pop = rolePopulations[i];
    const nodeSize = 6 + (pop / totalPop) * 20;

    // Node circle
    ctx.fillStyle = ROLE_COLORS[i];
    ctx.globalAlpha = pop > 0 ? 0.9 : 0.2;
    ctx.beginPath();
    ctx.arc(nx, ny, nodeSize, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Label
    ctx.fillStyle = pop > 0 ? '#dde' : '#556';
    ctx.font = '8px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(ROLE_NAMES[i], nx, ny + nodeSize + 10);
    ctx.fillText(String(pop), nx, ny + 3);
  }
  ctx.textAlign = 'left';
}
