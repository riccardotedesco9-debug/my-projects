// Procedural 16×16 pixel-art sprite system
// 7 creature types, 4 directions × 2 walk frames, DNA palette swap
// Sprites fill most of the cell — minimal transparent border

import type { Pixel } from './types';
import { GENE } from './types';
import { dnaToColor, hueShift } from './color-map';
import { getCreatureRole } from './metabolism';

const T = 16;

// Color zones — replaced with actual RGB during rendering
const _ = 0;  // transparent
const B = 1;  // body
const A = 2;  // accent
const D = 3;  // dark/outline
const E = 4;  // eye
const H = 5;  // highlight/belly
const W = 6;  // white (eye highlight)

type RGB = [number, number, number];
type Palette = Record<number, RGB>;

const cache = new Map<string, OffscreenCanvas>();
let baseTemplates: Map<number, SpriteFrameSet> = new Map();
let initialized = false;

interface SpriteFrameSet {
  frames: Uint8Array[][]; // [direction][frame]
}

function px(...rows: number[][]): Uint8Array {
  const data = new Uint8Array(T * T);
  for (let y = 0; y < rows.length && y < T; y++) {
    for (let x = 0; x < rows[y].length && x < T; x++) {
      data[y * T + x] = rows[y][x];
    }
  }
  return data;
}

// ============================================================
// SPRITE TEMPLATES — filled, chunky, recognizable at small sizes
// ============================================================

// FLOWER (Plant, role 0) — round bloom with stem
function flowerFront(): Uint8Array {
  return px(
    [_,_,_,_,_,D,D,D,D,D,D,_,_,_,_,_],
    [_,_,_,D,D,B,B,A,A,B,B,D,D,_,_,_],
    [_,_,D,B,B,B,A,A,A,A,B,B,B,D,_,_],
    [_,D,B,B,A,A,A,H,H,A,A,A,B,B,D,_],
    [_,D,B,A,A,H,H,H,H,H,H,A,A,B,D,_],
    [D,B,B,A,H,H,A,A,A,A,H,H,A,B,B,D],
    [D,B,A,A,H,A,A,A,A,A,A,H,A,A,B,D],
    [D,B,A,A,H,A,A,A,A,A,A,H,A,A,B,D],
    [D,B,B,A,H,H,A,A,A,A,H,H,A,B,B,D],
    [_,D,B,A,A,H,H,H,H,H,H,A,A,B,D,_],
    [_,D,B,B,A,A,A,D,D,A,A,A,B,B,D,_],
    [_,_,D,B,B,B,D,D,D,D,B,B,B,D,_,_],
    [_,_,_,_,_,_,D,D,D,D,_,_,_,_,_,_],
    [_,_,_,_,_,H,D,D,D,D,H,_,_,_,_,_],
    [_,_,_,_,H,H,_,D,D,_,H,H,_,_,_,_],
    [_,_,_,_,_,_,_,D,D,_,_,_,_,_,_,_],
  );
}
function flowerAlt(): Uint8Array {
  // Sway frame — shifted petals slightly
  return px(
    [_,_,_,_,_,_,D,D,D,D,D,_,_,_,_,_],
    [_,_,_,_,D,D,B,B,A,A,B,D,D,_,_,_],
    [_,_,_,D,B,B,B,A,A,A,B,B,B,D,_,_],
    [_,_,D,B,B,A,A,A,H,A,A,A,B,B,D,_],
    [_,D,B,A,A,H,H,H,H,H,H,A,A,B,D,_],
    [_,D,B,A,H,H,A,A,A,A,H,H,A,B,D,_],
    [D,B,A,A,H,A,A,A,A,A,A,H,A,A,B,D],
    [D,B,A,A,H,A,A,A,A,A,A,H,A,A,B,D],
    [_,D,B,A,H,H,A,A,A,A,H,H,A,B,D,_],
    [_,D,B,A,A,H,H,H,H,H,H,A,A,B,D,_],
    [_,_,D,B,B,A,A,D,D,A,A,B,B,D,_,_],
    [_,_,_,D,B,B,D,D,D,D,B,B,D,_,_,_],
    [_,_,_,_,_,_,D,D,D,D,_,_,_,_,_,_],
    [_,_,_,_,H,H,D,D,D,D,H,_,_,_,_,_],
    [_,_,_,_,_,H,_,D,D,_,H,H,_,_,_,_],
    [_,_,_,_,_,_,_,D,D,_,_,_,_,_,_,_],
  );
}

