# Phase 2: Terrain Tiles

## Context Links
- [plan.md](./plan.md) | [Phase 1](./phase-01-camera-and-lod.md)
- [Brainstorm Report](../reports/brainstormer-260404-1239-pixel-life-visual-overhaul.md)

## Overview
- **Priority:** P1
- **Status:** Pending
- **Effort:** 3h
- **Depends on:** Phase 1 (camera + LOD)

Procedural 16×16 terrain tiles for 6 terrain types. Replaces flat ImageData colors at LOD 2 (zoom > 3×). Includes overlay system for food/pheromone/wear. Transition dithering between terrain types.

## Key Insights
- Current terrain: flat color per cell via 5×5 pixel blocks in ImageData buffer
- At LOD 2, each cell = 16+ screen pixels → enough for textured tiles
- Tiles must match sprite art style (shared palette, same pixel-art aesthetic)
- Overlays (food, pheromone, wear) are dynamic per-frame — render on top of cached base tiles
- Terrain doesn't change during gameplay → base tiles cache once at world creation
- Only ~800 tiles visible at max zoom (33×25) — well within budget

## Requirements

### Functional
- 6 procedural 16×16 terrain tiles: water, sand, dirt, grass, forest, rock
- Water: animated (2-frame wave cycle, toggled every N frames)
- Terrain transition dithering: 2px checkerboard blend at edges between different terrain types
- Overlay rendering: food (green dots), depletion (brown tint), pheromone (amber glow), wear (lighter paths)
- LOD integration: only render tiles at LOD 2 (zoom > 3×), else current ImageData path

### Non-Functional
- Base tiles cached as OffscreenCanvas at init — zero per-frame generation cost
- Overlay compositing < 2ms for visible viewport

## Architecture

### Tile Generation Pipeline
```
Init:
  For each terrain type → generate 16×16 OffscreenCanvas → cache

Per frame (LOD 2 only):
  For each visible cell:
    1. drawImage(baseTile[terrainType], cellX, cellY)
    2. Draw edge dithering if neighbors differ
    3. Composite overlays (food/pheromone/wear)
```

### Terrain Tile Templates

Each tile defined as a procedural recipe using pseudo-random patterns seeded by terrain type:

| Terrain | Base Color | Texture Pattern | Accent |
|---------|-----------|----------------|--------|
| Water | `#0a1a30` | Horizontal wave lines, 2-frame shimmer | Light blue highlights |
| Sand | `#4a3a1a` | Scattered single-pixel dots (grain) | Tan/beige variation |
| Dirt | `#3a2a10` | Pebble clusters (2-3px groups) | Dark brown depth |
| Grass | `#2a5a12` | Vertical grass blades (1px wide, varying height) | Light green tips |
| Forest | `#1a3a0a` | Dense leaf canopy (2px circular clusters) | Dark shadow patches |
| Rock | `#2a2a2e` | Crack lines (1px diagonal) + vein patterns | Grey variation |

### Overlay Rendering
- **Food abundance:** Scatter 2-5 bright green pixels proportional to `food[ci]`
- **Depletion:** Tint base colors toward brown when `food[ci] < 0.1` on fertile terrain
- **Pheromone:** Draw 1-3 amber pixels at pheromone positions proportional to `pheromone[ci]`
- **Wear:** Lighten center pixels by `wear[ci] / 255 * 40` brightness
- **Corpse stain:** 2-3 dark red pixels when `corpses[ci] > 0`

### Edge Dithering
For each cell at LOD 2, check 4 cardinal neighbors. If neighbor terrain differs, apply a 2px checkerboard mask along that edge blending the two base colors. Pattern: alternating pixels from self and neighbor tile.

## Related Code Files

### Files to Create
- `src/terrain-tiles.ts` — Tile generation, caching, overlay compositing, edge dithering

### Files to Modify
- `src/renderer.ts` — Hook LOD 2 terrain rendering, call terrain tile system instead of ImageData
- `src/constants.ts` — Add `TERRAIN_TILE_SIZE = 16`, `WATER_ANIM_INTERVAL = 30` (frames)

## Implementation Steps

### 1. Add constants
In `constants.ts`:
```typescript
export const TERRAIN_TILE_SIZE = 16;
export const WATER_ANIM_INTERVAL = 30; // frames between water animation toggle
```

### 2. Create terrain-tiles.ts

