import { createDefaultConfig } from './constants';
import { createWorld, seedPixels } from './world';
import { simulateTick, lastTickEvents } from './simulation';
import { initRenderer, renderFrame } from './renderer';
import { initControls, initCanvasInteraction } from './ui-controls';
import { initStats, updateStatsDisplay, setDisplayTps } from './stats';
import { initAudio, updateAmbientSeason, playTickSfx } from './audio';
import type { SimConfig, World } from './types';

let config: SimConfig = createDefaultConfig();
let world: World = createWorld(config);
let lastTickTime = 0;
let tickAccum = 0;

const BASE_TPS = 10; // 10 ticks per second at 1x speed

let tpsCounter = 0;
let tpsLastSec = 0;

function reset(): void {
  config = createDefaultConfig();
  world = createWorld(config);
  seedPixels(world, config);
  initRenderer(world, config);
  initControls(config, () => { reset(); });
  initStats(world, config);
  const pixelCanvas = document.getElementById('pixel-canvas') as HTMLCanvasElement;
  initCanvasInteraction(pixelCanvas, world, config);
  lastTickTime = 0;
  tickAccum = 0;
}

function gameLoop(now: number): void {
  if (lastTickTime === 0) lastTickTime = now;
  const dt = Math.min(now - lastTickTime, 200); // cap at 200ms to prevent spiral
  lastTickTime = now;

  // TPS counter
  if (now - tpsLastSec >= 1000) {
    setDisplayTps(tpsCounter);
    tpsCounter = 0;
    tpsLastSec = now;
  }

  if (!config.paused) {
    // Tick interval based on speed: 1x = 10 TPS, 5x = 50 TPS, 20x = 200 TPS
    const tickInterval = 1000 / (BASE_TPS * config.simSpeed);
    tickAccum += dt;

    // Run ticks but cap at 14ms wall time to keep rendering smooth
    const budgetStart = performance.now();
    while (tickAccum >= tickInterval && (performance.now() - budgetStart) < 14) {
      simulateTick(world, config);
      tickAccum -= tickInterval;
      tpsCounter++;
    }
    // Prevent runaway accumulator
    if (tickAccum > tickInterval * 3) tickAccum = 0;

    updateAmbientSeason(world.season);
    playTickSfx(lastTickEvents, world.pixels.size, world.width * world.height * 0.3);
  }

  renderFrame(world, config);
  updateStatsDisplay(world, config);

  if (!document.hidden) {
    requestAnimationFrame(gameLoop);
  } else {
    const resume = (): void => {
      document.removeEventListener('visibilitychange', resume);
      lastTickTime = 0;
      tickAccum = 0;
      requestAnimationFrame(gameLoop);
    };
    document.addEventListener('visibilitychange', resume);
  }
}

// -- Boot --
reset();
initAudio(config);
requestAnimationFrame(gameLoop);
