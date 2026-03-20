'use strict';

// Multi-track chiptune engine — melody + bass + harmony loops per scene
const audioEngine = (() => {
  let ctx       = null;
  let gainNode  = null;  // music — gets ducked during dialog
  let sfxGain   = null;  // sfx — always audible, never ducked
  let cancelFns = [];    // one cancel fn per active track loop
  let stepFoot  = 0;

  function init() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    gainNode = ctx.createGain();
    gainNode.gain.value = 0;
    gainNode.connect(ctx.destination);
    // Separate sfx bus — bypasses duck/unduck so dialog ticks are always heard
    sfxGain = ctx.createGain();
    sfxGain.gain.value = 0.9;
    sfxGain.connect(ctx.destination);
  }

  // useSfx=true routes through sfxGain (not affected by duck); default false = music bus
  function note(freq, startTime, duration, vol = 0.3, type = 'square', useSfx = false) {
    if (!ctx || freq <= 0) return;
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    osc.connect(gain);
    gain.connect(useSfx ? sfxGain : gainNode);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.01);
  }

  // Loop a single track indefinitely; returns a cancel function
  function loopTrack({ notes, vol = 0.25, type = 'square' }) {
    let active = true;
    let timer  = null;
    const dur  = notes.reduce((s, [, d]) => s + d, 0);
    function play() {
      if (!active) return;
      let t = ctx.currentTime + 0.05;
      for (const [f, d] of notes) { if (f > 0) note(f, t, d * 0.84, vol, type); t += d; }
      timer = setTimeout(play, dur * 1000 + 50);
    }
    play();
    return () => { active = false; clearTimeout(timer); };
  }

  // ── Timing constants at ~150 bpm ──────────────────────────────────────────
  const B = 0.2, Q = 0.4, H = 0.8;   // 8th, quarter, half
  const J = 0.133;                     // jig 8th (~188 bpm)

  // ── Themes: array of track configs {notes, vol, type} ─────────────────────
  // Melody = square  |  Bass = triangle  |  Harmony = sine/sawtooth
  //
  // Note frequencies (A4=440):
  //   G2=98  A2=110  B2=123  C3=131  D3=147  E3=165  F3=175  F#3=185  G3=196  A3=220  B3=247
  //   C4=262 D4=294  E4=330  F4=349  F#4=370 G4=392  A4=440  Bb4=466  B4=494
  //   C5=523 D5=587  Eb5=622 E5=659  F5=698  F#5=740 G5=784  A5=880   B5=988  C6=1047
  const THEMES = {

    // Title — C major fanfare, triumphant
    title: [
      { notes: [[523,B],[659,B],[784,B],[0,B], [784,B*3],[698,B],[659,B*3],[0,B],
                [523,B],[659,B],[784,B],[1047,H],[0,H],
                [880,B],[784,B],[698,B],[659,B*3],[0,B],
                [523,B],[659,B],[784,B*3],[0,B],[880,B],[784,B],[659,B],[523,H],[0,H]],
        vol:0.26, type:'square' },
      { notes: [[131,H],[131,H],[175,H],[175,H],[131,H],[131,H],[196,H],[0,H],
                [220,H],[220,H],[175,H],[175,H],[131,H],[131,H],[131,H],[0,H]],
        vol:0.15, type:'triangle' },
      { notes: [[330,H],[349,H],[330,H],[330,H],[440,H],[440,H],[349,H],[330,H]],
        vol:0.07, type:'sine' },
    ],

    // Asbury Park — G major, sunny Jersey boardwalk, walking bass
    asbury: [
      { notes: [[392,B],[440,B],[494,B],[587,B], [659,B],[587,B],[494,B],[440,B],
                [392,B],[440,B],[523,B],[494,B], [440,Q],[392,Q],
                [587,B],[659,B],[587,B],[494,B], [440,B],[494,B],[440,B],[392,B],
                [330,B],[392,B],[440,B],[494,B], [440,Q],[392,Q]],
        vol:0.24, type:'square' },
      { notes: [[196,Q],[196,Q],[165,Q],[165,Q],[131,Q],[131,Q],[147,Q],[147,Q],
                [147,Q],[147,Q],[220,Q],[220,Q],[165,Q],[165,Q],[196,Q],[196,Q]],
        vol:0.16, type:'triangle' },
      { notes: [[494,H],[330,H],[523,H],[494,H],[587,H],[440,H],[494,H],[392,H]],
        vol:0.06, type:'sine' },
    ],

    // Beauty School — C major, quirky/playful with staccato harmony
    beauty: [
      { notes: [[523,B],[659,B],[784,B],[659,B], [698,B],[659,B],[587,B],[523,B],
                [659,B],[587,B],[523,B],[494,B], [523,Q],[0,Q],
                [392,B],[440,B],[494,B],[523,B], [587,B],[659,B],[587,B],[523,B],
                [494,B],[392,B],[440,B],[494,B], [523,H]],
        vol:0.24, type:'square' },
      { notes: [[131,Q],[131,Q],[175,Q],[175,Q],[196,Q],[196,Q],[131,Q],[0,Q],
                [131,Q],[131,Q],[196,Q],[196,Q],[175,Q],[196,Q],[131,H]],
        vol:0.15, type:'triangle' },
      { notes: [[330,B],[0,B*3],[349,B],[0,B*3],[330,B],[0,B*3],[262,B],[0,B*3],
                [330,B],[0,B*3],[392,B],[0,B*3],[330,B],[0,B*7]],
        vol:0.09, type:'sine' },
    ],

    // Taxi Depot — A minor, gritty urban drive, staccato bass
    taxi: [
      { notes: [[440,B],[523,B],[659,B],[880,B], [784,B],[659,B],[523,B],[440,B],
                [349,B],[392,B],[440,B],[523,B], [659,Q],[494,Q],
                [440,B],[659,B],[587,B],[523,B], [494,B],[440,B],[392,B],[349,B],
                [330,B],[349,B],[392,B],[440,B], [494,Q],[440,Q]],
        vol:0.22, type:'square' },
      { notes: [[110,B],[0,B],[110,B],[0,B],[131,B],[0,B],[131,B],[0,B],
                [175,B],[0,B],[175,B],[0,B],[165,B],[0,B],[165,B],[0,B],
                [110,B],[0,B],[110,B],[0,B],[147,B],[0,B],[147,B],[0,B],
                [165,B],[0,B],[165,B],[0,B],[110,B],[0,B*3]],
        vol:0.19, type:'triangle' },
      { notes: [[220,B*3],[0,B],[262,B*3],[0,B],[175,B*3],[0,B],[165,B*3],[0,B],
                [220,B*3],[0,B],[147,B*3],[0,B],[165,B*3],[0,B],[220,B*3],[0,B]],
        vol:0.07, type:'sawtooth' },
    ],

    // Gotham City — D minor, ominous & cinematic, slow with low drone
    gotham: [
      { notes: [[587,0.45],[523,0.45],[466,0.45],[440,0.45],
                [392,0.45],[349,0.45],[330,0.45],[0,0.45],
                [349,0.45],[392,0.45],[440,0.45],[466,0.45],[440,0.9],[0,0.9],
                [587,0.3],[622,0.3],[587,0.3],[523,0.3],[466,0.3],[440,0.3],
                [392,0.45],[349,0.45],[330,0.3],[349,0.3],[392,0.3],[440,0.3],
                [587,0.9],[0,0.9]],
        vol:0.20, type:'square' },
      { notes: [[147,0.9],[110,0.9],[116,0.9],[87,0.9],
                [98,0.9],[147,0.9],[110,1.8],
                [147,0.9],[131,0.9],[116,0.9],[110,0.9],[147,1.8]],
        vol:0.19, type:'triangle' },
      // Slow droning low note — the ominous heartbeat
      { notes: [[73,3.6],[55,3.6],[65,3.6],[73,3.6]],
        vol:0.05, type:'sine' },
    ],

    // Paddy's Pub — E minor Irish jig, fast 6/8, rowdy & chaotic
    pub: [
      { notes: [[659,J],[740,J],[784,J],[880,J],[988,J],[880,J],
                [784,J],[659,J],[0,J*2],[494,J],[587,J],[659,J],
                [740,J],[880,J],[0,J],[784,J],[988,J],[0,J],
                [880,J*3],[659,J*3],
                [659,J],[740,J],[784,J],[880,J],[988,J],[784,J],
                [740,J],[587,J],[0,J],[659,J],[740,J],[784,J],
                [880,J],[988,J],[880,J],[784,J],[740,J],[659,J],
                [587,J*3],[659,J*3]],
        vol:0.25, type:'square' },
      { notes: [[165,J*3],[0,J*3],[247,J*3],[0,J*3],
                [185,J*3],[0,J*3],[165,J*6],
                [165,J*3],[0,J*3],[147,J*3],[0,J*3],
                [165,J*3],[0,J*3],[165,J*6]],
        vol:0.18, type:'triangle' },
      { notes: [[247,J*3],[330,J*3],[294,J*3],[247,J*3],
                [247,J*3],[330,J*3],[294,J*6],
                [247,J*3],[330,J*3],[294,J*3],[247,J*3],
                [294,J*3],[247,J*3],[247,J*6]],
        vol:0.07, type:'sine' },
    ],
  };

  function playTheme(name) {
    if (!ctx) init();
    stopTheme();
    const tracks = THEMES[name];
    if (!tracks) return;
    // Fade in so the music doesn't blare on scene load
    gainNode.gain.cancelScheduledValues(ctx.currentTime);
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.7);
    cancelFns = tracks.map(loopTrack);
  }

  // Duck during dialog, restore after
  function duck() {
    if (!ctx) return;
    gainNode.gain.cancelScheduledValues(ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.03, ctx.currentTime + 0.3);
  }
  function unduck() {
    if (!ctx) return;
    gainNode.gain.cancelScheduledValues(ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.6);
  }

  function stopTheme() {
    cancelFns.forEach(fn => fn());
    cancelFns = [];
  }

  // ── Sound effects — all routed through sfxGain so duck doesn't silence them ──
  function sfx(type) {
    if (!ctx) init();
    const t = ctx.currentTime;
    switch (type) {
      case 'interact':
        note(880,  t,      0.08, 0.35, 'square', true);
        note(1100, t+0.08, 0.08, 0.35, 'square', true);
        break;
      case 'collect':
        note(660,  t,      0.06, 0.45, 'square', true);
        note(880,  t+0.06, 0.06, 0.45, 'square', true);
        note(1100, t+0.12, 0.08, 0.45, 'square', true);
        note(1320, t+0.20, 0.14, 0.40, 'square', true);
        break;
      case 'step': {
        const freq = stepFoot ? 95 : 115;
        stepFoot = 1 - stepFoot;
        note(freq, t, 0.04, 0.07, 'square', true);
        break;
      }
      case 'next':
        [523, 659, 784, 1047].forEach((f, i) => note(f, t + i * 0.1, 0.12, 0.35, 'square', true));
        break;
      // NPC dialog tick — plays through sfxGain so it's audible even with ducked music
      case 'dialog':
      case 'dialog-npc':
        note(420 + Math.random() * 160, t, 0.045, 0.22, 'square', true);
        break;
      // Danny's dialog tick — lower, gruffer, sine for warmth
      case 'dialog-danny':
        note(240 + Math.random() * 80, t, 0.055, 0.25, 'sine', true);
        break;
      case 'bump':
        note(120, t, 0.06, 0.14, 'sine', true);
        break;
    }
  }

  return { init, playTheme, stopTheme, sfx, duck, unduck };
})();
