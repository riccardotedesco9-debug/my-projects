// Replay: time-lapse playback of recorded world snapshots
// Records snapshots at intervals, replays them as animated dots on terrain

import type { WorldSnapshot } from './snapshot';
import { captureSnapshot } from './snapshot';
import type { World } from './types';

const ROLE_COLORS = ['#44cc44', '#cc8844', '#cc3333', '#aa8866', '#aa44cc', '#44cccc', '#cccc44'];

const MAX_SNAPSHOTS = 500;
const RECORD_INTERVAL = 50; // ticks between snapshots

let snapshots: WorldSnapshot[] = [];
let recording = false;
let replaying = false;
let replayIdx = 0;
let replaySpeed = 1;
let lastRecordTick = 0;

export function isRecording(): boolean { return recording; }
export function isReplaying(): boolean { return replaying; }
export function getReplayIdx(): number { return replayIdx; }
export function getSnapshotCount(): number { return snapshots.length; }

export function toggleRecording(): void {
  recording = !recording;
  if (recording) {
    snapshots = [];
    lastRecordTick = 0;
  }
  updateReplayUI();
}

export function startReplay(): void {
  if (snapshots.length < 2) return;
  replaying = true;
  replayIdx = 0;
  updateReplayUI();
}

export function stopReplay(): void {
  replaying = false;
  updateReplayUI();
}

export function setReplaySpeed(speed: number): void { replaySpeed = speed; }

export function setReplayPosition(idx: number): void {
  replayIdx = Math.max(0, Math.min(snapshots.length - 1, idx));
}

// Called each simulation tick when recording
export function recordTick(world: World): void {
  if (!recording) return;
  if (world.tick - lastRecordTick < RECORD_INTERVAL) return;
  lastRecordTick = world.tick;

  snapshots.push(captureSnapshot(world));

  // Downsample if exceeding max
  if (snapshots.length > MAX_SNAPSHOTS) {
    const downsampled: WorldSnapshot[] = [];
    for (let i = 0; i < snapshots.length; i += 2) {
      downsampled.push(snapshots[i]);
    }
    snapshots = downsampled;
  }
}

// Advance replay by one frame (called from game loop when replaying)
export function advanceReplay(): void {
  if (!replaying) return;
  replayIdx += replaySpeed;
  if (replayIdx >= snapshots.length) {
    replayIdx = snapshots.length - 1;
    replaying = false;
    updateReplayUI();
  }
}

// Render a single replay frame
export function renderReplayFrame(
  ctx: CanvasRenderingContext2D,
  canvasW: number, canvasH: number,
  pixelScale: number, _worldW: number, _worldH: number,
): void {
  const idx = Math.floor(Math.max(0, Math.min(snapshots.length - 1, replayIdx)));
  const snap = snapshots[idx];
  if (!snap) return;

  // Clear and draw creatures as dots
  ctx.clearRect(0, 0, canvasW, canvasH);

  for (let i = 0; i < snap.population; i++) {
    const role = snap.roles[i];
    const energy = snap.energies[i] / 255;
    ctx.fillStyle = ROLE_COLORS[role] ?? '#888';
    ctx.globalAlpha = 0.4 + energy * 0.6;
    const x = snap.xs[i] * pixelScale;
    const y = snap.ys[i] * pixelScale;
    ctx.fillRect(x, y, pixelScale, pixelScale);
  }
  ctx.globalAlpha = 1;

  // Overlay: tick info
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(canvasW / 2 - 100, 4, 200, 20);
  ctx.font = '11px Consolas, monospace';
  ctx.fillStyle = '#00ff88';
  ctx.textAlign = 'center';
  ctx.fillText(`REPLAY: Tick ${snap.tick} | ${snap.season} | Pop ${snap.population} | ${idx + 1}/${snapshots.length}`, canvasW / 2, 18);
  ctx.textAlign = 'left';

  // Timeline bar at bottom
  const barY = canvasH - 8;
  const progress = snapshots.length > 1 ? idx / (snapshots.length - 1) : 0;
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(10, barY, canvasW - 20, 4);
  ctx.fillStyle = '#00ff88';
  ctx.fillRect(10, barY, (canvasW - 20) * progress, 4);
}

function updateReplayUI(): void {
  const recBtn = document.getElementById('btn-record');
  const repBtn = document.getElementById('btn-replay');
  if (recBtn) {
    recBtn.textContent = recording ? 'Stop Rec' : 'Record';
    recBtn.classList.toggle('active', recording);
  }
  if (repBtn) {
    repBtn.textContent = replaying ? 'Stop' : 'Replay';
    repBtn.classList.toggle('active', replaying);
    if (!replaying && snapshots.length < 2) {
      (repBtn as HTMLButtonElement).disabled = true;
    } else {
      (repBtn as HTMLButtonElement).disabled = false;
    }
  }
}

export function initReplay(): void {
  const recBtn = document.getElementById('btn-record');
  const repBtn = document.getElementById('btn-replay');

  if (recBtn) recBtn.addEventListener('click', toggleRecording);
  if (repBtn) repBtn.addEventListener('click', () => {
    if (replaying) stopReplay();
    else startReplay();
  });

  updateReplayUI();
}
