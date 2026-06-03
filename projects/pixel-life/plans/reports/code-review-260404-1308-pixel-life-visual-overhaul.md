# Code Review: Pixel-Life Visual Overhaul

**Date:** 2026-04-04
**Files reviewed:** 16 changed, 4 new (~551 insertions, ~134 deletions)
**Build:** TypeScript compiles clean, no type errors

---

## Overall Assessment

Solid implementation of a camera/zoom/pan system with LOD rendering, sprites, terrain tiles, minimap, and visual effects. Architecture is clean with good separation of concerns. Several bugs and performance issues need attention before this ships.

---

## Critical Issues

### 1. BUG: Substrate camera transform causes double-rendering / flicker

**File:** `src/renderer.ts:74-85`

The substrate layer uses `putImageData` (which ignores canvas transforms) then copies via buffer canvas to apply camera zoom. But the condition `camera.zoom !== 1` misses the case where `renderTerrainImageData` was skipped (due to `SUBSTRATE_RENDER_INTERVAL` throttle). When substrate isn't re-rendered on this frame but zoom changed, `renderSubstrateWithCamera()` copies stale canvas content that already had a transform applied from the previous frame -- resulting in the transform being applied twice (zoom-on-zoom).

**Fix:** Track whether substrate was freshly rendered this frame:

```typescript
let substrateRenderedThisFrame = false;

// In renderFrame:
if (frameCount % SUBSTRATE_RENDER_INTERVAL === 0 || frameCount === 1) {
  renderTerrain(world, config, lod);
  substrateRenderedThisFrame = true;
}

if (camera.zoom !== 1 && substrateRenderedThisFrame) {
  renderSubstrateWithCamera();
}
```

Alternatively, always store the raw (untransformed) substrate in `subImage` and apply the camera transform every frame, which is the cleaner design.

### 2. BUG: renderSubstrateWithCamera skipped at zoom=1 but renderTerrainTiled uses transform

**File:** `src/renderer.ts:79, 149-166`

At LOD >= 2 (zoom >= 3.0), `renderTerrainTiled` applies its own camera transform via `applyTransform(subCtx, camera)`. But when the zoom drops back to exactly 1.0 (which `renderSubstrateWithCamera` skips), the substrate canvas will have been last drawn with a transform and never gets reset. This leaves a transformed substrate visible at zoom=1.

**Fix:** The substrate rendering path needs to be consistent. Either always apply the transform (at zoom=1 it's identity anyway), or always reset before ImageData rendering.

### 3. BUG: `_lastWorld` used without null check in minimap click handler

**File:** `src/renderer.ts:490`

```typescript
const worldPos = handleMinimapClick(sx, sy, pixCanvas.width, pixCanvas.height, _lastWorld!, S);
```

The `!` asserts non-null, but `_lastWorld` is `null` until the first `renderFrame` call. If the user clicks the canvas before the first frame renders, this crashes.

**Fix:** Guard with `if (!_lastWorld) return;` before the call.

---

## High Priority

### 4. PERF: Sprite cache eviction is FIFO, not LRU -- poor cache behavior

**File:** `src/sprites.ts:362-365`

When cache exceeds 600 entries, it evicts the first key (insertion order). Active creatures near the camera keep generating sprites that get evicted by other creatures, causing cache thrashing. With ~3000 potential creatures and 7 roles x 4 dirs x 2 frames x 64 palette buckets = ~3584 possible keys, the cache is always churning.

**Fix:** Either (a) bump cache size to 2048+ since OffscreenCanvas(16,16) is tiny, or (b) implement LRU by deleting and re-inserting on access:

```typescript
if (sprite) {
  cache.delete(key);  // remove
  cache.set(key, sprite);  // re-insert at end
  return sprite;
}
```

### 5. PERF: renderTerrainTiled calls renderEdgeDithering + renderTerrainOverlays per cell with individual draw calls

**File:** `src/renderer.ts:157-164`

At LOD 2, for a 200x150 grid (30000 cells), this issues up to 30000 x ~15 individual `fillRect` calls for overlays and edge dithering. At high zoom with viewport culling this is manageable, but at zoom=3 the visible area could still be ~67x50 = 3350 cells x ~15 = ~50k draw calls.

**Mitigation:** Consider batching overlay draws by type (all food dots, then all pheromone, etc.) and/or using a separate overlay ImageData buffer instead of individual fillRect calls. Not blocking, but worth noting for future optimization.

### 6. BUG: Weather particles rendered in world-space but spawned with hardcoded scale=5

**File:** `src/weather.ts:82`

```typescript
const dw = world.width * 5, dh = world.height * 5;
```

Particle positions are generated using hardcoded `* 5` instead of `config.pixelScale`. If pixelScale ever changes, particles will be misaligned. The same hardcoding appears in `updateParticles` (line 93).

**Fix:** Store pixelScale in Weather or pass it through. Currently pixelScale is 5 so this works, but it's fragile.

### 7. EDGE CASE: Viewport culling excludes pixels at toroidal wrap boundaries

**File:** `src/camera.ts:62-67`, `src/renderer.ts:223`

`getVisibleCells` returns a simple rectangular range clamped to `[0, worldW-1]`. The world uses toroidal wrapping (`wrapX`/`wrapY` in movement), so a creature at x=199 that wraps to x=0 is fine for simulation but will be culled by the viewport when the camera is looking at the right edge. This creates visible "missing pixels" at world edges when zoomed in.

Since the world isn't truly infinite and MIN_ZOOM is 1 (whole world visible), this is only noticeable at high zoom near edges. **Low-effort fix:** Pad bounds by 1 on each side (already done with the `-1`/`+1` in getVisibleCells, but that doesn't handle the wrap-around case specifically).

