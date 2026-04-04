// Visual effects: birth rings, death scatter, interaction particles
// Ring buffer approach — fixed-size, no allocation during gameplay

interface BirthEffect {
  x: number; y: number;
  r: number; g: number; b: number;
  age: number;
}

interface DeathParticle {
  x: number; y: number;
  dx: number; dy: number;
  age: number;
}

// Interaction effects for creature-to-creature and creature-to-environment
interface InteractionEffect {
  x: number; y: number;
  type: 'absorb' | 'share' | 'catalyze' | 'repel' | 'feed' | 'sexual';
  r: number; g: number; b: number;
  age: number;
}

const MAX_BIRTHS = 60;
const MAX_DEATHS = 80;
const MAX_INTERACTIONS = 100;
const BIRTH_LIFETIME = 6;
const DEATH_LIFETIME = 5;
const INTERACTION_LIFETIME = 8;

const births: BirthEffect[] = [];
const deaths: DeathParticle[] = [];
const interactions: InteractionEffect[] = [];
let birthHead = 0;
let deathHead = 0;
let interactionHead = 0;

export function addBirthEffect(x: number, y: number, r: number, g: number, b: number): void {
  if (births.length < MAX_BIRTHS) {
    births.push({ x, y, r, g, b, age: 0 });
  } else {
    births[birthHead] = { x, y, r, g, b, age: 0 };
  }
  birthHead = (birthHead + 1) % MAX_BIRTHS;
}

export function addDeathEffect(x: number, y: number): void {
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2 + Math.random() * 0.5;
    const speed = 1.5 + Math.random() * 2;
    const particle: DeathParticle = {
      x, y,
      dx: Math.cos(angle) * speed,
      dy: Math.sin(angle) * speed,
      age: 0,
    };
    if (deaths.length < MAX_DEATHS) {
      deaths.push(particle);
    } else {
      deaths[deathHead] = particle;
    }
    deathHead = (deathHead + 1) % MAX_DEATHS;
  }
}

export function addInteractionEffect(
  x: number, y: number,
  type: InteractionEffect['type'],
  r = 255, g = 255, b = 255,
): void {
  const effect: InteractionEffect = { x, y, type, r, g, b, age: 0 };
  if (interactions.length < MAX_INTERACTIONS) {
    interactions.push(effect);
  } else {
    interactions[interactionHead] = effect;
  }
  interactionHead = (interactionHead + 1) % MAX_INTERACTIONS;
}

export function toCanvasCenter(gx: number, gy: number, scale: number): [number, number] {
  return [gx * scale + scale / 2, gy * scale + scale / 2];
}

