'use strict';

// ── Dialog box — supports two speakers: NPC and Danny ────────────────────────
// Line items can be:
//   string             → NPC speaks with their configured speaker/portrait
//   {s:'danny',t,a}   → Danny speaks; shows real photo, plays ElevenLabs audio
const dialogSystem = (() => {
  let lines     = [];
  let lineIdx   = 0;
  let charIdx   = 0;
  let timer     = 0;
  let npcSpeaker  = '';
  let npcPortrait = '';
  let onDone    = null;
  let active    = false;
  let _audio    = null;   // currently playing Danny audio element

  const CHAR_SPEED = 1.5;
  const BOX_H      = 110;
  const BOX_Y      = CH - BOX_H - 8;
  const PAD        = 14;

  // ── Danny's real photo — lazy-loaded; falls back to pixel sprite ──────────
  const dannyPhoto = new Image();
  let photoReady   = false;
  dannyPhoto.onload = () => { photoReady = true; };
  dannyPhoto.onerror = () => { photoReady = false; };
  dannyPhoto.src = 'assets/danny-real.jpg';

  // ── Line helpers ──────────────────────────────────────────────────────────
  function _isDanny(idx)    { const l = lines[idx]; return l && typeof l === 'object' && l.s === 'danny'; }
  function _getText(idx)    { const l = lines[idx]; return l ? (typeof l === 'string' ? l : l.t) : ''; }
  function _getAudioKey(idx){ const l = lines[idx]; return (l && typeof l === 'object') ? (l.a || null) : null; }

  function _playAudio(audioKey) {
    if (_audio) { _audio.pause(); _audio = null; }
    if (!audioKey) return;
    const a = new Audio(`assets/audio/${audioKey}.mp3`);
    a.volume = 0.85;
    a.play().catch(() => {});   // silent fallback if file missing or autoplay blocked
    _audio = a;
  }

  function _stopAudio() {
    if (_audio) { _audio.pause(); _audio = null; }
  }

  // ── Public API ────────────────────────────────────────────────────────────
  function start(config, callback) {
    lines       = config.lines;
    npcSpeaker  = config.speaker  || 'Danny DeVito';
    npcPortrait = config.portrait || 'danny';
    onDone      = callback || null;
    lineIdx     = 0;
    charIdx     = 0;
    timer       = 0;
    active      = true;
    audioEngine.duck();  // dim music during dialog
    // Play audio for first line if it's Danny's
    _playAudio(_getAudioKey(0));
    audioEngine.sfx('dialog-npc');
  }

  function isActive() { return active; }

  function update(dt) {
    if (!active) return;
    timer += CHAR_SPEED * dt;
    const full = _getText(lineIdx);
    if (timer >= full.length) {
      charIdx = full.length;
    } else {
      const prev = Math.floor(charIdx);
      charIdx = Math.min(Math.floor(timer), full.length);
      if (Math.floor(charIdx) > prev && charIdx % 2 === 0) {
      audioEngine.sfx(_isDanny(lineIdx) ? 'dialog-danny' : 'dialog-npc');
    }
    }
  }

  function advance() {
    if (!active) return;
    const full = _getText(lineIdx);
    // First press: skip typewriter
    if (charIdx < full.length) {
      charIdx = full.length;
      timer   = full.length;
      return;
    }
    // Second press: next line
    lineIdx++;
    charIdx = 0;
    timer   = 0;
    if (lineIdx >= lines.length) {
      active = false;
      _stopAudio();
      audioEngine.unduck();
      if (onDone) onDone();
    } else {
      _playAudio(_getAudioKey(lineIdx));
      audioEngine.sfx(_isDanny(lineIdx) ? 'dialog-danny' : 'dialog-npc');
    }
  }

  function draw(ctx) {
    if (!active) return;

    const isDanny   = _isDanny(lineIdx);
    const speakerName = isDanny ? 'Danny DeVito' : npcSpeaker;

    // Dimmed overlay
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, CW, CH);

    // Dialog box
    ctx.fillStyle = '#1A0E08';
    ctx.fillRect(8, BOX_Y, CW - 16, BOX_H);
    ctx.strokeStyle = isDanny ? '#FF9944' : '#FFD700';  // orange tint when Danny speaks
    ctx.lineWidth = 2;
    ctx.strokeRect(8, BOX_Y, CW - 16, BOX_H);

    // Portrait box
    const portW = 72;
    ctx.fillStyle = '#2C1808';
    ctx.fillRect(14, BOX_Y + 8, portW, portW);
    ctx.strokeStyle = isDanny ? '#CC6633' : '#AA7700';
    ctx.lineWidth = 1;
    ctx.strokeRect(14, BOX_Y + 8, portW, portW);

    // Portrait — real photo for Danny, sprite for NPCs
    const pcx = 14 + portW / 2;
    const pcy = BOX_Y + 8 + portW / 2 + 4;
    if (isDanny && photoReady) {
      // Real photo: draw with smoothing on so it doesn't look blocky
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      // Clip to portrait box so photo doesn't overflow
      ctx.beginPath();
      ctx.rect(14, BOX_Y + 8, portW, portW);
      ctx.clip();
      ctx.drawImage(dannyPhoto, 14, BOX_Y + 8, portW, portW);
      ctx.restore();
    } else if (isDanny) {
      // Photo not loaded yet — pixel Danny fallback
      drawDanny(ctx, pcx, pcy, DIR.DOWN, 0, 'default');
    } else {
      drawNPC(ctx, pcx, pcy, npcPortrait);
    }

    // Speaker name
    ctx.fillStyle = isDanny ? '#FF9944' : '#FFD700';
    ctx.font = 'bold 13px monospace';
    ctx.fillText(speakerName, 94, BOX_Y + 22);

    // Dialog text (typewriter)
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '12px monospace';
    const text  = _getText(lineIdx).slice(0, Math.floor(charIdx));
    const maxW  = CW - 16 - 94 - PAD - 8;
    const words = text.split(' ');
    let row = 0, line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, 94, BOX_Y + 40 + row * 17);
        row++; line = word;
      } else { line = test; }
    }
    if (line) ctx.fillText(line, 94, BOX_Y + 40 + row * 17);

    // Continue prompt
    if (charIdx >= _getText(lineIdx).length) {
      const blink = Math.floor(Date.now() / 400) % 2 === 0;
      if (blink) {
        ctx.fillStyle = isDanny ? '#FF9944' : '#FFD700';
        ctx.font = '11px monospace';
        const more = lineIdx < lines.length - 1 ? '▼ SPACE' : '✓ SPACE';
        ctx.fillText(more, CW - 80, BOX_Y + BOX_H - 8);
      }
    }

    // Line progress dots
    for (let i = 0; i < lines.length; i++) {
      ctx.fillStyle = i <= lineIdx ? (_isDanny(i) ? '#FF9944' : '#FFD700') : '#555555';
      ctx.fillRect(14 + i * 8, BOX_Y + BOX_H - 10, 5, 5);
    }
  }

  // Immediately close dialog (Escape key) — still fires onDone so story advances
  function skip() {
    if (!active) return;
    active = false;
    _stopAudio();
    audioEngine.unduck();
    if (onDone) onDone();
  }

  return { start, isActive, update, advance, skip, draw };
})();
