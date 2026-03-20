'use strict';

const engine = (() => {
  let canvas, ctx;
  let state    = STATE.TITLE;
  let keys     = {};
  let lastTime = 0;
  let titleFrame = 0;
  let creditsTimer = 0;

  // Credits lines shown at end
  const CREDITS = [
    "★  DANNY DeVITO: A PIXEL LIFE  ★",
    "",
    "Born: Daniel Michael DeVito Jr.",
    "Asbury Park, New Jersey — November 17, 1944",
    "",
    "★ Career Highlights ★",
    "Taxi (1978-1983) — Louie De Palma",
    "Batman Returns (1992) — The Penguin",
    "It's Always Sunny in Philadelphia — Frank Reynolds",
    "Twins • Throw Momma from the Train",
    "Get Shorty • Matilda • L.A. Confidential",
    "",
    "3× Golden Globe Nominee",
    "Emmy Award Winner",
    "Screen Actors Guild Lifetime Achievement",
    "",
    "\"I'm short. I know I'm short.\"",
    "\"But I punch way above my weight.\"",
    "— Danny DeVito",
    "",
    "♥  Made with love (and a little rum ham)",
    "",
    "Press SPACE to play again",
  ];

  function init() {
    canvas = document.getElementById('game');
    ctx    = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    document.addEventListener('keydown', e => {
      keys[e.code] = true;
      e.preventDefault();
      _onKeyDown(e.code);
    });
    document.addEventListener('keyup', e => { keys[e.code] = false; });

    // Touch support — tap = space
    canvas.addEventListener('click', () => _onKeyDown('Space'));

    audioEngine.init();
    // Title music starts on first user interaction (browser autoplay policy)
    const startAudio = () => {
      audioEngine.playTheme('title');
      document.removeEventListener('keydown', startAudio);
      canvas.removeEventListener('click', startAudio);
    };
    document.addEventListener('keydown', startAudio);
    canvas.addEventListener('click', startAudio);

    requestAnimationFrame(ts => _loop(ts));
  }

  function setState(s) { state = s; }

  function _onKeyDown(code) {
    // Escape: skip/close active dialog without waiting for all lines
    if (code === 'Escape' && state === STATE.DIALOG) {
      dialogSystem.skip();
      if (state === STATE.DIALOG) state = STATE.PLAYING; // only if onDone didn't change state
      return;
    }

    if (code !== 'Space' && code !== 'Enter') return;

    if (state === STATE.TITLE) {
      state = STATE.FADEIN;
      sceneManager.start();
      audioEngine.sfx('next');
      return;
    }
    if (state === STATE.DIALOG) {
      dialogSystem.advance();
      // Guard: onDone() may have changed state to FADEOUT/CREDITS — don't override it
      if (!dialogSystem.isActive() && state === STATE.DIALOG) state = STATE.PLAYING;
      return;
    }
    if (state === STATE.PLAYING) {
      sceneManager.tryInteract();
      return;
    }
    if (state === STATE.CREDITS) {
      _resetToTitle();
      return;
    }
  }

  function _resetToTitle() {
    state       = STATE.TITLE;
    titleFrame  = 0;
    creditsTimer = 0;
    audioEngine.playTheme('title');
  }

  function _loop(timestamp) {
    const raw = timestamp - lastTime;
    lastTime  = timestamp;
    const dt  = Math.min(raw / 16.67, 3); // normalize to 60fps units, cap at 3x

    _update(dt);
    _draw();
    requestAnimationFrame(ts => _loop(ts));
  }

  function _update(dt) {
    titleFrame += dt;

    switch (state) {
      case STATE.PLAYING:
        sceneManager.update(dt);
        player.update(dt, keys, mapRenderer.getData());
        break;
      case STATE.DIALOG:
        dialogSystem.update(dt);
        sceneManager.update(dt);
        break;
      case STATE.FADEOUT:
      case STATE.FADEIN:
        sceneManager.updateFade();
        if (state === STATE.FADEIN || state === STATE.FADEOUT) {
          sceneManager.update(dt);
        }
        break;
      case STATE.CREDITS:
        creditsTimer += dt;
        break;
    }
  }

  function _draw() {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, CW, CH);

    if (state === STATE.TITLE) {
      _drawTitle(ctx);
      return;
    }
    if (state === STATE.CREDITS) {
      _drawCredits(ctx);
      return;
    }

    // World + HUD
    sceneManager.drawWorld(ctx);
    sceneManager.drawHUD(ctx);

    if (state === STATE.DIALOG) dialogSystem.draw(ctx);
    sceneManager.drawFade(ctx);
  }

  // ── Title screen ────────────────────────────────────────────────────────────
  function _drawTitle(ctx) {
    // Gradient sky
    const grad = ctx.createLinearGradient(0, 0, 0, CH);
    grad.addColorStop(0, '#0D1B2A');
    grad.addColorStop(1, '#1A2F4A');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CW, CH);

    // Twinkling stars
    ctx.fillStyle = '#FFFFFF';
    const starSeeds = [
      [42,30],[120,55],[200,20],[310,70],[450,35],[550,18],[600,65],
      [80,90],[160,110],[380,85],[490,100],[620,40],[260,45],[700,80],
    ];
    starSeeds.forEach(([sx, sy]) => {
      const twinkle = Math.sin(titleFrame * 0.05 + sx) > 0.3;
      if (twinkle) ctx.fillRect(sx, sy, 2, 2);
    });

    // Title text
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('DANNY DeVITO', CW / 2, 120);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '18px monospace';
    ctx.fillText('A  P I X E L  L I F E', CW / 2, 152);

    // Danny sprite (large, centered)
    const bobY = Math.sin(titleFrame * 0.04) * 4;
    drawDanny(ctx, CW / 2, CH / 2 + 20 + bobY, DIR.DOWN, Math.floor(titleFrame / 20) % 2, 'default');

    // Subtitle
    ctx.fillStyle = '#AAAAAA';
    ctx.font = '11px monospace';
    ctx.fillText('From Asbury Park to Hollywood', CW / 2, CH / 2 + 80);
    ctx.fillText('Five Lives. One Legend.', CW / 2, CH / 2 + 96);

    // Blinking start prompt
    if (Math.floor(titleFrame / 35) % 2 === 0) {
      ctx.fillStyle = '#FFD700';
      ctx.font = 'bold 14px monospace';
      ctx.fillText('▶  PRESS SPACE TO BEGIN  ◀', CW / 2, CH - 40);
    }

    // Controls hint
    ctx.fillStyle = '#555555';
    ctx.font = '10px monospace';
    ctx.fillText('WASD / Arrows: Move    SPACE / Enter: Interact', CW / 2, CH - 18);
    ctx.textAlign = 'left';
  }

  // ── Credits screen ──────────────────────────────────────────────────────────
  function _drawCredits(ctx) {
    ctx.fillStyle = '#0A0A0A';
    ctx.fillRect(0, 0, CW, CH);

    const scroll = Math.max(0, creditsTimer * 0.4 - 60);
    ctx.save();
    ctx.translate(0, CH - scroll);

    CREDITS.forEach((line, i) => {
      const y = 40 + i * 24;
      if (line.startsWith('★')) {
        ctx.fillStyle = '#FFD700';
        ctx.font = 'bold 16px monospace';
      } else if (line.startsWith('"')) {
        ctx.fillStyle = '#AADDFF';
        ctx.font = 'italic 13px monospace';
      } else if (line === '') {
        return;
      } else {
        ctx.fillStyle = '#CCCCCC';
        ctx.font = '13px monospace';
      }
      ctx.textAlign = 'center';
      ctx.fillText(line, CW / 2, y);
    });

    ctx.restore();
    ctx.textAlign = 'left';

    // Press space hint at bottom
    if (creditsTimer > 80) {
      ctx.fillStyle = 'rgba(255,215,0,0.7)';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('SPACE — Play Again', CW / 2, CH - 12);
      ctx.textAlign = 'left';
    }
  }

  return { init, setState };
})();

// Boot
window.addEventListener('load', () => engine.init());
