'use strict';

const player = (() => {
  let x = 320, y = 240;
  let dir = DIR.DOWN;
  let frame = 0;
  let frameTimer = 0;
  let moving = false;
  let variant = 'default';
  let stepTimer = 0;
  let bumpCooldown = 0;   // prevents rapid wall-bump sounds

  const COL_W = 16, COL_H = 10;

  // Display name shown above player per costume/scene
  const VARIANT_NAMES = {
    default:  'DANNY',
    apron:    'DANNY',
    penguin:  'PENGUIN',
    frank:    'FRANK',
  };

  function reset(tx, ty, v = 'default') {
    x = tx * TILE + TILE / 2;
    y = ty * TILE + TILE / 2;
    dir   = DIR.DOWN;
    frame = 0;
    frameTimer = 0;
    variant    = v;
    bumpCooldown = 0;
  }

  function getPos()  { return { x, y }; }
  function getDir()  { return dir; }
  function getTile() { return { tx: Math.floor(x / TILE), ty: Math.floor(y / TILE) }; }

  function update(dt, keys, mapData) {
    let dx = 0, dy = 0;
    if (keys['ArrowUp']    || keys['KeyW']) { dy = -1; dir = DIR.UP;    }
    if (keys['ArrowDown']  || keys['KeyS']) { dy =  1; dir = DIR.DOWN;  }
    if (keys['ArrowLeft']  || keys['KeyA']) { dx = -1; dir = DIR.LEFT;  }
    if (keys['ArrowRight'] || keys['KeyD']) { dx =  1; dir = DIR.RIGHT; }

    if (dx !== 0 && dy !== 0) { dx *= 0.707; dy *= 0.707; }

    // Penguin waddles slower; other variants can sprint with Shift
    const canRun = variant !== 'penguin';
    const spd    = variant === 'penguin'
      ? SPD * 0.68
      : SPD * ((canRun && (keys['ShiftLeft'] || keys['ShiftRight'])) ? 1.9 : 1.0);

    const nx = x + dx * spd * dt;
    const ny = y + dy * spd * dt;

    moving = dx !== 0 || dy !== 0;

    if (bumpCooldown > 0) bumpCooldown -= dt;

    const movedX = dx !== 0 && !_blocked(nx, y, mapData);
    const movedY = dy !== 0 && !_blocked(x, ny, mapData);

    if (movedX) { x = nx; }
    else if (dx !== 0 && bumpCooldown <= 0) {
      audioEngine.sfx('bump');
      bumpCooldown = 25;
    }

    if (movedY) { y = ny; }
    else if (dy !== 0 && bumpCooldown <= 0) {
      audioEngine.sfx('bump');
      bumpCooldown = 25;
    }

    x = Math.max(TILE, Math.min((mapData[0].length - 1) * TILE, x));
    y = Math.max(TILE, Math.min((mapData.length    - 1) * TILE, y));

    if (moving) {
      frameTimer += dt;
      if (frameTimer >= 10) { frameTimer = 0; frame = (frame + 1) % 2; }
      stepTimer += dt;
      if (stepTimer >= 18) { stepTimer = 0; audioEngine.sfx('step'); }
    } else {
      frame     = 0;
      stepTimer = 0;
    }
  }

  function _blocked(px, py, mapData) {
    const hw = COL_W / 2, hh = COL_H / 2;
    const corners = [
      [px - hw, py - hh], [px + hw, py - hh],
      [px - hw, py + hh], [px + hw, py + hh],
    ];
    for (const [cx, cy] of corners) {
      const tx = Math.floor(cx / TILE);
      const ty = Math.floor(cy / TILE);
      const row = mapData[ty];
      if (!row) return true;
      const tid = row[tx];
      if (tid === undefined || BLOCK.has(tid)) return true;
    }
    return false;
  }

  function setVariant(v) { variant = v; }

  function draw(ctx, camX, camY) {
    const sx = x - camX;
    const sy = y - camY;

    drawDanny(ctx, sx, sy, dir, frame, variant);

    // Name tag above player (uses variant-specific label)
    const label = VARIANT_NAMES[variant] || 'DANNY';
    const tagW  = label.length * 6 + 8;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(sx - tagW / 2, sy - 34, tagW, 13);
    ctx.fillStyle = '#FFD700';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, sx, sy - 24);
    ctx.textAlign = 'left';
  }

  return { reset, getPos, getDir, getTile, update, draw, setVariant };
})();
