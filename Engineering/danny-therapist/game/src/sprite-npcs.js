'use strict';

// ── NPC sprites (center-based, ~24×32 px) ────────────────────────────────────
// dir: DIR.DOWN | DIR.LEFT | DIR.RIGHT | DIR.UP  (default DOWN)
// bob: y-offset float for idle bounce animation
function drawNPC(ctx, cx, cy, type, dir = DIR.DOWN, bob = 0) {
  // Grounded shadow (no bob — stays fixed)
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(Math.round(cx), Math.round(cy) + 12, 9, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // Mirror horizontally when facing left (all NPCs are drawn facing right/down by default)
  const flip = (dir === DIR.LEFT);
  if (flip) {
    ctx.save();
    ctx.translate(cx, 0);
    ctx.scale(-1, 1);
    ctx.translate(-cx, 0);
  }

  const x = Math.round(cx - 12);
  const y = Math.round(cy - 16 + bob);

  switch (type) {
    case 'mom':     _npcMom(ctx, x, y);     break;
    case 'kid':     _npcKid(ctx, x, y);     break;
    case 'rhea':    _npcRhea(ctx, x, y);    break;
    case 'louie':   _npcLouie(ctx, x, y);   break;
    case 'charlie': _npcCharlie(ctx, x, y); break;
    case 'mac':     _npcMac(ctx, x, y);     break;
    case 'tim':     _npcTim(ctx, x, y);     break;
    case 'guide':   _npcGuide(ctx, x, y);   break;
    default:        _npcGeneric(ctx, x, y, type); break;
  }

  if (flip) ctx.restore();
}

function _npcMom(ctx, x, y) {
  ctx.fillStyle = '#AAAAAA'; ctx.fillRect(x+6, y,    12, 6);
  ctx.fillStyle = SKIN;      ctx.fillRect(x+6, y+5,  12, 9);
  ctx.fillStyle = EYE;       ctx.fillRect(x+8, y+7, 2,2); ctx.fillRect(x+13,y+7,2,2);
  ctx.fillStyle = '#DD8888'; ctx.fillRect(x+8, y+11, 8, 2);
  ctx.fillStyle = '#9C27B0'; ctx.fillRect(x+5, y+14, 14, 10);
  ctx.fillStyle = '#E1BEE7'; ctx.fillRect(x+9, y+14, 6,  9);
  ctx.fillStyle = PANTS;     ctx.fillRect(x+7,y+24,4,6); ctx.fillRect(x+13,y+24,4,6);
  ctx.fillStyle = '#AA4444'; ctx.fillRect(x+5,y+28,8,3); ctx.fillRect(x+11,y+28,8,3);
}

function _npcKid(ctx, x, y) {
  ctx.fillStyle = '#331100'; ctx.fillRect(x+6, y,    12, 4);
  ctx.fillStyle = SKIN;      ctx.fillRect(x+7, y+3,  10, 9);
  ctx.fillStyle = EYE;       ctx.fillRect(x+9,y+6,2,2); ctx.fillRect(x+13,y+6,2,2);
  ctx.fillStyle = '#E53935'; ctx.fillRect(x+5, y+12, 14, 9);
  ctx.fillStyle = '#FDD835'; ctx.fillRect(x+11,y+13, 2, 7);
  ctx.fillStyle = '#1A237E'; ctx.fillRect(x+7,y+21,4,6); ctx.fillRect(x+13,y+21,4,6);
  ctx.fillStyle = SHOE;      ctx.fillRect(x+5,y+25,8,3); ctx.fillRect(x+11,y+25,8,3);
}

function _npcRhea(ctx, x, y) {
  ctx.fillStyle = '#4A2800'; ctx.fillRect(x+5, y,    14, 6);
  ctx.fillStyle = SKIN;      ctx.fillRect(x+7, y+5,  10, 9);
  ctx.fillStyle = EYE;       ctx.fillRect(x+9,y+7,2,2); ctx.fillRect(x+13,y+7,2,2);
  ctx.fillStyle = '#FF8FA3'; ctx.fillRect(x+9,y+11,6,2);
  ctx.fillStyle = '#E91E63'; ctx.fillRect(x+5, y+14, 14, 11);
  ctx.fillStyle = SKIN;      ctx.fillRect(x+4,y+14,2,8); ctx.fillRect(x+18,y+14,2,8);
  ctx.fillStyle = '#880E4F'; ctx.fillRect(x+7,y+25,4,6); ctx.fillRect(x+13,y+25,4,6);
  ctx.fillStyle = '#880E4F'; ctx.fillRect(x+5,y+29,8,3); ctx.fillRect(x+11,y+29,8,3);
}

function _npcLouie(ctx, x, y) {
  ctx.fillStyle = SKIN;      ctx.fillRect(x+7, y,    10, 12);
  ctx.fillStyle = HAIR;      ctx.fillRect(x+6,y+4,2,8); ctx.fillRect(x+16,y+4,2,8);
  ctx.fillStyle = EYE;       ctx.fillRect(x+9,y+5,2,2); ctx.fillRect(x+13,y+5,2,2);
  ctx.fillStyle = '#1565C0'; ctx.fillRect(x+5, y+12, 14, 11);
  ctx.fillStyle = '#0D47A1'; ctx.fillRect(x+4,y+12,2,9); ctx.fillRect(x+18,y+12,2,9);
  ctx.fillStyle = '#FFD700'; ctx.fillRect(x+11,y+13, 2, 6);
  ctx.fillStyle = PANTS;     ctx.fillRect(x+7,y+23,4,7); ctx.fillRect(x+13,y+23,4,7);
  ctx.fillStyle = SHOE;      ctx.fillRect(x+5,y+28,8,3); ctx.fillRect(x+11,y+28,8,3);
}

function _npcCharlie(ctx, x, y) {
  ctx.fillStyle = '#222222'; ctx.fillRect(x+6, y,    12, 5);
  ctx.fillStyle = SKIN;      ctx.fillRect(x+7, y+4,  10, 10);
  ctx.fillStyle = EYE;       ctx.fillRect(x+9,y+7,2,2); ctx.fillRect(x+13,y+7,2,2);
  ctx.fillStyle = '#388E3C'; ctx.fillRect(x+5, y+14, 14, 10);
  ctx.fillStyle = SHIRT;     ctx.fillRect(x+10,y+14, 4,  9);
  ctx.fillStyle = '#1B5E20'; ctx.fillRect(x+4,y+14,2,8); ctx.fillRect(x+18,y+14,2,8);
  ctx.fillStyle = '#1A237E'; ctx.fillRect(x+7,y+24,4,7); ctx.fillRect(x+13,y+24,4,7);
  ctx.fillStyle = SHOE;      ctx.fillRect(x+5,y+29,8,3); ctx.fillRect(x+11,y+29,8,3);
}

function _npcMac(ctx, x, y) {
  ctx.fillStyle = '#111111'; ctx.fillRect(x+6, y,    12, 5);
  ctx.fillStyle = SKIN;      ctx.fillRect(x+7, y+4,  10, 10);
  ctx.fillStyle = EYE;       ctx.fillRect(x+9,y+7,2,2); ctx.fillRect(x+13,y+7,2,2);
  ctx.fillStyle = '#111111'; ctx.fillRect(x+5, y+14, 14, 10);
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(x+10,y+14, 4,  9);
  ctx.fillStyle = '#111111'; ctx.fillRect(x+4,y+14,2,9); ctx.fillRect(x+18,y+14,2,9);
  ctx.fillStyle = '#333333'; ctx.fillRect(x+7,y+24,4,7); ctx.fillRect(x+13,y+24,4,7);
  ctx.fillStyle = SHOE;      ctx.fillRect(x+5,y+29,8,3); ctx.fillRect(x+11,y+29,8,3);
}

function _npcTim(ctx, x, y) {
  ctx.fillStyle = '#111111'; ctx.fillRect(x+4, y,    16, 7);
  ctx.fillStyle = '#222222'; ctx.fillRect(x+3, y+2,  3, 10);
  ctx.fillRect(x+18, y+2, 3, 10);
  ctx.fillStyle = SKIN;      ctx.fillRect(x+7, y+6,  10, 9);
  ctx.fillStyle = EYE;       ctx.fillRect(x+9,y+8,2,3); ctx.fillRect(x+13,y+8,2,3);
  ctx.fillStyle = '#111111'; ctx.fillRect(x+5, y+15, 14, 11);
  ctx.fillStyle = '#333333'; ctx.fillRect(x+4,y+15,2,9); ctx.fillRect(x+18,y+15,2,9);
  ctx.fillStyle = '#111111'; ctx.fillRect(x+7,y+26,4,6); ctx.fillRect(x+13,y+26,4,6);
  ctx.fillStyle = SHOE;      ctx.fillRect(x+5,y+30,8,3); ctx.fillRect(x+11,y+30,8,3);
}

function _npcGuide(ctx, x, y) {
  // Glowing signpost — pulsing arrow animated via bob
  ctx.fillStyle = '#5D4037'; ctx.fillRect(x+10, y+18, 4, 16);  // post
  ctx.fillStyle = '#FFD600'; ctx.fillRect(x+2,  y+4,  20, 15); // sign board
  ctx.fillStyle = '#E65100'; ctx.fillRect(x+4,  y+6,  16, 11); // sign bg
  // Arrow head pointing right
  ctx.fillStyle = '#FFD700';
  ctx.beginPath();
  ctx.moveTo(x+16, y+8);
  ctx.lineTo(x+20, y+11.5);
  ctx.lineTo(x+16, y+15);
  ctx.fill();
  ctx.fillRect(x+6, y+10, 11, 3);
}

function _npcGeneric(ctx, x, y, type) {
  const pal = {
    teacher:  ['#1A237E','#3F51B5'],
    actor:    ['#4A148C','#9C27B0'],
    salesman: ['#1B5E20','#4CAF50'],
    goon:     ['#B71C1C','#F44336'],
  };
  const [body, acc] = pal[type] || ['#546E7A','#78909C'];
  ctx.fillStyle = '#222222'; ctx.fillRect(x+6, y,   12, 5);
  ctx.fillStyle = SKIN;      ctx.fillRect(x+7, y+4, 10, 9);
  ctx.fillStyle = EYE;       ctx.fillRect(x+9,y+7,2,2); ctx.fillRect(x+13,y+7,2,2);
  ctx.fillStyle = body;      ctx.fillRect(x+5, y+13, 14, 10);
  ctx.fillStyle = acc;       ctx.fillRect(x+4,y+13,2,8); ctx.fillRect(x+18,y+13,2,8);
  ctx.fillStyle = PANTS;     ctx.fillRect(x+7,y+23,4,7); ctx.fillRect(x+13,y+23,4,7);
  ctx.fillStyle = SHOE;      ctx.fillRect(x+5,y+28,7,3); ctx.fillRect(x+12,y+28,7,3);
}