// WOLF (Hunter, role 1) — stocky canine, pointy ears
function wolfFront(): Uint8Array {
  return px(
    [_,_,_,D,D,_,_,_,_,_,_,D,D,_,_,_],
    [_,_,D,B,B,D,_,_,_,_,D,B,B,D,_,_],
    [_,_,D,B,B,B,D,D,D,D,B,B,B,D,_,_],
    [_,D,B,B,B,B,B,B,B,B,B,B,B,B,D,_],
    [_,D,B,B,E,W,B,B,B,B,W,E,B,B,D,_],
    [_,D,B,B,E,E,B,B,B,B,E,E,B,B,D,_],
    [_,D,B,B,B,B,B,A,A,B,B,B,B,B,D,_],
    [_,_,D,B,B,B,B,B,B,B,B,B,B,D,_,_],
    [_,D,D,B,B,B,B,B,B,B,B,B,B,D,D,_],
    [D,B,B,B,B,H,H,B,B,H,H,B,B,B,B,D],
    [D,B,B,B,B,H,H,B,B,H,H,B,B,B,B,D],
    [_,D,B,B,B,B,B,B,B,B,B,B,B,B,D,_],
    [_,_,D,D,B,B,B,B,B,B,B,B,D,D,_,_],
    [_,_,_,D,B,D,D,_,_,D,D,B,D,_,_,_],
    [_,_,_,D,B,D,_,_,_,_,D,B,D,_,_,_],
    [_,_,_,D,D,D,_,_,_,_,D,D,D,_,_,_],
  );
}
function wolfWalk(): Uint8Array {
  return px(
    [_,_,_,D,D,_,_,_,_,_,_,D,D,_,_,_],
    [_,_,D,B,B,D,_,_,_,_,D,B,B,D,_,_],
    [_,_,D,B,B,B,D,D,D,D,B,B,B,D,_,_],
    [_,D,B,B,B,B,B,B,B,B,B,B,B,B,D,_],
    [_,D,B,B,E,W,B,B,B,B,W,E,B,B,D,_],
    [_,D,B,B,E,E,B,B,B,B,E,E,B,B,D,_],
    [_,D,B,B,B,B,B,A,A,B,B,B,B,B,D,_],
    [_,_,D,B,B,B,B,B,B,B,B,B,B,D,_,_],
    [_,D,D,B,B,B,B,B,B,B,B,B,B,D,D,_],
    [D,B,B,B,B,H,H,B,B,H,H,B,B,B,B,D],
    [D,B,B,B,B,H,H,B,B,H,H,B,B,B,B,D],
    [_,D,B,B,B,B,B,B,B,B,B,B,B,B,D,_],
    [_,_,D,D,B,B,B,B,B,B,B,B,D,D,_,_],
    [_,_,D,B,D,_,_,D,D,_,_,D,B,D,_,_],
    [_,_,D,B,_,_,_,_,_,_,_,_,B,D,_,_],
    [_,_,D,D,_,_,_,_,_,_,_,_,D,D,_,_],
  );
}