export function renderEffects(ctx: CanvasRenderingContext2D): void {
  // Birth effects — heart + ring
  for (const b of births) {
    if (b.age >= BIRTH_LIFETIME) continue;
    const t = b.age / BIRTH_LIFETIME;
    const alpha = 0.6 * (1 - t);

    // Expanding ring
    const radius = 3 + t * 8;
    ctx.strokeStyle = `rgba(${b.r},${b.g},${b.b},${alpha})`;
    ctx.lineWidth = 1.5 * (1 - t);
    ctx.beginPath();
    ctx.arc(b.x, b.y, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Rising heart
    const heartY = b.y - t * 6;
    const heartSize = 1.5 * (1 - t * 0.5);
    ctx.fillStyle = `rgba(255,120,180,${alpha})`;
    ctx.beginPath();
    ctx.moveTo(b.x, heartY + heartSize);
    ctx.bezierCurveTo(b.x - heartSize, heartY - heartSize * 0.5, b.x - heartSize * 2, heartY + heartSize * 0.5, b.x, heartY + heartSize * 2);
    ctx.bezierCurveTo(b.x + heartSize * 2, heartY + heartSize * 0.5, b.x + heartSize, heartY - heartSize * 0.5, b.x, heartY + heartSize);
    ctx.fill();

    b.age++;
  }

  // Death scatter — brown/red particles flying outward
  for (const d of deaths) {
    if (d.age >= DEATH_LIFETIME) continue;
    const t = d.age / DEATH_LIFETIME;
    const alpha = 0.6 * (1 - t);
    const size = 1.5 * (1 - t * 0.5);
    ctx.fillStyle = `rgba(180,60,30,${alpha})`;
    ctx.fillRect(d.x - size / 2, d.y - size / 2, size, size);
    d.x += d.dx;
    d.y += d.dy;
    d.dy += 0.3;
    d.age++;
  }

  // Interaction effects
  for (const fx of interactions) {
    if (fx.age >= INTERACTION_LIFETIME) continue;
    const t = fx.age / INTERACTION_LIFETIME;

    switch (fx.type) {
      case 'absorb': {
        // Red slash marks — two crossing lines that fade
        const alpha = 0.8 * (1 - t);
        const len = 2 + t * 4;
        ctx.strokeStyle = `rgba(255,60,40,${alpha})`;
        ctx.lineWidth = 1.5 * (1 - t * 0.5);
        ctx.beginPath();
        ctx.moveTo(fx.x - len, fx.y - len);
        ctx.lineTo(fx.x + len, fx.y + len);
        ctx.moveTo(fx.x + len, fx.y - len);
        ctx.lineTo(fx.x - len, fx.y + len);
        ctx.stroke();
        break;
      }
      case 'share': {
        // Blue-green pulsing ring — cooperative energy share
        const alpha = 0.5 * (1 - t);
        const radius = 2 + t * 5;
        ctx.strokeStyle = `rgba(80,200,180,${alpha})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        // Small energy dots spiraling inward
        if (t < 0.5) {
          const dotAngle = t * Math.PI * 4;
          const dotR = radius * (1 - t * 2);
          ctx.fillStyle = `rgba(100,255,200,${alpha * 1.5})`;
          ctx.beginPath();
          ctx.arc(fx.x + Math.cos(dotAngle) * dotR, fx.y + Math.sin(dotAngle) * dotR, 1, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'catalyze': {
        // Purple sparkle burst — parasite catalyzing host
        const alpha = 0.7 * (1 - t);
        const numSparks = 4;
        ctx.fillStyle = `rgba(180,80,255,${alpha})`;
        for (let i = 0; i < numSparks; i++) {
          const angle = (i / numSparks) * Math.PI * 2 + t * 2;
          const dist = 1 + t * 5;
          const sx = fx.x + Math.cos(angle) * dist;
          const sy = fx.y + Math.sin(angle) * dist;
          const sparkSize = 1.2 * (1 - t);
          ctx.fillRect(sx - sparkSize / 2, sy - sparkSize / 2, sparkSize, sparkSize);
        }
        break;
      }
      case 'repel': {
        // Yellow-orange burst — outward push wave
        const alpha = 0.6 * (1 - t);
        const radius = 1 + t * 7;
        ctx.strokeStyle = `rgba(255,200,60,${alpha})`;
        ctx.lineWidth = 2 * (1 - t);
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'feed': {
        // Small green dots floating up — food absorption
        const alpha = 0.6 * (1 - t);
        ctx.fillStyle = `rgba(60,220,80,${alpha})`;
        for (let i = 0; i < 3; i++) {
          const offsetX = (i - 1) * 1.5;
          const offsetY = -t * 4 - i * 0.8;
          ctx.beginPath();
          ctx.arc(fx.x + offsetX, fx.y + offsetY, 0.7, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'sexual': {
        // Pink hearts / double ring — mating
        const alpha = 0.6 * (1 - t);
        const r1 = 2 + t * 4;
        const r2 = 3 + t * 6;
        ctx.strokeStyle = `rgba(255,120,180,${alpha})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, r1, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = `rgba(255,80,150,${alpha * 0.6})`;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, r2, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
    }
    fx.age++;
  }
}
