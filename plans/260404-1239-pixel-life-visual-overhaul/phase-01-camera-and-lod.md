# Phase 1: Camera + LOD Foundation

## Context Links
- [Brainstorm Report](../reports/brainstormer-260404-1239-pixel-life-visual-overhaul.md)
- [plan.md](./plan.md)

## Overview
- **Priority:** P1 — blocks everything else
- **Status:** Pending
- **Effort:** 3h

Add a camera system with zoom/pan + 3-tier LOD rendering. After this phase, existing world is zoomable with current glyphs still rendering. Foundation for sprites and terrain tiles.

## Key Insights
- Dual canvas (substrate + pixel) both need the same camera transform
- `ctx.setTransform()` handles zoom/pan natively — minimal changes to draw calls
- Viewport culling is critical: only draw cells within camera bounds
- HUD must render in screen-space (not world-space) — `ctx.save()/restore()` around transforms
- Effects (birth rings, death scatter) draw in world coords — will scale with zoom automatically
- `Pixel` needs a `direction` field (0-3) for future directional sprites
- `imageSmoothingEnabled = false` must be re-set after `setTransform()` changes

## Requirements

### Functional
- Mouse wheel zooms camera (zoom range: 1× to 6×)
- Click-drag pans camera (with momentum optional, skip for now)
- Zoom centered on mouse cursor position
- 3 LOD tiers based on zoom level:
  - `zoom < 1.5×`: colored dots (current `renderTerrain` ImageData + glyph draws)
  - `zoom 1.5-3×`: enhanced glyphs (current system, slightly improved)
  - `zoom > 3×`: placeholder colored rectangles (sprites come in Phase 3)
- Camera state persists across frames
- HUD renders in screen-space (unaffected by zoom/pan)
- Home key resets camera to 1× zoom, centered

### Non-Functional
- No FPS drop vs current at 1× zoom (identical code path)
- Smooth zoom transitions (interpolated, not stepped)
- Viewport culling: ≤ visible cells rendered per frame

## Architecture

### Camera State (`camera.ts`)
```typescript
interface Camera {
  x: number;       // world-space X (top-left of viewport)
  y: number;       // world-space Y
  zoom: number;    // 1.0 = full world visible
  targetZoom: number; // for smooth interpolation
}
```

### Coordinate System
- **World coords:** (0,0) to (W×S, H×S) = (1000, 750) canvas units
- **Screen coords:** (0,0) to (canvas.width, canvas.height)
- `worldToScreen(wx, wy)`: applies camera transform
- `screenToWorld(sx, sy)`: inverse for mouse interactions
- `getVisibleBounds()`: returns {x0, y0, x1, y1} in grid cells — for culling

### LOD Tiers
```
LOD 0 (zoom < 1.5): current fast path — ImageData terrain, glyph creatures
LOD 1 (zoom 1.5-3): same but with slightly larger/clearer glyphs
LOD 2 (zoom > 3.0): tile-based terrain + sprite creatures (Phase 2-3)
```

### Rendering Pipeline Change
```
Before:                          After:
renderTerrain() → subCtx         renderTerrain() → subCtx + camera transform
renderPixels() → pixCtx          renderPixels() → pixCtx + camera transform + culling
renderEffects() → pixCtx         renderEffects() → pixCtx (world-space, auto-scales)
renderWeather() → pixCtx         renderWeather() → pixCtx (needs screen-space for overlays)
renderCanvasHud() → pixCtx       renderCanvasHud() → pixCtx (screen-space, no transform)
```

## Related Code Files

### Files to Create
- `src/camera.ts` — Camera state, zoom/pan logic, coordinate transforms, culling, input handlers

### Files to Modify
- `src/types.ts` — Add `direction: number` to Pixel interface (0=down, 1=left, 2=right, 3=up)
- `src/movement.ts` — Set `pixel.direction` after successful move
- `src/renderer.ts` — Apply camera transform, LOD branching, viewport culling
- `src/effects.ts` — No changes needed (draws in world coords, auto-scales)
- `src/canvas-hud.ts` — Ensure HUD draws in screen-space after transform reset
- `src/index.html` — Add zoom/pan event listeners to `#sim-container`
- `src/world.ts` — Initialize `direction: 0` on pixel creation
- `src/constants.ts` — Add camera constants (MIN_ZOOM, MAX_ZOOM, ZOOM_SPEED, LOD thresholds)

## Implementation Steps

### 1. Add direction field to Pixel
1. In `types.ts`: add `direction: number` to `Pixel` interface
2. In `world.ts`: set `direction: 0` in pixel creation (`createPixel` or wherever pixels spawn)
3. In `movement.ts` (`movePixel`): after successful `movePixelTo()`, compute direction from (bestDx, bestDy):
   ```typescript
   // Direction from movement delta: 0=down, 1=left, 2=right, 3=up
   if (Math.abs(bestDy) >= Math.abs(bestDx)) {
     pixel.direction = bestDy > 0 ? 0 : 3; // down or up
   } else {
     pixel.direction = bestDx > 0 ? 2 : 1; // right or left
   }
   ```

### 2. Add camera constants
In `constants.ts`, add:
```typescript
export const MIN_ZOOM = 1.0;
export const MAX_ZOOM = 6.0;
export const ZOOM_SPEED = 0.15;       // per wheel notch
export const ZOOM_LERP = 0.15;        // smooth interpolation factor
export const LOD_GLYPH_THRESHOLD = 1.5;
export const LOD_SPRITE_THRESHOLD = 3.0;
```

