'use strict';

// ── Collectible items (center-based, bobbing via frame) ───────────────────────
function drawItem(ctx, cx, cy, type, frame) {
  const bob = Math.round(Math.sin(frame * 0.08) * 3);

  // Glow aura behind item
  const glowAlpha = 0.18 + Math.sin(frame * 0.1) * 0.1;
  ctx.fillStyle = `rgba(255,215,0,${glowAlpha})`;
  ctx.beginPath();
  ctx.ellipse(cx, cy + bob, 12, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  const x = cx - 8;
  const y = cy - 8 + bob;

  switch (type) {
    case 'star': {
      ctx.fillStyle = '#FFD700';
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a  = (i * 2 * Math.PI / 5) - Math.PI / 2;
        const ra = a + Math.PI / 5;
        const fn = i === 0 ? 'moveTo' : 'lineTo';
        ctx[fn](cx + Math.cos(a)*10,  cy + Math.sin(a)*10  + bob);
        ctx.lineTo(cx + Math.cos(ra)*4, cy + Math.sin(ra)*4 + bob);
      }
      ctx.closePath(); ctx.fill();
      // Shine dot
      ctx.fillStyle = '#FFFDE7';
      ctx.fillRect(cx - 1, cy - 4 + bob, 2, 2);
      break;
    }
    case 'trophy': {
      ctx.fillStyle = '#FFD700'; ctx.fillRect(x+4, y,    8, 8);
      ctx.fillStyle = '#FFA000'; ctx.fillRect(x+2, y,   12, 4);
      ctx.fillRect(x+6, y+8, 4, 6); ctx.fillRect(x+4, y+14, 8, 3);
      ctx.fillStyle = '#FFFDE7'; ctx.fillRect(x+6, y+2, 2, 2); // shine
      break;
    }
    case 'scissors': {
      ctx.fillStyle = '#90A4AE';
      ctx.fillRect(x+3, y+5, 10, 3);
      ctx.fillRect(x+3, y+8, 10, 3);
      ctx.fillRect(x+6, y+2, 3, 12);
      ctx.fillStyle = '#ECEFF1'; ctx.fillRect(x+7, y+3, 1, 2); // shine
      break;
    }
    case 'mug': {
      ctx.fillStyle = '#795548'; ctx.fillRect(x+3, y+4, 11, 10);
      ctx.fillRect(x+14, y+6, 3, 5);                            // handle
      ctx.fillStyle = '#FFFDE7'; ctx.fillRect(x+4, y+5, 9, 4);  // foam/liquid
      ctx.fillStyle = '#4E342E'; ctx.fillRect(x+5, y+9, 7, 4);  // liquid darker
      break;
    }
    case 'tophat': {
      ctx.fillStyle = '#111111';
      ctx.fillRect(x+4, y,    8, 10);
      ctx.fillRect(x+1, y+9, 14, 3);
      ctx.fillStyle = '#333333'; ctx.fillRect(x+5, y+1, 2, 3); // shine
      break;
    }
  }
}