// LION (Apex, role 2) — big mane, broad face
function lionFront(): Uint8Array {
  return px(
    [_,_,_,A,A,A,A,A,A,A,A,A,A,_,_,_],
    [_,_,A,A,A,B,B,B,B,B,B,A,A,A,_,_],
    [_,A,A,B,B,B,B,B,B,B,B,B,B,A,A,_],
    [_,A,B,B,B,B,B,B,B,B,B,B,B,B,A,_],
    [A,A,B,B,E,W,B,B,B,B,W,E,B,B,A,A],
    [A,B,B,B,E,E,B,B,B,B,E,E,B,B,B,A],
    [A,B,B,B,B,B,B,A,A,B,B,B,B,B,B,A],
    [_,A,B,B,B,B,B,B,B,B,B,B,B,B,A,_],
    [_,_,D,D,B,B,B,B,B,B,B,B,D,D,_,_],
    [_,D,B,B,B,B,H,H,H,H,B,B,B,B,D,_],
    [D,B,B,B,B,B,H,H,H,H,B,B,B,B,B,D],
    [D,B,B,B,B,B,B,B,B,B,B,B,B,B,B,D],
    [_,D,D,B,B,B,B,B,B,B,B,B,B,D,D,_],
    [_,_,D,B,B,D,D,_,_,D,D,B,B,D,_,_],
    [_,_,D,B,B,D,_,_,_,_,D,B,B,D,_,_],
    [_,_,D,D,D,D,_,_,_,_,D,D,D,D,_,_],
  );
}
function lionWalk(): Uint8Array {
  return px(
    [_,_,_,A,A,A,A,A,A,A,A,A,A,_,_,_],
    [_,_,A,A,A,B,B,B,B,B,B,A,A,A,_,_],
    [_,A,A,B,B,B,B,B,B,B,B,B,B,A,A,_],
    [_,A,B,B,B,B,B,B,B,B,B,B,B,B,A,_],
    [A,A,B,B,E,W,B,B,B,B,W,E,B,B,A,A],
    [A,B,B,B,E,E,B,B,B,B,E,E,B,B,B,A],
    [A,B,B,B,B,B,B,A,A,B,B,B,B,B,B,A],
    [_,A,B,B,B,B,B,B,B,B,B,B,B,B,A,_],
    [_,_,D,D,B,B,B,B,B,B,B,B,D,D,_,_],
    [_,D,B,B,B,B,H,H,H,H,B,B,B,B,D,_],
    [D,B,B,B,B,B,H,H,H,H,B,B,B,B,B,D],
    [D,B,B,B,B,B,B,B,B,B,B,B,B,B,B,D],
    [_,D,D,B,B,B,B,B,B,B,B,B,B,D,D,_],
    [_,_,D,B,D,_,_,D,D,_,_,D,B,D,_,_],
    [_,_,_,D,B,_,_,_,_,_,_,B,D,_,_,_],
    [_,_,_,D,D,_,_,_,_,_,_,D,D,_,_,_],
  );
}

// HYENA (Scavenger, role 3) — hunched, spotted body
function hyenaFront(): Uint8Array {
  return px(
    [_,_,_,_,D,D,_,_,_,_,D,D,_,_,_,_],
    [_,_,_,D,B,B,D,_,_,D,B,B,D,_,_,_],
    [_,_,D,B,B,B,B,D,D,B,B,B,B,D,_,_],
    [_,D,B,B,B,B,B,B,B,B,B,B,B,B,D,_],
    [_,D,B,B,E,W,B,B,B,B,W,E,B,B,D,_],
    [_,D,B,B,E,E,B,B,B,B,E,E,B,B,D,_],
    [_,D,B,B,B,B,B,D,D,B,B,B,B,B,D,_],
    [_,_,D,B,B,B,B,B,B,B,B,B,B,D,_,_],
    [_,D,B,B,A,B,B,B,B,B,B,A,B,B,D,_],
    [D,B,B,B,B,B,H,H,H,H,B,B,B,B,B,D],
    [D,B,A,B,B,B,H,H,H,H,B,B,B,A,B,D],
    [_,D,B,B,B,B,B,B,B,B,B,B,B,B,D,_],
    [_,_,D,D,B,B,B,B,B,B,B,B,D,D,_,_],
    [_,_,_,D,B,D,_,_,_,_,D,B,D,_,_,_],
    [_,_,_,D,B,D,_,_,_,_,D,B,D,_,_,_],
    [_,_,_,D,D,D,_,_,_,_,D,D,D,_,_,_],
  );
}
function hyenaWalk(): Uint8Array {
  return px(
    [_,_,_,_,D,D,_,_,_,_,D,D,_,_,_,_],
    [_,_,_,D,B,B,D,_,_,D,B,B,D,_,_,_],
    [_,_,D,B,B,B,B,D,D,B,B,B,B,D,_,_],
    [_,D,B,B,B,B,B,B,B,B,B,B,B,B,D,_],
    [_,D,B,B,E,W,B,B,B,B,W,E,B,B,D,_],
    [_,D,B,B,E,E,B,B,B,B,E,E,B,B,D,_],
    [_,D,B,B,B,B,B,D,D,B,B,B,B,B,D,_],
    [_,_,D,B,B,B,B,B,B,B,B,B,B,D,_,_],
    [_,D,B,B,A,B,B,B,B,B,B,A,B,B,D,_],
    [D,B,B,B,B,B,H,H,H,H,B,B,B,B,B,D],
    [D,B,A,B,B,B,H,H,H,H,B,B,B,A,B,D],
    [_,D,B,B,B,B,B,B,B,B,B,B,B,B,D,_],
    [_,_,D,D,B,B,B,B,B,B,B,B,D,D,_,_],
    [_,_,D,B,D,_,_,D,D,_,_,D,B,D,_,_],
    [_,_,_,D,B,_,_,_,_,_,_,B,D,_,_,_],
    [_,_,_,D,D,_,_,_,_,_,_,D,D,_,_,_],
  );
}

