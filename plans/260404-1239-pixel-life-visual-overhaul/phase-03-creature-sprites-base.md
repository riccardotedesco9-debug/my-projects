# Phase 3: Creature Sprites — Base Set (7 Sprites)

## Context Links
- [plan.md](./plan.md) | [Phase 1](./phase-01-camera-and-lod.md)
- [Brainstorm Report](../reports/brainstormer-260404-1239-pixel-life-visual-overhaul.md)

## Overview
- **Priority:** P1
- **Status:** Pending
- **Effort:** 4h
- **Depends on:** Phase 1 (camera + LOD)

Procedural 16×16 pixel-art sprite system. 1 variant per role (7 creatures), 4 directions × 2 walk frames = 56 sprite frames. Palette swap from DNA. Integrates into renderer at LOD 2.

## Key Insights
- Each creature = typed pixel array template with color zones (body, accent, eye)
- Generator produces 4 directional views by mirroring/rearranging the base template
- Walk frames: alternate leg pixel positions between 2 states
- Palette swap: replace color zone markers with DNA-derived colors at cache time
- Cache: per (role × direction × frame) = 56 ImageBitmaps for base palette, then palette variants generated lazily or at spawn
- `direction` field from Phase 1 determines which sprite frame to draw
- Energy modulates brightness (same as current) — apply as globalAlpha or tint

## Requirements

### Functional
- 7 base creature sprites (1 per role, Variant A from brainstorm):
  - Plant → Flower (sessile, round petals)
  - Hunter → Wolf (4-legged, pointy ears)
  - Apex → Lion (mane, bulky)
  - Scavenger → Hyena (hunched, spotted)
  - Parasite → Tick (round body, small legs)
  - Swarm → Bee (striped, small wings)
  - Nomad → Deer (antlers, slender)
- 4 directional views per creature (down, left, right, up)
- 2 walk frames per direction (leg alternation)
- DNA palette swap: body color from `dnaToColor()` hue, accent from shifted hue, eyes always dark
- Energy brightness: low energy = darker sprite (via canvas globalAlpha or pre-tinted)
- Plants: no walk cycle — use 2-frame idle sway instead
- Render at LOD 2 in place of current glyph system

### Non-Functional
- Sprite cache generated at simulation init — no per-frame generation
- All 56 frames cached as `OffscreenCanvas` (16×16 each)
- Drawing a sprite = single `drawImage()` call

## Architecture

### Sprite Template Format
```typescript
interface SpriteTemplate {
  name: string;
  role: number;
  // 16×16 pixel grid, each value is a ColorZone enum
  pixels: Uint8Array; // 256 values (16×16)
  // Leg positions for walk animation
  legs: { x: number; y: number; zone: ColorZone }[];
  legAlt: { x: number; y: number; zone: ColorZone }[]; // alternate frame
}

const enum ColorZone {
  TRANSPARENT = 0,
  BODY = 1,        // primary color from DNA
  ACCENT = 2,      // secondary color (hue shifted)
  DARK = 3,        // shadow/outline (darkened body)
  EYE = 4,         // always near-black with white highlight
  HIGHLIGHT = 5,   // lighter body for belly/underbody
}
```

### Palette Swap Pipeline
```
DNA → dnaToColor() → [r, g, b] (body hue)
  body: [r, g, b]
  accent: hue-shift +30°, same sat/lum
  dark: body × 0.5 brightness
  highlight: body × 1.3 brightness, clamped
  eye: [20, 20, 20] with [240, 240, 240] highlight pixel
```

### Direction Generation
- **Down (0):** base template as-is (front-facing view)
- **Left (1):** side view template (different silhouette — body from side, one eye visible)
- **Right (2):** horizontal mirror of Left
- **Up (3):** back view template (no eyes, tail/back detail visible)

Note: left/right can share a template via horizontal flip, reducing unique art to 3 views per creature.

### Sprite Cache Structure
```typescript
// Map: role → direction → frame → OffscreenCanvas
const spriteCache = new Map<string, OffscreenCanvas>();
// Key: `${role}-${direction}-${frame}` for base palette
// Palette variants: `${role}-${direction}-${frame}-${paletteHash}` lazily cached
```

### Rendering Integration
```typescript
// In renderPixels() at LOD 2:
const dir = pixel.direction;
const frame = (world.tick >> 3) & 1; // alternate every 8 ticks
const sprite = getSpriteForPixel(pixel, dir, frame);
ctx.drawImage(sprite, pixel.x * S, pixel.y * S, S, S);
```

## Related Code Files

### Files to Create
- `src/sprites.ts` — Template definitions, generation pipeline, cache, palette swap, draw helper

### Files to Modify
- `src/renderer.ts` — Hook LOD 2 creature rendering to use sprites instead of glyphs
- `src/color-map.ts` — Export `hslToRgb` (currently private), add `hueShift()` utility

## Implementation Steps

### 1. Export color utilities from color-map.ts
- Make `hslToRgb()` exported (currently private function)
- Add `hueShift(r, g, b, degrees)` — convert to HSL, shift hue, convert back

### 2. Create sprites.ts

**Core functions:**
- `initSprites()`: generates all base templates + caches sprites
- `getSpriteForPixel(pixel, direction, frame)`: returns cached OffscreenCanvas with correct palette
- `getVariantIndex(pixel)`: returns 0 for now (Phase 4 adds variants 1-2)

**Template definition approach:**
Define each creature as a function that returns a 16×16 `Uint8Array` of `ColorZone` values:

```typescript
function flowerTemplate(): SpriteTemplate {
  // 16×16 grid, draw a flower shape:
  // Center stem (DARK), petals (BODY), center (ACCENT), leaves (HIGHLIGHT)
  const px = new Uint8Array(256); // all TRANSPARENT
  // ... set pixels for flower shape
  return { name: 'flower', role: 0, pixels: px, legs: [], legAlt: [] };
}
```

**7 template functions:** `flowerTemplate`, `wolfTemplate`, `lionTemplate`, `hyenaTemplate`, `tickTemplate`, `beeTemplate`, `deerTemplate`

**Direction generation:**
```typescript
function generateDirections(template: SpriteTemplate): Uint8Array[] {
  const down = template.pixels; // as-is
  const left = generateSideView(template); // side silhouette
  const right = mirrorHorizontal(left);
  const up = generateBackView(template); // no eyes, back detail
  return [down, left, right, up];
}
```

For side/back views, each template provides optional side/back pixel arrays. If not provided, derive from front view via heuristic mirroring.

**Walk frame generation:**
```typescript
function generateWalkFrame(base: Uint8Array, legs: {x,y,zone}[], legAlt: {x,y,zone}[]): Uint8Array {
  const frame = new Uint8Array(base);
  // Clear leg pixels, draw alt leg positions
  for (const l of legs) frame[l.y * 16 + l.x] = ColorZone.TRANSPARENT;
  for (const l of legAlt) frame[l.y * 16 + l.x] = l.zone;
  return frame;
}
```

**Palette rendering:**
```typescript
function renderSpriteToCanvas(pixelData: Uint8Array, palette: RGBPalette): OffscreenCanvas {
  const canvas = new OffscreenCanvas(16, 16);
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(16, 16);
  for (let i = 0; i < 256; i++) {
    const zone = pixelData[i];
    if (zone === ColorZone.TRANSPARENT) continue;
    const [r, g, b] = palette[zone];
    const idx = i * 4;
    img.data[idx] = r; img.data[idx+1] = g; img.data[idx+2] = b; img.data[idx+3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
```

**Lazy palette caching:**
- Base sprites (default palette) cached at init: 7 roles × 4 dirs × 2 frames = 56 canvases
- Per-creature palette variants cached on first render using a `Map<string, OffscreenCanvas>`
- Cache key: `${role}-${dir}-${frame}-${paletteHash}` where paletteHash = DNA hash truncated to 8 bits
- LRU eviction if cache grows past 500 entries (unlikely at typical populations)

### 3. Integrate into renderer.ts

Replace the LOD 2 placeholder rectangles (from Phase 1) with actual sprites:

```typescript
// In renderPixels(), LOD 2 branch:
if (lod >= 2) {
  const frame = (frameCount >> 3) & 1;
  const sprite = getSpriteForPixel(pixel, pixel.direction, frame);
  
  // Energy-based brightness
  const e = pixel.energy / 100;
  if (e < 0.25) pixCtx.globalAlpha = 0.4;
  else if (e < 0.5) pixCtx.globalAlpha = 0.7;
  else pixCtx.globalAlpha = 1;
  
  pixCtx.drawImage(sprite, pixel.x * S, pixel.y * S, S, S);
  pixCtx.globalAlpha = 1;
} else {
  // Existing glyph path (LOD 0/1)
  drawCreature(pixel, cx, cy, e, role, col, r, g, b);
}
```

### 4. Handle special visual markers at LOD 2
- **Generation ring:** Draw thin colored border around sprite cell if pixel.generation > 10
- **Dominant-trait pip:** Draw 2×2 colored square at top-right corner of cell
- **Newborn glow:** Brief white flash overlay (3 ticks)
- These overlay the sprite — draw AFTER `drawImage()`

## Todo List
- [ ] Export `hslToRgb` from color-map.ts, add `hueShift` utility
- [ ] Create sprites.ts with template format and generation pipeline
- [ ] Define flower template (Plant role)
- [ ] Define wolf template (Hunter role)
- [ ] Define lion template (Apex role)
- [ ] Define hyena template (Scavenger role)
- [ ] Define tick template (Parasite role)
- [ ] Define bee template (Swarm role)
- [ ] Define deer template (Nomad role)
- [ ] Implement direction generation (down/left/right/up)
- [ ] Implement walk frame generation
- [ ] Implement palette swap + caching
- [ ] Integrate sprite rendering into renderer.ts LOD 2
- [ ] Add generation ring, trait pip, newborn glow overlays for LOD 2
- [ ] Visual test: zoom to 3×+, verify 7 creature types distinguishable
- [ ] Compile check: `npm run dev`

## Success Criteria
- At LOD 2, each creature role has a distinct, recognizable silhouette
- Creatures face their movement direction
- Walk animation toggles between 2 frames during movement
- Plants sway gently (idle animation, no walking)
- DNA-based color variation visible within same role
- Low-energy creatures appear darker
- Generation rings and trait pips visible on sprites
- LOD 0/1: unchanged from Phase 1

## Risk Assessment
- **Sprite quality:** Procedural 16×16 art requires careful pixel placement. Risk: ugly sprites
  - **Mitigation:** Test each template visually in isolation. Iterate. Provide pixel array override points for hand-tuning.
- **Palette cache memory:** At 500 cached sprites × 16×16 × 4 bytes = ~500KB. Negligible.
- **Side/back view quality:** Auto-deriving side/back from front view may look wrong
  - **Mitigation:** Each template provides explicit side/back view pixel arrays. More work but better quality.

## Next Steps
- Phase 4 adds remaining 14 creature variants (2 more per role) + polish