### 3. Create camera.ts
Module responsibilities:
- `createCamera()`: returns initial camera state (centered, zoom=1)
- `zoomAt(cam, screenX, screenY, delta, canvasW, canvasH)`: zoom centered on mouse
- `pan(cam, dx, dy)`: move camera by screen-space delta
- `clampCamera(cam, worldW, worldH, canvasW, canvasH)`: prevent scrolling past world edges
- `updateCamera(cam)`: lerp zoom toward targetZoom each frame
- `getVisibleCells(cam, worldW, worldH, cellSize, canvasW, canvasH)`: returns {x0, y0, x1, y1} cell range
- `applyTransform(ctx, cam)`: calls `ctx.setTransform(zoom, 0, 0, zoom, -cam.x * zoom, -cam.y * zoom)`
- `screenToWorld(cam, sx, sy)`: inverse transform
- `getLOD(cam)`: returns 0, 1, or 2

### 4. Wire camera into renderer
In `renderer.ts`:
- Import camera module
- Store camera state at module level (alongside `subCanvas`, `pixCanvas`, etc.)
- Export `getCamera()` for other modules to read
- In `renderFrame()`:
  - Call `updateCamera()` for smooth zoom
  - Apply camera transform to BOTH contexts before rendering
  - After all world-space rendering, reset transform for HUD
- In `renderTerrain()`:
  - LOD 0/1: use existing ImageData path but apply camera transform to subCtx
  - LOD 2: placeholder — draw colored rectangles per visible cell (terrain tiles come Phase 2)
  - Only iterate visible cells (from `getVisibleCells()`)
- In `renderPixels()`:
  - Only render pixels within visible cell bounds
  - LOD 0/1: use existing `drawCreature()` calls
  - LOD 2: draw colored rectangle placeholders (sprites come Phase 3)
- In `renderWeather()`:
  - Full-screen overlays (fog, drought tint): draw in screen-space (reset transform first)
  - Particles (rain, snow): draw in world-space (camera transform active)

### 5. Wire camera into canvas-hud.ts
- Existing HUD code already draws with pixel coordinates
- Wrap all HUD drawing in `ctx.save()` → `ctx.setTransform(1,0,0,1,0,0)` → draw → `ctx.restore()`
- This ensures HUD stays screen-fixed regardless of camera

### 6. Add input handlers
In `index.html` or a new section of `camera.ts`:
- `wheel` event on `#pixel-canvas`: `zoomAt(cam, e.offsetX, e.offsetY, e.deltaY)`
- `mousedown` + `mousemove` + `mouseup` on `#pixel-canvas`: drag-to-pan
  - Track `isDragging`, `lastMouseX/Y`
  - On move: `pan(cam, dx, dy)`
- `keydown` for Home key: reset to 1× centered
- Prevent default scroll behavior on wheel events over canvas
- Note: existing click-to-inspect and drag-to-paint in `ui-controls.ts` need coordinate conversion via `screenToWorld()`

### 7. Update existing interactions
- In `ui-controls.ts` (`initCanvasInteraction`): convert mouse positions from screen to world coords using `screenToWorld()` before doing grid lookups
- This keeps click-to-inspect and drag-to-paint working at all zoom levels

## Todo List
- [ ] Add `direction: number` to Pixel interface + initialize in world.ts
- [ ] Set direction in movement.ts after successful move
- [ ] Add camera constants to constants.ts
- [ ] Create camera.ts with full camera system
- [ ] Wire camera transform into renderer.ts (both canvases)
- [ ] Add viewport culling to renderTerrain and renderPixels
- [ ] LOD branching in renderer (LOD 0/1 = current, LOD 2 = placeholder)
- [ ] Screen-space HUD in canvas-hud.ts
- [ ] Screen-space weather overlays in renderer.ts
- [ ] Add mouse wheel zoom + drag pan input handlers
- [ ] Update ui-controls.ts for screen→world coordinate conversion
- [ ] Compile check: `npm run dev` with no errors

## Success Criteria
- Mouse wheel zooms in/out smoothly (1× to 6×)
- Click-drag pans the world
- At 1× zoom: visually identical to current version
- At 3×+ zoom: creatures render as colored rectangles (placeholder)
- HUD stays fixed in screen corners at all zoom levels
- Click-to-inspect still works at all zoom levels
- Home key resets camera
- No FPS regression at 1× zoom

## Risk Assessment
- **ImageData + zoom conflict:** `putImageData()` ignores canvas transforms. For LOD 0/1, we either: (a) scale the canvas element CSS, or (b) draw ImageData to offscreen then `drawImage()` to main canvas with transform. Option (b) is cleanest.
  - **Mitigation:** At LOD 0, draw ImageData to subCanvas offscreen, then use `drawImage(subCanvas, ...)` with camera transform to copy. At LOD 2, skip ImageData entirely.
- **Performance regression at LOD 0:** Extra `drawImage()` copy adds ~1ms per frame
  - **Mitigation:** Still well within 16ms budget. Can skip if zoom===1 exactly.
- **Existing interaction breakage:** paint/inspect use raw mouse coords
  - **Mitigation:** Single `screenToWorld()` call converts all mouse events

## Next Steps
- Phase 2 (terrain tiles) and Phase 3 (creature sprites) can start after Phase 1 completes
