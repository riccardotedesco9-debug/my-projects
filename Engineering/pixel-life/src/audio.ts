import type { SimConfig, Season, TickEvents } from './types';

// ---- Mix constants (tuned for a contemplative sim, not a game) ----
const MASTER_GAIN = 1.0;
const AMBIENT_GAIN = 0.7;
const SFX_BASE_GAIN = 1.0;
const UI_CLICK_GAIN = 0.7;
const SFX_COOLDOWN_MS = 500;
const EXTINCTION_COOLDOWN_TICKS = 600;

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let ambientGain: GainNode | null = null;
let sfxBuffers: Map<string, AudioBuffer> = new Map();
let sfxLastFired: Map<string, number> = new Map();
let lastSeenPopulation = -1;
let lastExtinctionTick = -10000;
let muted = false;
let initialized = false;
let audioEnabled = false;

// Five event SFX. Simple and deliberate.
const SFX_FILES: Record<string, string> = {
  birth: '/audio/sfx-birth.mp3',
  death: '/audio/sfx-death.mp3',
  speciation: '/audio/sfx-speciation.mp3',
  extinction: '/audio/sfx-extinction-warning.mp3',
  uiClick: '/audio/sfx-ui-click.mp3',
};

// Single continuous ambient track — no seasonal swaps (user preference)
const AMBIENT_FILE = '/audio/ambient-spring.mp3';

export function initAudio(_config: SimConfig): void {
  document.addEventListener('click', enableAudio, { once: true });
  // 'N' for mute — 'M' is already bound to minimap toggle in renderer.ts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'n' || e.key === 'N') toggleMute();
  });
}

async function enableAudio(): Promise<void> {
  if (initialized) return;
  try {
    audioCtx = new AudioContext();
    // Browsers (esp. mobile/strict) may start the context suspended — explicit resume
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = MASTER_GAIN;
    masterGain.connect(audioCtx.destination);

    for (const [name, path] of Object.entries(SFX_FILES)) {
      try {
        const resp = await fetch(path);
        if (resp.ok) {
          const buf = await audioCtx.decodeAudioData(await resp.arrayBuffer());
          sfxBuffers.set(name, buf);
        }
      } catch { /* missing file — silent degrade */ }
    }

    try {
      const resp = await fetch(AMBIENT_FILE);
      if (resp.ok) {
        const buf = await audioCtx.decodeAudioData(await resp.arrayBuffer());
        const source = audioCtx.createBufferSource();
        source.buffer = buf;
        source.loop = true;
        const gain = audioCtx.createGain();
        gain.gain.value = AMBIENT_GAIN;
        source.connect(gain);
        gain.connect(masterGain!);
        source.start();
        ambientGain = gain;
      }
    } catch { /* missing file — silent degrade */ }

    audioEnabled = ambientGain !== null || sfxBuffers.size > 0;
    initialized = true;
  } catch {
    audioEnabled = false;
  }
}

export function toggleMute(): void {
  if (!masterGain || !audioCtx) return;
  muted = !muted;
  masterGain.gain.setValueAtTime(muted ? 0 : MASTER_GAIN, audioCtx.currentTime);
}

// Resume a suspended AudioContext (hook on visibilitychange / user gestures)
export async function resumeAudio(): Promise<void> {
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') {
    try { await audioCtx.resume(); } catch { /* ignore */ }
  }
}

// Reset per-run audio state across world reset (keeps loaded buffers)
export function resetAudio(): void {
  lastSeenPopulation = -1;
  lastExtinctionTick = -10000;
  sfxLastFired.clear();
}

// Seasonal music change removed — single ambient track plays continuously.
// Kept as a no-op so main.ts doesn't need to change.
export function updateAmbientSeason(_season: Season): void { /* no-op */ }

// Event-batched SFX. Only rare-and-meaningful events punctuate the mix.
export function playTickSfx(
  events: TickEvents,
  population: number,
  _maxPop: number,
  tick: number,
): void {
  if (!audioEnabled) return;

  // Birth: only on meaningful population bursts
  if (events.births > 8) playSfx('birth', clamp01(events.births / 30));
  // Death: only on mass die-off
  if (events.deaths > 12) playSfx('death', clamp01(events.deaths / 40));
  // Speciation: rare, always feels special
  if (events.sexualRepros > 0) playSfx('speciation', 0.6);

  // Extinction edge: healthy → critical transition, with a generous cooldown
  if (
    lastSeenPopulation > 20 && population <= 10
    && tick - lastExtinctionTick > EXTINCTION_COOLDOWN_TICKS
  ) {
    playSfx('extinction', 0.7);
    lastExtinctionTick = tick;
  }
  lastSeenPopulation = population;
}

// UI feedback — bypasses master gain scaling but still respects mute.
export function playUiSfx(): void {
  if (!audioEnabled || !audioCtx || muted) return;
  const buffer = sfxBuffers.get('uiClick');
  if (!buffer) return;
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  const gain = audioCtx.createGain();
  gain.gain.value = UI_CLICK_GAIN;
  source.connect(gain);
  gain.connect(audioCtx.destination);
  source.start();
}

function playSfx(name: string, volume: number): void {
  if (!audioCtx || !masterGain) return;
  const buffer = sfxBuffers.get(name);
  if (!buffer) return;

  // Per-SFX cooldown so sustained events don't machine-gun the same sound
  const now = performance.now();
  const last = sfxLastFired.get(name) ?? 0;
  if (now - last < SFX_COOLDOWN_MS) return;
  sfxLastFired.set(name, now);

  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  const gain = audioCtx.createGain();
  gain.gain.value = volume * SFX_BASE_GAIN;
  source.connect(gain);
  gain.connect(masterGain);
  source.start();
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
