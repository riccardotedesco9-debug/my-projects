import type { SimConfig, ViewMode, World, Pixel } from './types';
import { formatPixelState } from './pixel-state';
import { genomeComplexity } from './regulation';

let resetCallback: () => void;

const GENE_NAMES = [
  'Harvest R', 'Harvest G', 'Harvest B', 'Speed', 'Sense Range',
  'Sense Target', 'React Type', 'React Thresh', 'Waste R', 'Waste G',
  'Waste B', 'Repro Thresh', 'Repro Share', 'Mutation Rate', 'Armor', 'Adhesion',
];

export function initControls(config: SimConfig, onReset: () => void): void {
  resetCallback = onReset;

  // Simulation buttons
  el<HTMLButtonElement>('btn-play').onclick = () => { config.paused = false; };
  el<HTMLButtonElement>('btn-pause').onclick = () => { config.paused = true; };
  el<HTMLButtonElement>('btn-reset').onclick = () => resetCallback();

  // Sliders
  bindSlider('slider-speed', 'val-speed', v => { config.simSpeed = v; return `${v}x`; });
  bindSlider('slider-population', 'val-population', v => { config.initialPopulation = v; return String(v); });
  bindSlider('slider-emission', 'val-emission', v => { config.substrateEmission = v / 1000; return (v / 1000).toFixed(3); });
  bindSlider('slider-diffusion', 'val-diffusion', v => { config.substrateDiffusion = v / 100; return (v / 100).toFixed(2); });
  bindSlider('slider-decay', 'val-decay', v => { config.substrateDecay = v / 1000; return (v / 1000).toFixed(3); });
  bindSlider('slider-season', 'val-season', v => { config.seasonLength = v; return String(v); });
  bindSlider('slider-upkeep', 'val-upkeep', v => { config.upkeepMultiplier = v / 100; return `${(v / 100).toFixed(1)}x`; });
  bindSlider('slider-mutation', 'val-mutation', v => { config.mutationIntensity = v; return String(v); });

  // View mode buttons
  const viewModes: ViewMode[] = ['normal', 'energy', 'trophic', 'substrate', 'lineage'];
  const viewIds = ['view-normal', 'view-energy', 'view-trophic', 'view-substrate', 'view-lineage'];
  viewIds.forEach((id, i) => {
    el<HTMLButtonElement>(id).onclick = () => {
      config.viewMode = viewModes[i];
      viewIds.forEach((vid, vi) => {
        el<HTMLButtonElement>(vid).classList.toggle('active', vi === i);
      });
    };
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === ' ') { e.preventDefault(); config.paused = !config.paused; }
    if (e.key === '1') config.paintChannel = 0;
    if (e.key === '2') config.paintChannel = 1;
    if (e.key === '3') config.paintChannel = 2;
  });
}

// Canvas interaction: click to inspect/spawn, drag to paint substrate
export function initCanvasInteraction(
  canvas: HTMLCanvasElement,
  world: World,
  config: SimConfig,
): void {
  let painting = false;

  canvas.addEventListener('mousedown', (e) => {
    const [gx, gy] = canvasToGrid(e, canvas, config);
    const key = gy * world.width + gx;
    const pixel = world.pixels.get(key);

    if (pixel) {
      showTooltip(pixel, e.clientX, e.clientY);
    } else {
      painting = true;
      paintSubstrate(world, gx, gy, config.paintChannel);
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!painting) return;
    const [gx, gy] = canvasToGrid(e, canvas, config);
    paintSubstrate(world, gx, gy, config.paintChannel);
  });

  canvas.addEventListener('mouseup', () => { painting = false; });
  canvas.addEventListener('mouseleave', () => { painting = false; });

  // Hide tooltip on click elsewhere
  document.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id !== 'pixel-canvas') {
      hideTooltip();
    }
  });
}

function canvasToGrid(e: MouseEvent, canvas: HTMLCanvasElement, config: SimConfig): [number, number] {
  const rect = canvas.getBoundingClientRect();
  // Map mouse position to grid coordinates (display res / pixelScale = grid)
  const gx = Math.floor((e.clientX - rect.left) / rect.width * config.worldWidth);
  const gy = Math.floor((e.clientY - rect.top) / rect.height * config.worldHeight);
  return [gx, gy];
}

function paintSubstrate(world: World, x: number, y: number, _ch: number): void {
  if (x < 0 || x >= world.width || y < 0 || y >= world.height) return;
  const idx = y * world.width + x;
  world.food[idx] = Math.min(1, world.food[idx] + 0.3);
}

function showTooltip(pixel: Pixel, mx: number, my: number): void {
  const tip = document.getElementById('tooltip')!;
  const genes = Array.from(pixel.dna).map((v, i) => `${GENE_NAMES[i]}: ${v}`).join('\n');
  const regCount = pixel.regulatoryGenes.length;
  const complexity = genomeComplexity(pixel);

  tip.innerHTML = `
    <strong>Pixel #${pixel.id}</strong> (Gen ${pixel.generation})<br/>
    Energy: ${pixel.energy.toFixed(1)} | Age: ${pixel.age}<br/>
    ${formatPixelState(pixel)}<br/>
    Regulatory genes: ${regCount} | Complexity: ${complexity}<br/>
    <hr style="border-color:#333;margin:4px 0"/>
    <pre style="margin:0;font-size:9px;line-height:1.4">${genes}</pre>
  `;
  tip.style.display = 'block';
  tip.style.left = `${mx + 12}px`;
  tip.style.top = `${my + 12}px`;
}

function hideTooltip(): void {
  document.getElementById('tooltip')!.style.display = 'none';
}

function bindSlider(sliderId: string, valueId: string, onChange: (v: number) => string): void {
  const slider = el<HTMLInputElement>(sliderId);
  const display = el<HTMLSpanElement>(valueId);
  slider.oninput = () => {
    display.textContent = onChange(Number(slider.value));
  };
  // Initialize display
  display.textContent = onChange(Number(slider.value));
}

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
