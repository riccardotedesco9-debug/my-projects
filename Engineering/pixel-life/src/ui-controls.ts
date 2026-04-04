import type { SimConfig, ViewMode, World } from './types';
import { getCamera, screenToWorld } from './renderer';
import { showInspector, hideInspector, toggleFollow } from './creature-inspector';
import { isGodModeActive, executeGodTool, toggleGodModeVisibility, setGodTool } from './god-mode';
import { seedPixels } from './world';

let resetCallback: () => void;
let _world: import('./types').World | null = null;


export function initControls(config: SimConfig, onReset: () => void): void {
  resetCallback = onReset;

  // Simulation buttons
  el<HTMLButtonElement>('btn-play').onclick = () => { config.paused = false; };
  el<HTMLButtonElement>('btn-pause').onclick = () => { config.paused = true; };
  el<HTMLButtonElement>('btn-reset').onclick = () => resetCallback();

  // Sliders
  bindSlider('slider-speed', 'val-speed', v => {
    // 1-10 = 0.1x to 1.0x, 10-40 = 1x to 4x
    const speed = v <= 10 ? v / 10 : 1 + (v - 10) / 10;
    config.simSpeed = speed;
    return `${speed.toFixed(1)}x`;
  });
  bindSlider('slider-population', 'val-population', v => {
    config.initialPopulation = v;
    // Live spawn: if population below target, add more creatures now
    if (_world && _world.pixels.size < v) {
      seedPixels(_world, { ...config, initialPopulation: Math.min(50, v - _world.pixels.size) });
    }
    return String(v);
  });
  bindSlider('slider-emission', 'val-emission', v => { config.substrateEmission = v / 1000; return (v / 1000).toFixed(3); });
  bindSlider('slider-harvest', 'val-harvest', v => {
    // Directly modify HARVEST_RATE via config extension
    (config as any).harvestRate = v / 100;
    return (v / 100).toFixed(2);
  });
  bindSlider('slider-repro', 'val-repro', v => {
    (config as any).reproTax = v / 10;
    return (v / 10).toFixed(1);
  });
  bindSlider('slider-upkeep', 'val-upkeep', v => { config.upkeepMultiplier = v / 100; return `${(v / 100).toFixed(1)}x`; });
  bindSlider('slider-diffusion', 'val-diffusion', v => { config.substrateDiffusion = v / 100; return (v / 100).toFixed(2); });
  bindSlider('slider-season', 'val-season', v => { config.seasonLength = v; return String(v); });
  bindSlider('slider-mutation', 'val-mutation', v => { config.mutationIntensity = v; return String(v); });

  // Defaults button — reset all sliders to initial values
  const defaultsBtn = document.getElementById('btn-defaults');
  if (defaultsBtn) {
    defaultsBtn.onclick = () => {
      const defaults: Record<string, number> = {
        'slider-speed': 10, 'slider-population': 100, 'slider-emission': 10,
        'slider-harvest': 28, 'slider-repro': 35, 'slider-upkeep': 60,
        'slider-diffusion': 6, 'slider-season': 2000, 'slider-mutation': 15,
      };
      for (const [id, val] of Object.entries(defaults)) {
        const slider = document.getElementById(id) as HTMLInputElement;
        if (slider) { slider.value = String(val); slider.dispatchEvent(new Event('input')); }
      }
    };
  }

  // View mode buttons
  const viewModes: ViewMode[] = ['normal', 'energy', 'trophic', 'substrate', 'lineage', 'territory'];
  const viewIds = ['view-normal', 'view-energy', 'view-trophic', 'view-substrate', 'view-lineage', 'view-territory'];
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
    if (e.key === 'Escape') { hideInspector(); setGodTool('none'); }
    if (e.key === 'f' || e.key === 'F') toggleFollow();
    if (e.key === 'g' || e.key === 'G') toggleGodModeVisibility();
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
  _world = world;
  let painting = false;

  canvas.addEventListener('mousedown', (e) => {
    const [gx, gy] = canvasToGrid(e, canvas, config);

    // God mode takes priority
    if (isGodModeActive()) {
      executeGodTool(world, config, gx, gy);
      return;
    }

    const key = gy * world.width + gx;
    const pixel = world.pixels.get(key);

    if (pixel) {
      showInspector(pixel, e.clientX, e.clientY);
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

  // Hide inspector on click outside canvas
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.id !== 'pixel-canvas' && !target.closest('#inspector-panel') && !target.closest('#controls')) {
      hideInspector();
    }
  });
}

function canvasToGrid(e: MouseEvent, canvas: HTMLCanvasElement, config: SimConfig): [number, number] {
  const rect = canvas.getBoundingClientRect();
  // Convert screen mouse position to canvas-relative coords
  const canvasX = (e.clientX - rect.left) / rect.width * canvas.width;
  const canvasY = (e.clientY - rect.top) / rect.height * canvas.height;
  // Apply camera inverse transform to get world coordinates
  const cam = getCamera();
  const [wx, wy] = screenToWorld(cam, canvasX, canvasY);
  const gx = Math.floor(wx / config.pixelScale);
  const gy = Math.floor(wy / config.pixelScale);
  return [gx, gy];
}

function paintSubstrate(world: World, x: number, y: number, _ch: number): void {
  if (x < 0 || x >= world.width || y < 0 || y >= world.height) return;
  const idx = y * world.width + x;
  world.food[idx] = Math.min(1, world.food[idx] + 0.3);
}

// Tooltip removed — replaced by creature-inspector panel

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
