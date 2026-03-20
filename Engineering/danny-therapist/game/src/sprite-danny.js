'use strict';

// ── Shared palette (used by NPC files too — must load first) ──────────────────
const SKIN  = '#E8A87C';
const SKIN2 = '#C47846';
const HAIR  = '#1A0A00';
const EYE   = '#111111';
const SUIT  = '#5A5A6A';
const SHIRT = '#F0F0F0';
const TIE   = '#CC2222';
const PANTS = '#2A2A2A';
const SHOE  = '#111111';

// ── Danny DeVito player sprite (center-based, ~28×38 px) ─────────────────────
// variant: 'default' | 'penguin' | 'apron' | 'frank'
function drawDanny(ctx, cx, cy, dir, frame, variant = 'default') {
  // Shadow ellipse under Danny
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(Math.round(cx), Math.round(cy) + 14, 11, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  const x = Math.round(cx - 14);
  const y = Math.round(cy - 19);
  if      (dir === DIR.UP)    _dannyBack(ctx, x, y, variant, frame);
  else if (dir === DIR.LEFT)  _dannySide(ctx, x, y, variant, frame, true);
  else if (dir === DIR.RIGHT) _dannySide(ctx, x, y, variant, frame, false);
  else                        _dannyFront(ctx, x, y, variant, frame);
}

function _dannyFront(ctx, x, y, variant, frame) {
  const lw = frame % 2 === 1 ? 2 : 0;
  const suitCol = variant === 'penguin' ? '#111111' : SUIT;
  const tieCol  = variant === 'penguin' ? '#FFD700' : TIE;

  // Penguin top hat
  if (variant === 'penguin') {
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(x + 5, y - 10, 18, 12);
    ctx.fillRect(x + 3, y + 1,  22, 3);
  }

  // Hair (sparse on top, thick on sides — classic DeVito)
  ctx.fillStyle = HAIR;
  ctx.fillRect(x + 7,  y,      14, 3);
  ctx.fillRect(x + 5,  y + 2,  3,  9);
  ctx.fillRect(x + 20, y + 2,  3,  9);

  // Face
  ctx.fillStyle = SKIN;
  ctx.fillRect(x + 7, y + 3, 14, 11);

  // Eyebrows
  ctx.fillStyle = HAIR;
  ctx.fillRect(x + 9,  y + 5, 4, 1);
  ctx.fillRect(x + 15, y + 5, 4, 1);

  // Eyes (wide-set beady)
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(x + 9,  y + 7, 4, 3);
  ctx.fillRect(x + 15, y + 7, 4, 3);
  ctx.fillStyle = EYE;
  ctx.fillRect(x + 10, y + 8, 2, 2);
  ctx.fillRect(x + 16, y + 8, 2, 2);

  // Iconic bulbous nose
  ctx.fillStyle = SKIN2;
  ctx.fillRect(x + 10, y + 10, 8, 3);
  ctx.fillRect(x + 9,  y + 11, 10, 2);

  // Mouth
  ctx.fillStyle = '#994444';
  ctx.fillRect(x + 10, y + 13, 8, 2);

  // Body — suit
  ctx.fillStyle = suitCol;
  ctx.fillRect(x + 6,  y + 16, 16, 12);
  ctx.fillRect(x + 4,  y + 16, 3,  10);
  ctx.fillRect(x + 21, y + 16, 3,  10);

  // Shirt + tie
  ctx.fillStyle = SHIRT;
  ctx.fillRect(x + 11, y + 16, 6, 10);
  ctx.fillStyle = tieCol;
  ctx.fillRect(x + 13, y + 17, 2, 9);

  // Lapels
  ctx.fillStyle = suitCol;
  ctx.fillRect(x + 11, y + 16, 3, 5);
  ctx.fillRect(x + 14, y + 16, 3, 5);

  // Apron overlay
  if (variant === 'apron') {
    ctx.fillStyle = '#EEEEEE';
    ctx.fillRect(x + 10, y + 17, 8, 11);
    ctx.fillStyle = '#DDDDDD';
    ctx.fillRect(x + 12, y + 19, 4, 8);
  }

  // Legs (walk animation)
  ctx.fillStyle = PANTS;
  ctx.fillRect(x + 8 + lw, y + 28, 5, 8);
  ctx.fillRect(x + 15 - lw, y + 28, 5, 8);

  // Shoes
  ctx.fillStyle = SHOE;
  ctx.fillRect(x + 6 + lw,  y + 34, 8, 4);
  ctx.fillRect(x + 14 - lw, y + 34, 8, 4);
}

function _dannyBack(ctx, x, y, variant, frame) {
  const lw = frame % 2 === 1 ? 2 : 0;
  const suitCol = variant === 'penguin' ? '#111111' : SUIT;
  ctx.fillStyle = HAIR;
  ctx.fillRect(x + 7,  y,     14, 12);
  ctx.fillStyle = SKIN;
  ctx.fillRect(x + 9,  y + 9, 10, 4);
  ctx.fillStyle = suitCol;
  ctx.fillRect(x + 6,  y + 13, 16, 13);
  ctx.fillRect(x + 4,  y + 13, 3,  10);
  ctx.fillRect(x + 21, y + 13, 3,  10);
  ctx.fillStyle = PANTS;
  ctx.fillRect(x + 8 + lw,  y + 26, 5, 8);
  ctx.fillRect(x + 15 - lw, y + 26, 5, 8);
  ctx.fillStyle = SHOE;
  ctx.fillRect(x + 6 + lw,  y + 32, 8, 4);
  ctx.fillRect(x + 14 - lw, y + 32, 8, 4);
}

function _dannySide(ctx, x, y, variant, frame, left) {
  const lw  = frame % 2 === 1 ? 2 : 0;
  const nx  = left ? x + 5 : x + 9;
  const eyX = left ? x + 9 : x + 15;
  const suitCol = variant === 'penguin' ? '#111111' : SUIT;

  ctx.fillStyle = HAIR;
  ctx.fillRect(x + 8, y, 12, 4);
  ctx.fillStyle = left ? HAIR : '#00000000';
  ctx.fillRect(x + 5, y + 2, 4, 9);

  ctx.fillStyle = SKIN;
  ctx.fillRect(x + 8, y + 3, 10, 11);
  ctx.fillStyle = SKIN2;
  ctx.fillRect(nx, y + 10, 3, 3);

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(eyX, y + 7, 4, 3);
  ctx.fillStyle = EYE;
  ctx.fillRect(eyX + 1, y + 8, 2, 2);

  ctx.fillStyle = suitCol;
  ctx.fillRect(x + 7, y + 14, 14, 13);
  ctx.fillRect(left ? x + 20 : x + 5, y + 14, 4, 10);

  ctx.fillStyle = SHIRT;
  ctx.fillRect(left ? x + 9 : x + 14, y + 14, 4, 10);

  ctx.fillStyle = PANTS;
  ctx.fillRect(x + 9,       y + 27, 5, 7);
  ctx.fillRect(x + 14, y + 27 + lw, 5, 7);

  ctx.fillStyle = SHOE;
  ctx.fillRect(left ? x + 7 : x + 9, y + 32, 9, 4);
}
