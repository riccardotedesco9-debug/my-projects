import type { SimConfig, Season, TickEvents } from './types';

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let ambientSources: Map<Season, AudioBufferSourceNode> = new Map();
let ambientGains: Map<Season, GainNode> = new Map();
let sfxBuffers: Map<string, AudioBuffer> = new Map();
let currentSeason: Season = 'spring';
let initialized = false;
let audioEnabled = false;

const SFX_FILES: Record<string, string> = {
  birth: '/audio/sfx-birth.mp3',
  death: '/audio/sfx-death.mp3',
  absorb: '/audio/sfx-absorb.mp3',
  share: '/audio/sfx-share.mp3',
  catalyze: '/audio/sfx-catalyze.mp3',
  repel: '/audio/sfx-repel.mp3',
  extinction: '/audio/sfx-extinction-warning.mp3',
  speciation: '/audio/sfx-speciation.mp3',
};

const AMBIENT_FILES: Record<Season, string> = {
  spring: '/audio/ambient-spring.mp3',
  summer: '/audio/ambient-summer.mp3',
  autumn: '/audio/ambient-autumn.mp3',
  winter: '/audio/ambient-winter.mp3',
};

export function initAudio(_config: SimConfig): void {
  // Audio requires user interaction to start (browser policy)
  // We'll initialize on first click
  document.addEventListener('click', enableAudio, { once: true });
}

async function enableAudio(): Promise<void> {
  if (initialized) return;
  try {
    audioCtx = new AudioContext();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.3;
    masterGain.connect(audioCtx.destination);

    // Load SFX
    for (const [name, path] of Object.entries(SFX_FILES)) {
      try {
        const resp = await fetch(path);
        if (resp.ok) {
          const buf = await audioCtx.decodeAudioData(await resp.arrayBuffer());
          sfxBuffers.set(name, buf);
        }
      } catch {
        // Audio file not found — gracefully degrade
      }
    }

    // Load ambient tracks
    for (const [season, path] of Object.entries(AMBIENT_FILES)) {
      try {
        const resp = await fetch(path);
        if (resp.ok) {
          const buf = await audioCtx.decodeAudioData(await resp.arrayBuffer());
          const source = audioCtx.createBufferSource();
          source.buffer = buf;
          source.loop = true;
          const gain = audioCtx.createGain();
          gain.gain.value = season === 'spring' ? 0.2 : 0;
          source.connect(gain);
          gain.connect(masterGain!);
          source.start();
          ambientSources.set(season as Season, source);
          ambientGains.set(season as Season, gain);
        }
      } catch {
        // Ambient file not found — gracefully degrade
      }
    }

    audioEnabled = ambientSources.size > 0 || sfxBuffers.size > 0;
    initialized = true;
  } catch {
    // Web Audio not available
    audioEnabled = false;
  }
}

// Crossfade ambient tracks on season change
export function updateAmbientSeason(season: Season): void {
  if (!audioEnabled || !audioCtx || season === currentSeason) return;
  currentSeason = season;

  const fadeTime = 2; // seconds
  const now = audioCtx.currentTime;

  for (const [s, gain] of ambientGains) {
    if (s === season) {
      gain.gain.linearRampToValueAtTime(0.2, now + fadeTime);
    } else {
      gain.gain.linearRampToValueAtTime(0, now + fadeTime);
    }
  }
}

// Play batched SFX for this tick's events
export function playTickSfx(events: TickEvents, population: number, maxPop: number): void {
  if (!audioEnabled || !audioCtx || !masterGain) return;

  // Scale master volume by population
  const popRatio = Math.min(1, population / Math.max(1, maxPop));
  masterGain.gain.value = 0.1 + popRatio * 0.4;

  // Batched SFX: play at most one of each type per tick
  if (events.births > 0) playSfx('birth', Math.min(1, events.births / 10));
  if (events.deaths > 5) playSfx('death', Math.min(1, events.deaths / 20));
  if (events.absorbs > 0) playSfx('absorb', Math.min(1, events.absorbs / 5));
  if (events.sexualRepros > 0) playSfx('speciation', 0.5);
}

function playSfx(name: string, volume: number): void {
  if (!audioCtx || !masterGain) return;
  const buffer = sfxBuffers.get(name);
  if (!buffer) return;

  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  const gain = audioCtx.createGain();
  gain.gain.value = volume * 0.5;
  source.connect(gain);
  gain.connect(masterGain);
  source.start();
}