---

## Medium Priority

### 8. Canvas HUD uses hardcoded dimensions instead of actual canvas size

**File:** `src/canvas-hud.ts:21-23`

```typescript
const dw = config.worldWidth * config.pixelScale;
const dh = config.worldHeight * config.pixelScale;
```

This is the logical world size, not the actual canvas dimensions. If the canvas is ever resized (e.g., responsive layout), the HUD would render at the wrong coordinates. Currently the canvas is set to match, so this works.

### 9. Minimap terrain cache invalidation is weak

**File:** `src/minimap.ts:69`

```typescript
const hash = world.terrain[0] + world.terrain[100] + world.terrain[world.terrain.length - 1] + world.width;
```

This hash samples only 3 terrain cells. A world reset that generates the same terrain values at indices 0, 100, and last would incorrectly reuse the old cache. Very unlikely in practice, but the fix is trivial -- hash a few more samples or include `world.tick` as a generation counter.

### 10. putImageData at non-integer coordinates in minimap

**File:** `src/minimap.ts:95`

```typescript
ctx.putImageData(terrainCache, mmX, mmY);
```

`mmX` and `mmY` are computed from `canvasW - MM_W - MARGIN` which could be non-integer if canvasW isn't aligned. `putImageData` with non-integer coordinates silently rounds, but it can cause 1px offset mismatch between the cached image and the overlay drawings that use the same coordinates with `fillRect` (which doesn't round the same way).

**Fix:** `Math.floor(mmX)` / `Math.floor(mmY)`.

### 11. Missing `direction` initialization for existing pixels on upgrade

**File:** `src/types.ts:46`, `src/pixel.ts:187`

New pixels get `direction: 0` in `createPixel`. But if there are serialization/deserialization paths (save/load), existing pixel data won't have the `direction` field. This would cause `undefined` to be passed to `getSpriteForPixel`, resulting in the sprite key `"0-undefined-0-42"` -- which works but creates wasted cache entries.

Currently there's no save/load visible, so this is future-proofing only.

---

## Low Priority

### 12. OffscreenCanvas browser compatibility

`terrain-tiles.ts` and `sprites.ts` use `OffscreenCanvas` which is not available in Safari < 16.4. If this needs broad browser support, consider falling back to regular `document.createElement('canvas')`.

### 13. effects.ts birth/death arrays grow but never shrink

`births` and `deaths` arrays grow to `MAX_BIRTHS`/`MAX_DEATHS` and then use ring-buffer indexing, but old entries with `age >= LIFETIME` still occupy memory and get iterated every frame. The fixed-size approach is fine for 60+80 entries.

### 14. Unused export

**File:** `src/sprites.ts:372-374`

`getVariantIndex` is exported but never imported anywhere. It's tagged "Phase 4" -- keep or remove to reduce dead code.

---

## Positive Observations

- **Clean module separation:** Camera, sprites, terrain-tiles, minimap, and effects are all independent modules with clear APIs
- **LOD system is well-designed:** Three tiers (dots/glyphs/sprites) with smooth thresholds
- **Sprite palette hash grouping (~64 buckets)** is a smart optimization -- avoids per-creature unique sprites while preserving genetic diversity appearance
- **Ring buffer effects** avoid allocation during gameplay -- good for GC pressure
- **Viewport culling** keeps rendering proportional to visible area, not world size
- **Weather renders correctly split** between world-space (particles affected by camera) and screen-space (overlays)
- **TypeScript compiles clean** with no type errors

---

## Recommended Actions (Priority Order)

1. **Fix substrate double-transform bug** (Critical #1) -- users will see flicker/zoom drift
2. **Fix substrate transform consistency at LOD transitions** (Critical #2)
3. **Add null guard for _lastWorld** (Critical #3) -- crash on early click
4. **Improve sprite cache eviction to LRU** (High #4) -- prevents thrashing at scale
5. **Fix hardcoded pixelScale=5 in weather** (High #6) -- fragile coupling
6. **Floor minimap coordinates** (Medium #10) -- 1px rendering artifacts
7. Remaining medium/low items as convenient

---

## Metrics

- **Type Coverage:** 100% (strict TypeScript, no `any` casts observed)
- **Test Coverage:** N/A (no test files present)
- **Linting Issues:** 0 (tsc --noEmit clean)

---

## Unresolved Questions

1. Is there a save/load or serialization mechanism planned? If so, the `direction` field needs migration handling.
2. Should the camera support toroidal wrapping (infinite scroll) or stay clamped? Current clamp means you can't smoothly scroll past the world edge.
3. Is Safari compatibility required? `OffscreenCanvas` usage may need fallback.