**Exports:**
- `initTerrainTiles()`: generates and caches all base tiles
- `renderTerrainTile(ctx, terrainType, worldX, worldY, cellSize, frameCount)`: draws base tile scaled to cellSize
- `renderTerrainOverlays(ctx, world, cellX, cellY, cellSize)`: draws dynamic overlays
- `renderEdgeDithering(ctx, world, cellX, cellY, cellSize)`: blends edges with neighbors

**Tile generation approach:**
```typescript
const TILE_CACHE: OffscreenCanvas[] = []; // indexed by Terrain enum
const WATER_FRAMES: OffscreenCanvas[] = []; // 2 frames for water animation

function generateTile(type: Terrain): OffscreenCanvas {
  const canvas = new OffscreenCanvas(16, 16);
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(16, 16);
  const d = img.data;

  // Fill with base color + texture pattern
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const [r, g, b] = getTerrainPixel(type, x, y);
      const i = (y * 16 + x) * 4;
      d[i] = r; d[i+1] = g; d[i+2] = b; d[i+3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
```

**getTerrainPixel(type, x, y)**: returns [r,g,b] for each pixel position using deterministic patterns:
- Grass: base green + vertical streaks at x%3===0, height varies by hash(x)
- Forest: base dark green + circular leaf clusters at pseudo-random positions
- Water: horizontal wave pattern, lighter pixels at y%4===0 (frame 1) or y%4===2 (frame 2)
- Sand: base tan + grain dots at hash(x,y)%7===0
- Dirt: base brown + pebble groups at hash positions
- Rock: base grey + diagonal crack lines

Use a simple hash: `(x * 7 + y * 13 + type * 31) & 0xff` for deterministic pseudo-random.

### 3. Wire into renderer.ts

In `renderTerrain()`:
```typescript
const lod = getLOD(camera);
if (lod < 2) {
  // Existing ImageData path (LOD 0/1)
  renderTerrainImageData(world, config);
} else {
  // Tile-based path (LOD 2)
  const bounds = getVisibleCells(camera, ...);
  for (let wy = bounds.y0; wy <= bounds.y1; wy++) {
    for (let wx = bounds.x0; wx <= bounds.x1; wx++) {
      const ci = wy * W + wx;
      const cellScreenSize = S * camera.zoom;
      renderTerrainTile(subCtx, world.terrain[ci], wx * S, wy * S, S, frameCount);
      renderEdgeDithering(subCtx, world, wx, wy, S);
      renderTerrainOverlays(subCtx, world, wx, wy, S);
    }
  }
}
```

Note: at LOD 2, we draw tiles via `drawImage()` with camera transform active — tiles auto-scale.

### 4. Handle ImageData → drawImage transition
At LOD 0/1, current code uses `putImageData()` which ignores transforms. From Phase 1, this is handled by drawing ImageData to subCanvas then using `drawImage()` with camera transform. No additional work needed here.

At LOD 2, skip ImageData entirely — draw tiles directly with `drawImage()`.

## Todo List
- [ ] Add terrain tile constants to constants.ts
- [ ] Create terrain-tiles.ts with tile generation system
- [ ] Implement 6 terrain tile generators (water, sand, dirt, grass, forest, rock)
- [ ] Implement water 2-frame animation
- [ ] Implement overlay rendering (food, pheromone, wear, corpse, depletion)
- [ ] Implement edge dithering between different terrain types
- [ ] Wire LOD 2 terrain rendering into renderer.ts
- [ ] Visual test: zoom to 3×+, verify terrain tiles look cohesive
- [ ] Compile check: `npm run dev`

## Success Criteria
- At LOD 2 (zoom > 3×): textured terrain tiles visible with distinct patterns per type
- Water has subtle animation (shimmer)
- Food abundance shows as green dots on tiles
- Pheromone trails visible as amber glow
- Worn paths show lighter tile centers
- Edge transitions between terrain types look natural (dithered, not hard-cut)
- LOD 0/1: no visual change from Phase 1

## Risk Assessment
- **Tile quality:** procedural tiles may look repetitive → use position-seeded hash to break repetition (vary pixel offset per cell)
- **Performance:** 800 `drawImage()` calls at max zoom → well within budget, each is a tiny 16×16 source
- **Color palette mismatch with sprites:** share a terrain palette constant array used by both terrain-tiles.ts and sprites.ts

## Next Steps
- Phase 3 (creature sprites) can run in parallel with Phase 2
- Phase 4 (polish) will refine terrain visuals alongside sprites
