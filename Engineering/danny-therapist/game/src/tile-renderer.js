'use strict';

// Draw a single tile at canvas position (cx, cy)
function drawTile(ctx, tileId, cx, cy) {
  const cols = TCOL[tileId] || ['#808080','#606060'];
  const [c1, c2] = cols;

  ctx.fillStyle = c1;
  ctx.fillRect(cx, cy, TILE, TILE);

  // Checkerboard accent for floor-like tiles
  const check = (Math.floor(cx / TILE) + Math.floor(cy / TILE)) % 2 === 0;
  const noCheck = new Set([1, 3, 7]); // WALL, WATER, TREE skip checkerboard
  if (check && !noCheck.has(tileId)) {
    ctx.fillStyle = c2;
    ctx.fillRect(cx + 3, cy + 3, TILE - 6, TILE - 6);
  }

  // Per-tile decorations
  switch (tileId) {
    case T.TREE: {
      ctx.fillStyle = '#5D4037';
      ctx.fillRect(cx + 12, cy + 20, 8, 12);       // trunk
      ctx.fillStyle = '#2E7D32';
      ctx.fillRect(cx + 4, cy + 2, 24, 20);         // canopy
      ctx.fillStyle = '#388E3C';
      ctx.fillRect(cx + 8, cy + 4, 16, 14);         // canopy highlight
      ctx.fillStyle = '#1B5E20';
      ctx.fillRect(cx + 12, cy + 6, 8, 8);          // canopy shadow
      break;
    }
    case T.DOOR: {
      ctx.fillStyle = '#6D4C41';
      ctx.fillRect(cx + 6, cy + 4, 20, 26);
      ctx.fillStyle = '#8D6E63';
      ctx.fillRect(cx + 8, cy + 6, 8, 10);          // panel top
      ctx.fillRect(cx + 8, cy + 18, 8, 10);         // panel bottom
      ctx.fillStyle = '#FFD700';
      ctx.fillRect(cx + 22, cy + 16, 3, 3);         // doorknob
      break;
    }
    case T.TAXI: {
      ctx.fillStyle = '#FDD835';
      ctx.fillRect(cx + 4, cy + 6, 24, 18);
      ctx.fillStyle = '#1565C0';
      ctx.fillRect(cx + 6, cy + 8, 8, 7);           // window L
      ctx.fillRect(cx + 18, cy + 8, 8, 7);          // window R
      ctx.fillStyle = '#111111';
      ctx.fillRect(cx + 2, cy + 22, 6, 6);          // wheel L
      ctx.fillRect(cx + 22, cy + 22, 6, 6);         // wheel R
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '6px monospace';
      ctx.fillText('TAXI', cx + 7, cy + 20);
      break;
    }
    case T.WINDOW: {
      ctx.fillStyle = '#B3E5FC';
      ctx.fillRect(cx + 2, cy + 2, TILE - 4, TILE - 4);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(cx + 14, cy + 2, 2, TILE - 4);  // cross H
      ctx.fillRect(cx + 2, cy + 14, TILE - 4, 2);  // cross V
      break;
    }
    case T.STAGE: {
      ctx.fillStyle = '#CC9900';
      ctx.fillRect(cx + 2, cy + 26, TILE - 4, 4);  // stage edge
      ctx.fillStyle = '#FFD700';
      ctx.fillRect(cx + 6, cy + 4, 2, 4);           // spotlight beam L
      ctx.fillRect(cx + 24, cy + 4, 2, 4);          // spotlight beam R
      break;
    }
    case T.BAR: {
      ctx.fillStyle = '#3E2723';
      ctx.fillRect(cx + 2, cy + 2, TILE - 4, 6);   // bar top
      ctx.fillStyle = '#6D4C41';
      ctx.fillRect(cx + 4, cy + 8, TILE - 8, TILE - 12);
      break;
    }
    case T.WALL: {
      // Brick-like pattern
      ctx.fillStyle = '#3D2E20';
      for (let row = 0; row < 4; row++) {
        const offset = (row % 2) * 8;
        for (let col = 0; col < 3; col++) {
          ctx.fillRect(cx + offset + col * 16, cy + row * 8, 14, 6);
        }
      }
      break;
    }
  }
}
