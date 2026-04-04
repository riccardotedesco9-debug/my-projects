import type { World, SimConfig, Season } from './types';

export type WeatherType = 'clear' | 'rain' | 'fog' | 'snow' | 'storm' | 'drought' | 'heatwave';

export interface Weather {
  type: WeatherType;
  intensity: number;
  ticksLeft: number;
  particles: WeatherParticle[];
  lightningTimer: number;
  lightningFlash: number;
}

interface WeatherParticle { x: number; y: number; speed: number; size: number; }

const MAX_PARTICLES = 150;

export function createWeather(): Weather {
  return {
    type: 'clear', intensity: 0, ticksLeft: randInt(200, 400),
    particles: [], lightningTimer: 0, lightningFlash: 0,
  };
}

export function updateWeather(weather: Weather, world: World, _config: SimConfig): void {
  weather.ticksLeft--;

  if (weather.ticksLeft <= 0) {
    if (weather.type === 'clear') {
      weather.type = pickWeather(world.season);
      weather.intensity = scaleIntensity(0.3 + Math.random() * 0.7, world, _config);
      weather.ticksLeft = randInt(300, 800);
      spawnParticles(weather, world);
    } else {
      weather.type = 'clear';
      weather.intensity = 0;
      weather.ticksLeft = randInt(500, 1200); // longer clear periods
      weather.particles = [];
    }
  }

  updateParticles(weather, world);

  if (weather.type === 'storm') {
    weather.lightningTimer--;
    if (weather.lightningTimer <= 0) {
      weather.lightningFlash = 1;
      weather.lightningTimer = randInt(40, 100);
    }
  }
  weather.lightningFlash *= 0.82;
}

// Season-appropriate weather selection
function pickWeather(season: Season): WeatherType {
  const r = Math.random();
  switch (season) {
    case 'spring': return r < 0.5 ? 'rain' : r < 0.75 ? 'fog' : 'clear';
    case 'summer': return r < 0.25 ? 'storm' : r < 0.45 ? 'heatwave' : r < 0.6 ? 'drought' : 'clear';
    case 'autumn': return r < 0.35 ? 'fog' : r < 0.6 ? 'rain' : r < 0.75 ? 'drought' : 'clear';
    case 'winter': return r < 0.5 ? 'snow' : r < 0.75 ? 'fog' : r < 0.85 ? 'storm' : 'clear';
  }
}

// Season progress affects intensity (late winter = heavy snow, early spring = light rain)
function scaleIntensity(base: number, world: World, config: SimConfig): number {
  const quarterLen = Math.max(100, config.seasonLength / 4);
  const progress = Math.min(1, world.seasonTick / quarterLen);
  switch (world.season) {
    case 'winter': return base * (0.6 + progress * 0.5);  // builds up
    case 'summer': return base * (0.8 + progress * 0.3);  // intense late
    default: return base;
  }
}

function spawnParticles(weather: Weather, world: World): void {
  if (weather.type === 'drought' || weather.type === 'heatwave' || weather.type === 'fog') {
    weather.particles = []; return; // no particles for these
  }
  const count = Math.floor(MAX_PARTICLES * weather.intensity);
  weather.particles = [];
  const dw = world.width * 5, dh = world.height * 5;
  for (let i = 0; i < count; i++) {
    weather.particles.push({
      x: Math.random() * dw, y: Math.random() * dh,
      speed: weather.type === 'snow' ? 0.3 + Math.random() * 0.5 : 1 + Math.random() * 2,
      size: weather.type === 'snow' ? 1.5 + Math.random() : 0.5 + Math.random() * 0.5,
    });
  }
}

function updateParticles(weather: Weather, world: World): void {
  const dw = world.width * 5, dh = world.height * 5;
  for (const p of weather.particles) {
    if (weather.type === 'snow') {
      p.y += p.speed; p.x += Math.sin(p.y * 0.02) * 0.3;
    } else {
      p.y += p.speed; p.x -= p.speed * 0.3;
    }
    if (p.y > dh) { p.y = 0; p.x = Math.random() * dw; }
    if (p.x < 0) p.x = dw; if (p.x > dw) p.x = 0;
  }
}

// Gameplay modifiers
export function weatherFoodMult(weather: Weather): number {
  switch (weather.type) {
    case 'rain': return 1 + weather.intensity * 0.5;      // rain = green explosion
    case 'storm': return 1 + weather.intensity * 0.2;
    case 'snow': return 1 - weather.intensity * 0.4;       // harsh winters
    case 'drought': return 1 - weather.intensity * 0.6;    // severe food crisis
    case 'heatwave': return 1 - weather.intensity * 0.25;  // noticeable heat damage
    default: return 1;
  }
}

export function weatherDecayMult(weather: Weather): number {
  return weather.type === 'drought' ? 1 + weather.intensity * 1.0 : 1; // drought doubles decay
}

export function weatherSenseMult(weather: Weather): number {
  switch (weather.type) {
    case 'fog': return 1 - weather.intensity * 0.5;
    case 'storm': return 1 - weather.intensity * 0.3;
    default: return 1;
  }
}

export function weatherUpkeepMult(weather: Weather): number {
  return weather.type === 'heatwave' ? 1 + weather.intensity * 0.3 : 1;
}

export function weatherMoveCostMult(weather: Weather): number {
  switch (weather.type) {
    case 'heatwave': return 1 + weather.intensity * 0.2;
    case 'snow': return 1 + weather.intensity * 0.3;
    case 'storm': return 1 + weather.intensity * 0.25;
    default: return 1;
  }
}

// Speed reduction — creatures visibly slow in bad weather
export function weatherSpeedMult(weather: Weather): number {
  switch (weather.type) {
    case 'storm': return Math.max(0.1, 1 - weather.intensity * 0.4);
    case 'snow': return Math.max(0.1, 1 - weather.intensity * 0.3);
    case 'heatwave': return Math.max(0.1, 1 - weather.intensity * 0.15);
    default: return 1;
  }
}

export function getWeatherLabel(weather: Weather): string {
  if (weather.type === 'clear') return 'clear';
  return `${weather.type} (${Math.round(weather.intensity * 100)}%)`;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
