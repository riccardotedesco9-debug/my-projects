# Phase 5: Minimap + UX

## Context Links
- [plan.md](./plan.md) | [Phase 1](./phase-01-camera-and-lod.md)
- [Brainstorm Report](../reports/brainstormer-260404-1239-pixel-life-visual-overhaul.md)

## Overview
- **Priority:** P2
- **Status:** Pending
- **Effort:** 2h
- **Depends on:** Phase 1 (camera)

Add minimap overlay showing full world, click-to-jump navigation, creature inspection on double-click, zoom indicator, and keyboard shortcuts.

## Key Insights
- Minimap renders the full 200×150 world at reduced resolution (~160×120px)
- Only useful when zoomed in (zoom > 1.5) — auto-hide at full world view
- Click on minimap = jump camera to that world position
- Minimap renders in screen-space (like HUD), not affected by camera transform
- Can reuse terrain color data from the existing ImageData substrate buffer
- Creature dots on minimap use role colors (same as population bar)

## Requirements

### Functional
- **Minimap overlay:** 160×120px, bottom-right corner, semi-transparent background
- **Viewport indicator:** White/green semi-transparent rectangle showing camera bounds
- **Click-to-jump:** Click on minimap moves camera center to that world position
- **Auto-hide:** Minimap hidden when zoom ≤ 1.2 (full world already visible)
- **Toggle:** M key or button toggles minimap on/off
- **Double-click creature:** Zoom to 4× centered on clicked creature, show tooltip
- **Zoom indicator:** Small text showing current zoom level (e.g., "3.2×") near minimap
- **Keyboard shortcuts:**
  - Home: reset camera to 1× centered
  - M: toggle minimap
  - +/-: zoom in/out
  - Arrow keys (optional): pan camera

### Non-Functional
- Minimap render < 1ms per frame (simple pixel dots, no detail)
- No input conflict with existing controls (space=pause, 1/2/3=paint)

## Architecture

### Minimap Rendering
```
Per frame (if visible):
  1. Draw semi-transparent black background rect
  2. Draw terrain as 1px-per-cell colored dots (from world.terrain[])
  3. Draw creature dots (1px each, role-colored) from world.pixels
  4. Draw viewport rectangle (camera bounds mapped to minimap coords)
  5. Draw zoom level text
```

### Coordinate Mapping
```typescript
// World cell → minimap pixel
const mmScale = 160 / worldWidth; // 0.8 for 200-wide world
const mmX = baseX + cellX * mmScale;
const mmY = baseY + cellY * mmScale;

// Minimap click → world position
const worldX = (clickX - baseX) / mmScale * S; // in canvas units
const worldY = (clickY - baseY) / mmScale * S;
```

## Related Code Files

### Files to Create
- `src/minimap.ts` — Minimap rendering, click handling, visibility toggle

### Files to Modify
- `src/canvas-hud.ts` — Add minimap render call, zoom indicator
- `src/camera.ts` — Add `centerOn(worldX, worldY)` for click-to-jump and double-click zoom
- `src/renderer.ts` — Add minimap render call in screen-space section

## Implementation Steps

### 1. Create minimap.ts

**Exports:**
- `initMinimap(worldW, worldH)`: computes layout constants
- `renderMinimap(ctx, world, camera, canvasW, canvasH)`: draws minimap overlay
- `handleMinimapClick(mx, my, camera, canvasW, canvasH)`: returns world position if click is on minimap
- `toggleMinimap()`: flips visibility flag
- `isMinimapVisible(zoom)`: returns false if zoom ≤ 1.2

