'use strict';

const sceneManager = (() => {
  const SCENES = [
    SCENE_ASBURY,
    SCENE_BEAUTY,
    SCENE_TAXI,
    SCENE_GOTHAM,
    SCENE_PADDYS,
  ];

  let current    = null;
  let sceneIndex = 0;
  let fadeAlpha  = 0;
  let fadeDir    = 0;
  let onFadeDone = null;

  // Transition text shown at scene start
  const INTROS = {
    asbury: "Asbury Park, New Jersey\nSummer, 1955",
    beauty: "Wilkes-Barre Beauty School\nPennsylvania, 1966",
    taxi:   "Sunshine Cab Company\nNew York City, 1978",
    gotham: "Gotham City\nBatman Returns, 1992",
    paddys: "Paddy's Pub\nPhiladelphia, Present Day",
  };
  let introText  = '';
  let introTimer = 0;

  function loadScene(scene) {
    current    = scene;
    const ps   = scene.playerStart;
    player.reset(ps.tx, ps.ty, scene.playerVariant || 'default');
    mapRenderer.load(scene.map, scene.items || []);
    audioEngine.playTheme(scene.music);
    ambientEffects.setScene(scene.id);
    introText  = INTROS[scene.id] || scene.title;
    introTimer = 180;
  }

  function start() {
    sceneIndex = 0;
    _fadeIn(() => loadScene(SCENES[0]));
  }

  function next() {
    sceneIndex++;
    if (sceneIndex >= SCENES.length) {
      engine.setState(STATE.CREDITS);
      return;
    }
    audioEngine.sfx('next');
    _fadeOut(() => {
      loadScene(SCENES[sceneIndex]);
      _fadeIn(null);
    });
  }

  function _fadeOut(cb) {
    fadeAlpha  = 0;
    fadeDir    = 1;
    onFadeDone = cb;
    engine.setState(STATE.FADEOUT);
  }

  function _fadeIn(cb) {
    fadeAlpha  = 1;
    fadeDir    = -1;
    onFadeDone = cb;
    engine.setState(STATE.FADEIN);
  }

  function updateFade() {
    fadeAlpha += fadeDir * 0.035;
    if (fadeDir > 0 && fadeAlpha >= 1) {
      fadeAlpha = 1; fadeDir = 0;
      const cb = onFadeDone; onFadeDone = null;
      if (cb) cb();
    } else if (fadeDir < 0 && fadeAlpha <= 0) {
      fadeAlpha = 0; fadeDir = 0;
      engine.setState(STATE.PLAYING);
      const cb = onFadeDone; onFadeDone = null;
      if (cb) cb();
    }
  }

  function update(dt) {
    if (!current) return;
    mapRenderer.update(dt);
    mapRenderer.checkItemPickup();
    for (const npc of current.npcs) npc.update(dt);
    ambientEffects.update(dt);
    if (introTimer > 0) introTimer -= dt;
  }

  function drawWorld(ctx) {
    if (!current) return;
    const cx = mapRenderer.getCamX();
    const cy = mapRenderer.getCamY();
    mapRenderer.draw(ctx);
    for (const npc of current.npcs) npc.draw(ctx, cx, cy);
    player.draw(ctx, cx, cy);
    // Ambient particles drawn over world, behind HUD
    ambientEffects.draw(ctx);
  }

  function drawHUD(ctx) {
    if (!current) return;

    // Scene title bar
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(0, 0, CW, 26);
    ctx.fillStyle = '#FFD700';
    ctx.font      = 'bold 12px monospace';
    ctx.fillText(current.title, 8, 17);

    // Scene progress dots (top-right)
    for (let i = 0; i < SCENES.length; i++) {
      ctx.fillStyle = i <= sceneIndex ? '#FFD700' : '#333333';
      ctx.fillRect(CW - 14 - (SCENES.length - 1 - i) * 12, 9, 8, 8);
    }

    // Item collection counter (bottom-right)
    const items     = mapRenderer.getItems();
    const collected = items.filter(i => i.collected).length;
    const total     = items.length;
    if (total > 0) {
      const allDone = collected === total;
      ctx.fillStyle = allDone ? '#FFD700' : '#888888';
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      const gems = Array.from({ length: total }, (_, i) => i < collected ? '◆' : '◇').join(' ');
      ctx.fillText(gems, CW - 8, CH - 8);
      ctx.textAlign = 'left';
    }

    // Scene intro text overlay
    if (introTimer > 0) {
      const alpha = Math.min(1, introTimer / 40);
      ctx.fillStyle = `rgba(0,0,0,${alpha * 0.7})`;
      ctx.fillRect(0, CH / 2 - 50, CW, 100);
      ctx.fillStyle = `rgba(255,215,0,${alpha})`;
      ctx.font = 'bold 20px monospace';
      ctx.textAlign = 'center';
      const lines = introText.split('\n');
      lines.forEach((l, i) => ctx.fillText(l, CW / 2, CH / 2 - 10 + i * 28));
      ctx.textAlign = 'left';
    }

    // Controls hint (first scene only, while intro showing)
    if (introTimer > 0 && sceneIndex === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = '10px monospace';
      ctx.fillText('WASD / Arrows: Move    SPACE / Enter: Talk', 8, CH - 8);
    }
  }

  function drawFade(ctx) {
    if (fadeAlpha <= 0) return;
    ctx.fillStyle = `rgba(0,0,0,${fadeAlpha})`;
    ctx.fillRect(0, 0, CW, CH);
  }

  function tryInteract() {
    if (!current) return;
    const { x: px, y: py } = player.getPos();
    for (const npc of current.npcs) {
      if (npc.isNearPlayer(px, py)) {
        const isExit = npc.isExit;
        dialogSystem.start(
          { lines: npc.dialog, speaker: npc.speaker, portrait: npc.portrait || npc.type },
          () => {
            if (npc.onInteract) npc.onInteract();
            if (isExit) next();
          }
        );
        engine.setState(STATE.DIALOG);
        audioEngine.sfx('interact');
        return;
      }
    }
  }

  function getCurrent() { return current; }

  return { start, next, update, drawWorld, drawHUD, drawFade, updateFade, tryInteract, getCurrent };
})();
