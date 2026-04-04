import { createDefaultConfig } from './constants';
import { createWorld, seedPixels } from './world';
import { simulateTick, lastTickEvents } from './simulation';
import { initRenderer, renderFrame } from './renderer';
import { initControls, initCanvasInteraction } from './ui-controls';
import { initStats, updateStatsDisplay, setDisplayTps } from './stats';
import { initAudio, updateAmbientSeason, playTickSfx } from './audio';
import { initInspector, updateInspector } from './creature-inspector';
import { initGodMode } from './god-mode';
import { initReplay, isReplaying, advanceReplay, renderReplayFrame, recordTick } from './replay';
import type { SimConfig, World } from './types';

let config: SimConfig = createDefaultConfig();
let world: World = createWorld(config);
let lastTickTime = 0;
let tickAccum = 0;

const BASE_TPS = 10; // 10 ticks per second at 1x speed

let tpsCounter = 0;
let tpsLastSec = 0;

function reset(): void {
  // Reset config values in-place (preserving object reference for slider bindings)
  Object.assign(config, createDefaultConfig());
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

  // Replay mode: bypass simulation, render snapshots
  if (isReplaying()) {
    advanceReplay();
    const pixCanvas = document.getElementById('pixel-canvas') as HTMLCanvasElement;
    const pixCtx = pixCanvas.getContext('2d')!;
    renderReplayFrame(pixCtx, pixCanvas.width, pixCanvas.height, config.pixelScale, config.worldWidth, config.worldHeight);
  } else {
    if (!config.paused) {
      const tickInterval = 1000 / (BASE_TPS * config.simSpeed);
      tickAccum += dt;

      const budgetStart = performance.now();
      while (tickAccum >= tickInterval && (performance.now() - budgetStart) < 14) {
        simulateTick(world, config);
        recordTick(world);
        tickAccum -= tickInterval;
        tpsCounter++;
      }
      if (tickAccum > tickInterval * 3) tickAccum = 0;

      updateAmbientSeason(world.season);
      playTickSfx(lastTickEvents, world.pixels.size, world.width * world.height * 0.3);
    }

    renderFrame(world, config);
    updateStatsDisplay(world, config);
    updateInspector(world, config);
  }

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
initInspector();
initGodMode();
initReplay();
requestAnimationFrame(gameLoop);