**Rendering:**
```typescript
function renderMinimap(ctx, world, camera, canvasW, canvasH) {
  if (!visible || camera.zoom <= 1.2) return;
  
  const mmW = 160, mmH = 120;
  const mmX = canvasW - mmW - 10;
  const mmY = canvasH - mmH - 20; // above population bar
  
  // Background
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(mmX - 2, mmY - 2, mmW + 4, mmH + 4);
  
  // Terrain dots
  const sx = mmW / world.width;
  const sy = mmH / world.height;
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const [r, g, b] = terrainBaseColor(world.terrain[y * world.width + x]);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(mmX + x * sx, mmY + y * sy, Math.ceil(sx), Math.ceil(sy));
    }
  }
  
  // Creature dots
  for (const p of world.pixels.values()) {
    ctx.fillStyle = ROLE_COLORS[getCreatureRole(p)];
    ctx.fillRect(mmX + p.x * sx, mmY + p.y * sy, 2, 2);
  }
  
  // Viewport rectangle
  const vx = camera.x / (world.width * S) * mmW;
  const vy = camera.y / (world.height * S) * mmH;
  const vw = (canvasW / camera.zoom) / (world.width * S) * mmW;
  const vh = (canvasH / camera.zoom) / (world.height * S) * mmH;
  ctx.strokeStyle = 'rgba(0,255,136,0.6)';
  ctx.lineWidth = 1;
  ctx.strokeRect(mmX + vx, mmY + vy, vw, vh);
  
  // Zoom label
  ctx.font = '9px Consolas, monospace';
  ctx.fillStyle = '#889';
  ctx.fillText(`${camera.zoom.toFixed(1)}×`, mmX, mmY - 4);
}
```

### 2. Add centerOn to camera.ts
```typescript
export function centerOn(cam: Camera, worldX: number, worldY: number, canvasW: number, canvasH: number) {
  cam.x = worldX - (canvasW / cam.zoom) / 2;
  cam.y = worldY - (canvasH / cam.zoom) / 2;
  clampCamera(cam, ...);
}
```

### 3. Wire minimap into renderer
In `renderFrame()`, after HUD rendering (screen-space):
```typescript
renderMinimap(pixCtx, world, camera, canvasW, canvasH);
```

### 4. Double-click creature zoom
In camera input handlers:
- `dblclick` on pixel canvas → `screenToWorld()` → find pixel at that cell → if found, `centerOn()` + set targetZoom = 4×

### 5. Keyboard shortcuts
Add to existing keydown handler:
- `Home`: reset camera (zoom=1, centered)
- `m` or `M`: `toggleMinimap()`
- `+`/`=`: zoom in by one step
- `-`: zoom out by one step

### 6. Minimap click-to-jump
Add click handler on pixel canvas:
- Check if click coords are within minimap bounds
- If yes, convert to world coords, call `centerOn()`
- If no, pass through to existing click handler

## Todo List
- [ ] Create minimap.ts with rendering and click handling
- [ ] Add `centerOn()` to camera.ts
- [ ] Wire minimap rendering into renderer.ts (screen-space)
- [ ] Add minimap click-to-jump input handling
- [ ] Add double-click creature zoom
- [ ] Add keyboard shortcuts (Home, M, +/-)
- [ ] Auto-hide minimap at zoom ≤ 1.2
- [ ] Zoom level indicator text
- [ ] Visual test: minimap shows world correctly, click-to-jump works
- [ ] Compile check: `npm run dev`

## Success Criteria
- Minimap visible in bottom-right when zoomed in
- Minimap shows terrain colors + creature dots
- Green rectangle shows current viewport bounds
- Clicking minimap jumps camera to that position
- Double-clicking a creature zooms to it
- M key toggles minimap
- Home key resets view
- Minimap auto-hides at full-world zoom

## Risk Assessment
- **Minimap rendering perf:** 200×150 = 30,000 pixel fills per frame
  - **Mitigation:** Use ImageData for minimap terrain (same as main terrain), cache when terrain unchanged. Only redraw creature dots per frame.
- **Input conflict:** Click on minimap vs click on canvas
  - **Mitigation:** Check click coords against minimap bounds first; only pass through if outside.

## Next Steps
- This is the final phase. After completion, full visual overhaul is done.
- Potential future: creature tooltip panel on hover, sprite animation enhancements
