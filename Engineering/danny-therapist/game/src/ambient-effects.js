'use strict';

// ── Scene-specific atmospheric particle effects ───────────────────────────────
// Each scene has its own particle flavour drawn over the world, behind the HUD.
const ambientEffects = (() => {
  let particles = [];
  let sceneId   = '';
  let timer     = 0;

  // Per-scene config: particle type, color, max count, spawn chance per frame
  const SCENE_CFG = {
    asbury: { type: 'firefly', color: '#FFFF88', max: 10, rate: 0.025 },
    beauty: { type: 'wisp',    color: '#E0E0E0', max:  8, rate: 0.018 },
    taxi:   { type: 'exhaust', color: '#AAAAAA', max: 12, rate: 0.030 },
    gotham: { type: 'rain',    color: '#5599CC', max: 45, rate: 0.35  },
    paddys: { type: 'note',    color: '#FFD700', max:  7, rate: 0.016 },
  };

  function setScene(id) {
    sceneId   = id;
    particles = [];
    timer     = 0;
  }

  function update(dt) {
    timer += dt;
    const cfg = SCENE_CFG[sceneId];
    if (!cfg) return;

    // Spawn
    if (Math.random() < cfg.rate * dt && particles.length < cfg.max) {
      particles.push(_spawn(cfg));
    }

    // Update & cull dead particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      // Fireflies oscillate horizontally
      if (p.type === 'firefly') p.x += Math.sin(timer * 0.05 + p.phase) * 0.4;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function _spawn(cfg) {
    if (cfg.type === 'rain') {
      return {
        type: 'rain', color: cfg.color,
        x: Math.random() * (CW + 40) - 20,
        y: -8,
        vx: -0.8, vy: 7 + Math.random() * 3,
        life: 75, maxLife: 75, phase: 0,
      };
    }
    if (cfg.type === 'exhaust') {
      // Spawn near taxi tiles at the bottom half of screen
      return {
        type: 'exhaust', color: cfg.color,
        x: 40 + Math.random() * (CW - 80),
        y: CH * 0.3 + Math.random() * (CH * 0.3),
        vx: (Math.random() - 0.5) * 0.2,
        vy: -(0.4 + Math.random() * 0.5),
        life: 60 + Math.random() * 40, maxLife: 100, phase: Math.random() * 6,
      };
    }
    // Default: float upward from bottom (firefly, wisp, note)
    return {
      type: cfg.type, color: cfg.color,
      x: 20 + Math.random() * (CW - 40),
      y: CH - 40 + Math.random() * 40,
      vx: (Math.random() - 0.5) * 0.25,
      vy: -(0.3 + Math.random() * 0.5),
      life: 100 + Math.random() * 80, maxLife: 180, phase: Math.random() * Math.PI * 2,
    };
  }

  function draw(ctx) {
    if (!particles.length) return;

    ctx.save();
    for (const p of particles) {
      // Fade in/out at start and end of life
      const fadeIn  = Math.min(1, (p.maxLife - p.life) / 25);
      const fadeOut = Math.min(1, p.life / 25);
      const alpha   = fadeIn * fadeOut;

      ctx.globalAlpha = alpha * 0.85;

      switch (p.type) {
        case 'rain': {
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - 2, p.y + 7);
          ctx.stroke();
          break;
        }
        case 'firefly': {
          // Blink on/off with sine — only draw when "on"
          const on = Math.sin(timer * 0.18 + p.phase) > 0.1;
          if (on) {
            ctx.fillStyle = p.color;
            ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
            // Tiny glow halo
            ctx.globalAlpha = alpha * 0.25;
            ctx.fillStyle = '#FFFF99';
            ctx.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 4, 4);
          }
          break;
        }
        case 'wisp': {
          // Tiny floating hair/dust wisps
          ctx.fillStyle = p.color;
          ctx.fillRect(Math.round(p.x),     Math.round(p.y),     2, 1);
          ctx.fillRect(Math.round(p.x) + 3, Math.round(p.y) + 2, 1, 1);
          break;
        }
        case 'exhaust': {
          const r = 2 + (1 - p.life / p.maxLife) * 4; // grows as it ages
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'note': {
          ctx.fillStyle = p.color;
          ctx.font = '10px monospace';
          ctx.textAlign = 'center';
          // Alternate ♪ and ♫
          ctx.fillText(p.phase > Math.PI ? '♪' : '♫', p.x, p.y);
          break;
        }
      }
    }
    ctx.globalAlpha  = 1;
    ctx.textAlign    = 'left';
    ctx.restore();
  }

  return { setScene, update, draw };
})();
