'use strict';

// Camera + tilemap renderer with floating pickup text
const mapRenderer = (() => {
  let mapData      = [];
  let camX         = 0;
  let camY         = 0;
  let items        = [];
  let frameCount   = 0;
  let floatingTexts = [];   // { wx, baseWY, offsetY, text, life, maxLife }
  let screenFlash  = 0;     // 0-1, white overlay on item collect

  // Human-readable names shown when collecting an item
  const ITEM_LABELS = {
    star:     '★ Dream collected!',
    trophy:   '★ Emmy Award!',
    scissors: '✂ Talent found!',
    mug:      '★ Rum Ham!',
    tophat:   '★ Top Hat!',
  };

  function load(data, startItems = []) {
    mapData       = data;
    items         = startItems.map(i => ({ ...i, collected: false }));
    frameCount    = 0;
    floatingTexts = [];
    screenFlash   = 0;
  }

  function getData()  { return mapData; }
  function getItems() { return items; }

  function getTile(tx, ty) {
    const row = mapData[ty];
    return row ? (row[tx] ?? T.WALL) : T.WALL;
  }

  // Smooth camera follow
  function updateCamera(px, py) {
    const mapW = mapData[0].length * TILE;
    const mapH = mapData.length    * TILE;
    camX += (px - CW / 2 - camX) * 0.12;
    camY += (py - CH / 2 - camY) * 0.12;
    camX  = Math.max(0, Math.min(mapW - CW, camX));
    camY  = Math.max(0, Math.min(mapH - CH, camY));
  }

  function update(dt) {
    frameCount += dt;
    const { x: px, y: py } = player.getPos();
    updateCamera(px, py);

    if (screenFlash > 0) screenFlash = Math.max(0, screenFlash - dt * 0.08);

    // Animate floating texts upward
    for (let i = floatingTexts.length - 1; i >= 0; i--) {
      const ft = floatingTexts[i];
      ft.life     -= dt;
      ft.offsetY  -= 0.55 * dt;   // float upward
      if (ft.life <= 0) floatingTexts.splice(i, 1);
    }
  }

  function draw(ctx) {
    const startTX = Math.floor(camX / TILE);
    const startTY = Math.floor(camY / TILE);
    const endTX   = Math.min(startTX + Math.ceil(CW / TILE) + 1, mapData[0]?.length || 0);
    const endTY   = Math.min(startTY + Math.ceil(CH / TILE) + 1, mapData.length    || 0);

    for (let ty = startTY; ty < endTY; ty++) {
      for (let tx = startTX; tx < endTX; tx++) {
        const tileId = mapData[ty]?.[tx] ?? T.WALL;
        drawTile(ctx, tileId, tx * TILE - camX, ty * TILE - camY);
      }
    }

    // Uncollected items
    for (const item of items) {
      if (item.collected) continue;
      const ix = item.tx * TILE + TILE / 2 - camX;
      const iy = item.ty * TILE + TILE / 2 - camY;
      drawItem(ctx, ix, iy, item.type, frameCount);
    }

    // Floating pickup texts
    ctx.textAlign = 'center';
    for (const ft of floatingTexts) {
      const alpha = Math.min(1, ft.life / 20) * Math.min(1, (ft.maxLife - ft.life) / 15);
      ctx.globalAlpha = alpha;
      const sx = ft.wx - camX;
      const sy = ft.baseWY + ft.offsetY - camY;
      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.font = 'bold 11px monospace';
      ctx.fillText(ft.text, sx + 1, sy + 1);
      // Text
      ctx.fillStyle = '#FFD700';
      ctx.fillText(ft.text, sx, sy);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign   = 'left';

    // White flash on item collect — snappy visual feedback
    if (screenFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${screenFlash * 0.55})`;
      ctx.fillRect(0, 0, CW, CH);
    }
  }

  // Auto-collect items near player; spawn floating text on pickup
  function checkItemPickup() {
    const { x: px, y: py } = player.getPos();
    for (const item of items) {
      if (item.collected) continue;
      const ix = item.tx * TILE + TILE / 2;
      const iy = item.ty * TILE + TILE / 2;
      const dx = px - ix, dy = py - iy;
      if (Math.sqrt(dx * dx + dy * dy) < 24) {
        item.collected = true;
        screenFlash = 1.0;
        audioEngine.sfx('collect');
        // Spawn floating label at item's world position
        floatingTexts.push({
          wx:      ix,
          baseWY:  iy - 16,
          offsetY: 0,
          text:    ITEM_LABELS[item.type] || '★ Got it!',
          life:    70,
          maxLife: 70,
        });
      }
    }
  }

  function getCamX() { return camX; }
  function getCamY() { return camY; }

  return { load, getData, getItems, getTile, update, draw, checkItemPickup, getCamX, getCamY };
})();