// TICK (Parasite, role 4) — round bulbous body, small legs
function tickFront(): Uint8Array {
  return px(
    [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
    [_,_,_,_,_,D,D,D,D,D,D,_,_,_,_,_],
    [_,_,_,D,D,B,B,B,B,B,B,D,D,_,_,_],
    [_,_,D,B,B,B,B,B,B,B,B,B,B,D,_,_],
    [_,D,B,B,B,E,W,B,B,W,E,B,B,B,D,_],
    [_,D,B,B,B,E,E,B,B,E,E,B,B,B,D,_],
    [D,B,B,B,B,B,B,A,A,B,B,B,B,B,B,D],
    [D,B,B,B,B,B,B,B,B,B,B,B,B,B,B,D],
    [D,B,B,B,B,B,B,B,B,B,B,B,B,B,B,D],
    [D,B,B,B,B,B,B,B,B,B,B,B,B,B,B,D],
    [_,D,B,B,B,B,B,B,B,B,B,B,B,B,D,_],
    [_,_,D,D,B,B,B,B,B,B,B,B,D,D,_,_],
    [_,_,D,_,D,D,B,B,B,B,D,D,_,D,_,_],
    [_,D,_,_,_,D,D,D,D,D,D,_,_,_,D,_],
    [D,_,_,_,_,_,_,_,_,_,_,_,_,_,_,D],
    [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  );
}
function tickWalk(): Uint8Array {
  return px(
    [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
    [_,_,_,_,_,D,D,D,D,D,D,_,_,_,_,_],
    [_,_,_,D,D,B,B,B,B,B,B,D,D,_,_,_],
    [_,_,D,B,B,B,B,B,B,B,B,B,B,D,_,_],
    [_,D,B,B,B,E,W,B,B,W,E,B,B,B,D,_],
    [_,D,B,B,B,E,E,B,B,E,E,B,B,B,D,_],
    [D,B,B,B,B,B,B,A,A,B,B,B,B,B,B,D],
    [D,B,B,B,B,B,B,B,B,B,B,B,B,B,B,D],
    [D,B,B,B,B,B,B,B,B,B,B,B,B,B,B,D],
    [D,B,B,B,B,B,B,B,B,B,B,B,B,B,B,D],
    [_,D,B,B,B,B,B,B,B,B,B,B,B,B,D,_],
    [_,_,D,D,B,B,B,B,B,B,B,B,D,D,_,_],
    [_,D,_,_,D,D,B,B,B,B,D,D,_,_,D,_],
    [D,_,_,_,_,D,D,D,D,D,D,_,_,_,_,D],
    [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
    [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  );
}

// BEE (Swarm, role 5) — striped, wings
function beeFront(): Uint8Array {
  return px(
    [_,_,_,_,_,_,D,D,D,D,_,_,_,_,_,_],
    [_,_,_,_,_,D,B,B,B,B,D,_,_,_,_,_],
    [_,_,_,_,D,B,E,W,W,E,B,D,_,_,_,_],
    [_,_,_,_,D,B,E,B,B,E,B,D,_,_,_,_],
    [_,_,_,_,D,B,B,B,B,B,B,D,_,_,_,_],
    [_,H,H,D,D,A,A,A,A,A,A,D,D,H,H,_],
    [H,H,H,H,D,B,B,B,B,B,B,D,H,H,H,H],
    [_,H,H,D,D,A,A,A,A,A,A,D,D,H,H,_],
    [_,_,_,_,D,B,B,B,B,B,B,D,_,_,_,_],
    [_,_,_,_,D,A,A,A,A,A,A,D,_,_,_,_],
    [_,_,_,_,D,B,B,B,B,B,B,D,_,_,_,_],
    [_,_,_,_,D,A,A,A,A,A,A,D,_,_,_,_],
    [_,_,_,_,_,D,B,B,B,B,D,_,_,_,_,_],
    [_,_,_,_,_,_,D,D,D,D,_,_,_,_,_,_],
    [_,_,_,_,_,_,_,D,D,_,_,_,_,_,_,_],
    [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  );
}
function beeWalk(): Uint8Array {
  return px(
    [_,_,_,_,_,_,D,D,D,D,_,_,_,_,_,_],
    [_,_,_,_,_,D,B,B,B,B,D,_,_,_,_,_],
    [_,_,_,_,D,B,E,W,W,E,B,D,_,_,_,_],
    [_,_,_,_,D,B,E,B,B,E,B,D,_,_,_,_],
    [_,H,H,_,D,B,B,B,B,B,B,D,_,H,H,_],
    [H,H,H,H,D,A,A,A,A,A,A,D,H,H,H,H],
    [_,H,H,H,D,B,B,B,B,B,B,D,H,H,H,_],
    [_,_,H,H,D,A,A,A,A,A,A,D,H,H,_,_],
    [_,_,_,_,D,B,B,B,B,B,B,D,_,_,_,_],
    [_,_,_,_,D,A,A,A,A,A,A,D,_,_,_,_],
    [_,_,_,_,D,B,B,B,B,B,B,D,_,_,_,_],
    [_,_,_,_,D,A,A,A,A,A,A,D,_,_,_,_],
    [_,_,_,_,_,D,B,B,B,B,D,_,_,_,_,_],
    [_,_,_,_,_,_,D,D,D,D,_,_,_,_,_,_],
    [_,_,_,_,_,_,_,D,D,_,_,_,_,_,_,_],
    [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  );
}

// DEER (Nomad, role 6) — antlers, slender body
function deerFront(): Uint8Array {
  return px(
    [_,_,D,A,_,_,_,_,_,_,_,_,A,D,_,_],
    [_,D,A,D,D,_,_,_,_,_,_,D,D,A,D,_],
    [_,_,_,D,B,D,D,D,D,D,D,B,D,_,_,_],
    [_,_,_,D,B,B,B,B,B,B,B,B,D,_,_,_],
    [_,_,D,B,B,B,B,B,B,B,B,B,B,D,_,_],
    [_,_,D,B,B,E,W,B,B,W,E,B,B,D,_,_],
    [_,_,D,B,B,E,E,B,B,E,E,B,B,D,_,_],
    [_,_,_,D,B,B,B,A,A,B,B,B,D,_,_,_],
    [_,_,_,D,B,B,B,B,B,B,B,B,D,_,_,_],
    [_,_,D,B,B,B,H,H,H,H,B,B,B,D,_,_],
    [_,D,B,B,B,B,H,H,H,H,B,B,B,B,D,_],
    [_,D,B,B,B,B,B,B,B,B,B,B,B,B,D,_],
    [_,_,D,D,B,B,B,B,B,B,B,B,D,D,_,_],
    [_,_,_,D,B,D,_,_,_,_,D,B,D,_,_,_],
    [_,_,_,D,B,D,_,_,_,_,D,B,D,_,_,_],
    [_,_,_,D,D,D,_,_,_,_,D,D,D,_,_,_],
  );
}
function deerWalk(): Uint8Array {
  return px(
    [_,_,D,A,_,_,_,_,_,_,_,_,A,D,_,_],
    [_,D,A,D,D,_,_,_,_,_,_,D,D,A,D,_],
    [_,_,_,D,B,D,D,D,D,D,D,B,D,_,_,_],
    [_,_,_,D,B,B,B,B,B,B,B,B,D,_,_,_],
    [_,_,D,B,B,B,B,B,B,B,B,B,B,D,_,_],
    [_,_,D,B,B,E,W,B,B,W,E,B,B,D,_,_],
    [_,_,D,B,B,E,E,B,B,E,E,B,B,D,_,_],
    [_,_,_,D,B,B,B,A,A,B,B,B,D,_,_,_],
    [_,_,_,D,B,B,B,B,B,B,B,B,D,_,_,_],
    [_,_,D,B,B,B,H,H,H,H,B,B,B,D,_,_],
    [_,D,B,B,B,B,H,H,H,H,B,B,B,B,D,_],
    [_,D,B,B,B,B,B,B,B,B,B,B,B,B,D,_],
    [_,_,D,D,B,B,B,B,B,B,B,B,D,D,_,_],
    [_,_,D,B,D,_,_,D,D,_,_,D,B,D,_,_],
    [_,_,_,D,B,_,_,_,_,_,_,B,D,_,_,_],
    [_,_,_,D,D,_,_,_,_,_,_,D,D,_,_,_],
  );
}

// ============================================================
// Dedicated side-view templates (facing LEFT — mirror for right)
// These give clear directional reads at small sizes
// ============================================================

// Wolf side — body horizontal, snout pointing left, tail right
function wolfSide(): Uint8Array {
  return px(
    [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
    [_,_,_,D,D,_,_,_,_,_,_,_,_,_,_,_],
    [_,_,D,B,B,D,D,D,D,D,D,_,_,_,_,_],
    [_,D,B,E,B,B,B,B,B,B,B,D,_,_,_,_],
    [D,D,B,B,B,B,B,B,B,B,B,B,D,_,_,_],
    [D,A,D,B,B,B,B,B,B,B,B,B,B,D,_,_],
    [_,D,_,D,B,B,B,B,B,B,B,B,B,D,_,_],
    [_,_,_,D,B,B,B,H,H,B,B,B,B,B,D,_],
    [_,_,_,_,D,B,B,H,H,B,B,B,B,B,D,_],
    [_,_,_,_,D,B,B,B,B,B,B,B,B,D,D,D],
    [_,_,_,_,_,D,B,B,B,B,B,B,D,_,D,D],
    [_,_,_,_,_,D,D,_,_,D,D,D,_,_,_,D],
    [_,_,_,_,_,D,B,_,_,B,D,_,_,_,_,_],
    [_,_,_,_,_,D,D,_,_,D,D,_,_,_,_,_],
    [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
    [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  );
}
function wolfSideWalk(): Uint8Array {
  return px(
    [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
    [_,_,_,D,D,_,_,_,_,_,_,_,_,_,_,_],
    [_,_,D,B,B,D,D,D,D,D,D,_,_,_,_,_],
    [_,D,B,E,B,B,B,B,B,B,B,D,_,_,_,_],
    [D,D,B,B,B,B,B,B,B,B,B,B,D,_,_,_],
    [D,A,D,B,B,B,B,B,B,B,B,B,B,D,_,_],
    [_,D,_,D,B,B,B,B,B,B,B,B,B,D,_,_],
    [_,_,_,D,B,B,B,H,H,B,B,B,B,B,D,_],
    [_,_,_,_,D,B,B,H,H,B,B,B,B,B,D,_],
    [_,_,_,_,D,B,B,B,B,B,B,B,B,D,D,D],
    [_,_,_,_,_,D,B,B,B,B,B,B,D,_,D,D],
    [_,_,_,_,D,D,D,_,_,D,D,D,_,_,_,D],
    [_,_,_,_,D,B,_,_,_,_,B,D,_,_,_,_],
    [_,_,_,D,D,_,_,_,_,_,_,D,D,_,_,_],
    [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
    [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  );
}

// Lion side — big mane flowing back, facing left
function lionSide(): Uint8Array {
  return px(
    [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
    [_,_,_,A,A,A,A,A,_,_,_,_,_,_,_,_],
    [_,_,A,A,B,B,B,A,A,A,_,_,_,_,_,_],
    [_,D,A,B,E,B,B,B,A,A,A,_,_,_,_,_],
    [D,D,B,B,B,B,B,B,B,A,A,D,_,_,_,_],
    [D,A,D,B,B,B,B,B,B,B,B,B,D,_,_,_],
    [_,D,_,D,B,B,B,B,B,B,B,B,B,D,_,_],
    [_,_,_,D,B,B,B,H,H,B,B,B,B,B,D,_],
    [_,_,_,_,D,B,B,H,H,H,B,B,B,B,D,_],
    [_,_,_,_,D,B,B,B,B,B,B,B,B,B,D,_],
    [_,_,_,_,_,D,B,B,B,B,B,B,B,D,_,_],
    [_,_,_,_,_,D,D,_,_,D,D,D,_,_,_,_],
    [_,_,_,_,_,D,B,_,_,B,D,_,_,_,_,_],
    [_,_,_,_,_,D,D,_,_,D,D,_,_,_,_,_],
    [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
    [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  );
}
function lionSideWalk(): Uint8Array {
  return px(
    [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
    [_,_,_,A,A,A,A,A,_,_,_,_,_,_,_,_],
    [_,_,A,A,B,B,B,A,A,A,_,_,_,_,_,_],
    [_,D,A,B,E,B,B,B,A,A,A,_,_,_,_,_],
    [D,D,B,B,B,B,B,B,B,A,A,D,_,_,_,_],
    [D,A,D,B,B,B,B,B,B,B,B,B,D,_,_,_],
    [_,D,_,D,B,B,B,B,B,B,B,B,B,D,_,_],
    [_,_,_,D,B,B,B,H,H,B,B,B,B,B,D,_],
    [_,_,_,_,D,B,B,H,H,H,B,B,B,B,D,_],
    [_,_,_,_,D,B,B,B,B,B,B,B,B,B,D,_],
    [_,_,_,_,_,D,B,B,B,B,B,B,B,D,_,_],
    [_,_,_,_,D,D,D,_,_,D,D,D,_,_,_,_],
    [_,_,_,_,D,B,_,_,_,_,B,D,_,_,_,_],
    [_,_,_,D,D,_,_,_,_,_,_,D,D,_,_,_],
    [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
    [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  );
}

// Generic side for smaller creatures (hyena, deer, tick, bee — facing left)
function genericSide(front: Uint8Array): Uint8Array {
  // Shift the entire front view left by 2px and add a "nose" protrusion
  const side = new Uint8Array(T * T);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const srcX = x + 2;
      if (srcX < T) side[y * T + x] = front[y * T + srcX];
    }
  }
  // Remove the right eye (becomes the hidden far eye) — replace with body
  for (let y = 0; y < T; y++) {
    for (let x = T / 2; x < T; x++) {
      if (side[y * T + x] === E || side[y * T + x] === W) side[y * T + x] = B;
    }
  }
  return side;
}

// ============================================================
// Direction & Frame Generation
// ============================================================

function mirrorH(src: Uint8Array): Uint8Array {
  const dst = new Uint8Array(T * T);
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++)
      dst[y * T + x] = src[y * T + (T - 1 - x)];
  return dst;
}

function backView(front: Uint8Array): Uint8Array {
  const back = new Uint8Array(front);
  for (let i = 0; i < T * T; i++) {
    if (back[i] === E || back[i] === W) back[i] = B;
  }
  return back;
}

// Build with dedicated side views for wolves and lions, generic shift for others
function buildFrameSetWithSides(
  frontFn: () => Uint8Array, walkFn: () => Uint8Array,
  sideFn?: () => Uint8Array, sideWalkFn?: () => Uint8Array,
): SpriteFrameSet {
  const front = frontFn();
  const walk = walkFn();
  const back = backView(front);
  const backWalk = backView(walk);

  let left: Uint8Array, leftWalk: Uint8Array;
  if (sideFn && sideWalkFn) {
    left = sideFn();
    leftWalk = sideWalkFn();
  } else {
    left = genericSide(front);
    leftWalk = genericSide(walk);
  }
  const right = mirrorH(left);
  const rightWalk = mirrorH(leftWalk);

  // [down=0, left=1, right=2, up=3]
  return {
    frames: [
      [front, walk],
      [left, leftWalk],
      [right, rightWalk],
      [back, backWalk],
    ],
  };
}

// ============================================================
// Initialization
// ============================================================

export function initSprites(): void {
  cache.clear();
  baseTemplates = new Map();
  // Wolf and Lion get dedicated side-view templates; others use generic shift
  baseTemplates.set(0, buildFrameSetWithSides(flowerFront, flowerAlt));
  baseTemplates.set(1, buildFrameSetWithSides(wolfFront, wolfWalk, wolfSide, wolfSideWalk));
  baseTemplates.set(2, buildFrameSetWithSides(lionFront, lionWalk, lionSide, lionSideWalk));
  baseTemplates.set(3, buildFrameSetWithSides(hyenaFront, hyenaWalk));
  baseTemplates.set(4, buildFrameSetWithSides(tickFront, tickWalk));
  baseTemplates.set(5, buildFrameSetWithSides(beeFront, beeWalk));
  baseTemplates.set(6, buildFrameSetWithSides(deerFront, deerWalk));
  initialized = true;
}

// ============================================================
// Palette & Rendering
// ============================================================

function buildPalette(pixel: Pixel, role: number): Palette {
  const [br, bg, bb] = dnaToColor(pixel.dna, pixel.energy, role);
  const [ar, ag, ab] = hueShift(br, bg, bb, 30);
  return {
    [B]: [br, bg, bb],
    [A]: [ar, ag, ab],
    [D]: [Math.max(0, Math.floor(br * 0.35)), Math.max(0, Math.floor(bg * 0.35)), Math.max(0, Math.floor(bb * 0.35))],
    [E]: [15, 15, 15],
    [H]: [Math.min(255, Math.floor(br * 1.4)), Math.min(255, Math.floor(bg * 1.4)), Math.min(255, Math.floor(bb * 1.4))],
    [W]: [230, 230, 230],
  };
}

function renderToCanvas(data: Uint8Array, palette: Palette): OffscreenCanvas {
  const canvas = new OffscreenCanvas(T, T);
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(T, T);
  const d = img.data;
  for (let i = 0; i < T * T; i++) {
    const zone = data[i];
    if (zone === _) continue;
    const color = palette[zone];
    if (!color) continue;
    const idx = i * 4;
    d[idx] = color[0]; d[idx + 1] = color[1]; d[idx + 2] = color[2]; d[idx + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function paletteHash(pixel: Pixel): number {
  return ((pixel.dna[0] + pixel.dna[1] + pixel.dna[2] + pixel.dna[GENE.REACT_TYPE]
    + pixel.dna[GENE.ARMOR] + pixel.dna[GENE.ADHESION]) >> 2) & 0x3f;
}

export function getSpriteForPixel(pixel: Pixel, direction: number, frame: number): OffscreenCanvas | null {
  if (!initialized) return null;
  const role = getCreatureRole(pixel);
  const ph = paletteHash(pixel);
  const key = `${role}-${direction}-${frame}-${ph}`;

  let sprite = cache.get(key);
  if (sprite) {
    // LRU: move to end
    cache.delete(key);
    cache.set(key, sprite);
    return sprite;
  }

  const tmpl = baseTemplates.get(role);
  if (!tmpl) return null;

  const dir = Math.min(3, Math.max(0, direction));
  const fr = frame & 1;
  const data = tmpl.frames[dir]?.[fr];
  if (!data) return null;

  const palette = buildPalette(pixel, role);
  sprite = renderToCanvas(data, palette);
  cache.set(key, sprite);

  if (cache.size > 800) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }

  return sprite;
}

export function getVariantIndex(pixel: Pixel): number {
  return (pixel.dna[0] + pixel.dna[1] + pixel.dna[2] + pixel.dna[GENE.REACT_TYPE]) % 3;
}
