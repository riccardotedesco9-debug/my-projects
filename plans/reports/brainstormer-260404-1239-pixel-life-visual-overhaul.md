# Brainstorm Report: Pixel-Life Visual Overhaul

**Date:** 2026-04-04
**Status:** Agreed — ready for implementation planning

---

## Problem Statement

Current pixel-life simulator renders 7 creature roles as simple geometric glyphs (circles, triangles, diamonds) at 5px per cell on a 200×150 grid. Creatures are indistinguishable — you can't tell "that's a wolf" vs "that's a bee." User wants visually recognizable creatures while keeping the tile-based 1-tile-at-a-time movement system.

Core constraint: **environment and creatures must feel visually cohesive** — no paper-cutout-on-flat-background disconnect.

---

## Agreed Approach

### 1. Camera/Viewport System — Canvas Transform Zoom

- **Technique:** `ctx.setTransform(zoom, 0, 0, zoom, -camX, -camY)` on existing dual-canvas setup
- **World stays** 200×150 cells (no grid resize)
- **3 LOD tiers** based on effective cell screen size:
  - `zoom < 1.5×` → colored dots (current fast path, ~5-7px/cell)
  - `zoom 1.5-3×` → enhanced glyphs (current shapes, sharper, ~8-15px/cell)
  - `zoom > 3×` → full 16×16 pixel-art sprites + terrain tiles (~16+px/cell)
- **Zoom range:** 1× (full world) to ~6× (detailed close-up, ~33×25 cells visible)
- **Controls:** mouse wheel zoom, click-drag pan, minimap (bottom-right corner)
- **Double-click:** zoom-to-creature inspection

### 2. Pixel-Art Sprites — Procedurally Generated, 16×16

**Resolution:** 16×16 pixels per creature sprite

**Variant system:** 3 visual variants per role, selected by genome hash

| Role | Variant A | Variant B | Variant C | Silhouette Key |
|------|-----------|-----------|-----------|----------------|
| Plant | Flower | Mushroom | Cactus | Round/cap/spiky top |
| Hunter | Wolf | Fox | Hawk | 4-leg/slim/winged |
| Apex | Lion | Bear | Eagle | Mane/bulky/winged |
| Scavenger | Hyena | Vulture | Rat | Hunched/winged/small |
| Parasite | Tick | Leech | Mosquito | Round/worm/winged |
| Swarm | Bee | Ant | Fish | Striped/segmented/fin |
| Nomad | Deer | Rabbit | Horse | Antlers/ears/tall |

**Total:** 21 creature designs × 4 directions × 2 walk frames = **168 sprite frames**

**Generation pipeline (all in code):**
1. Define creature templates as typed pixel arrays with color zones
2. Each template specifies: body silhouette, eye positions, limb positions, color zone map
3. Generator creates 4 directional rotations from base template
4. Walk frames: swap leg pixel positions between 2 states
5. **Palette swap:** DNA hue system maps to sprite color zones (body, accent, eyes)
6. Cache as `ImageBitmap` or `OffscreenCanvas` at startup per (variant × direction × frame)
7. Energy level modulates brightness (starving = dark, well-fed = bright) — same as current

**DNA → sprite mapping:**
- `REACT_TYPE` gene → role (existing)
- Genome hash (e.g., sum of first 4 genes % 3) → variant index (0-2)
- DNA hue from `color-map.ts` → palette swap colors
- `ARMOR` gene → body mass (slightly larger/smaller sprite scale)

### 3. Terrain Tiles — 16×16 Pixel Art (Visual Parity)

**Critical requirement:** terrain must visually match sprite art style to avoid "two different planes" disconnect.

**6 base terrain tiles (16×16):**

| Terrain | Visual Treatment |
|---------|-----------------|
| Water | Animated blue tiles with wave pattern (2-frame cycle) |
| Sand | Dotted beige/tan with subtle grain texture |
| Dirt | Dark brown with scattered pebble pixels |
| Grass | Green with grass blade pixel pattern |
| Forest | Dark green with canopy/leaf density |
| Rock | Grey with crack/vein pixel patterns |

**Overlays (rendered on top of base terrain tile):**
- Food abundance → scattered bright green dots on tile
- Food depletion → brown/withered tint
- Pheromone trails → amber pixel trail overlay
- Wear patterns → worn/lighter path pixels
- Corpse stains → dark red pixels (existing)

**Terrain transitions:** Simple 2px dithered edge blending between adjacent terrain types. Not full autotiling — that's overscoped. Dither pattern masks create a natural-looking boundary.

**LOD for terrain:**
- `zoom < 1.5×` → current ImageData flat colors (fast)
- `zoom 1.5-3×` → slightly textured flat tiles
- `zoom > 3×` → full 16×16 terrain tiles with overlays

**Terrain tile caching:** pre-render base terrain tiles to OffscreenCanvas, only composite overlays per frame.

### 4. Effects System Upgrade

Current effects (birth rings, death scatter) need to match new art style at zoom:
- **Birth:** Sparkle/glow effect around tile (pixel-art sparkle pattern)
- **Death:** Creature sprite fades + pixel scatter in creature colors
- **Feeding:** Subtle "chomp" animation (1-2 frame overlay)
- **Hunting glow:** Red pixel aura around hunter sprites
- **Generation ring:** Pixel border around high-gen creatures (gold/silver)

### 5. Minimap

- Small overlay (e.g., 160×120px) in bottom-right corner
- Shows full 200×150 world at 0.8px/cell scale
- Color-coded dots for creatures (role colors)
- Semi-transparent viewport rectangle shows current camera bounds
- Click minimap to jump camera to that position
- Toggle visibility with key (M) or button

---

## Architecture Impact

### Files to Modify
- **`renderer.ts`** — Major rewrite: add camera system, LOD branching, sprite rendering path, terrain tile rendering
- **`color-map.ts`** — Add palette swap utilities for sprite color zones
- **`constants.ts`** — Add zoom constants, LOD thresholds, sprite dimensions
- **`effects.ts`** — Upgrade effects for zoomed rendering
- **`canvas-hud.ts`** — Add minimap, adjust HUD for zoom-aware positioning
- **`index.html`** — Add mouse event listeners for zoom/pan

### New Files
- **`src/camera.ts`** — Camera state (x, y, zoom), pan/zoom logic, viewport culling, world↔screen coordinate transforms
- **`src/sprites.ts`** — Procedural sprite generator, template definitions, palette swap, frame cache
- **`src/terrain-tiles.ts`** — 16×16 terrain tile generator, transition dithering, overlay compositing
- **`src/minimap.ts`** — Minimap rendering, click-to-jump, viewport indicator

### Performance Considerations
- **Viewport culling:** Only render creatures/terrain in camera bounds — critical for zoomed-in performance
- **Sprite cache:** Pre-generate all sprite variants at init, store as ImageBitmap (GPU-backed)
- **Terrain cache:** Pre-render base terrain tiles once, cache per terrain type
- **LOD switching:** Below LOD threshold, skip sprite draws entirely — fall back to current fast path
- **Frame budget:** At max zoom (~33×25 visible cells), rendering ~100 terrain tiles + ~20-50 creature sprites = well within 16ms budget

### Risk Assessment
1. **Sprite quality:** Procedural generation may produce ugly sprites → mitigation: iterate on templates, test extensively, provide manual override points
2. **Terrain/sprite style mismatch:** Even with same resolution, palette differences can feel off → mitigation: shared color palette constants, same dithering/shading rules
3. **Walk animation jitter:** Discrete tile movement + animation frames can look choppy → mitigation: optional smooth tile-to-tile interpolation (tween position over 2-3 render frames)
4. **Zoom performance cliff:** Jumping between LOD levels may cause visible pop-in → mitigation: crossfade or immediate switch (pop-in is acceptable in pixel art style)
5. **Scope creep:** 168 sprite frames + terrain tiles is large → mitigation: ship in phases (see below)

---

## Implementation Phases (Suggested)

### Phase 1: Camera + LOD Foundation
- `camera.ts`: pan, zoom, viewport culling
- Modify `renderer.ts` for transform-based rendering
- 3 LOD tiers (dots / glyphs / placeholder rectangles)
- Mouse wheel + drag controls
- **Ship:** Zoomable world, existing glyphs still work

### Phase 2: Terrain Tiles
- `terrain-tiles.ts`: 6 procedural 16×16 tiles
- Terrain transition dithering
- Overlay system (food, pheromone, wear)
- LOD terrain rendering in `renderer.ts`
- **Ship:** Environment looks good at all zoom levels

### Phase 3: Creature Sprites — Base Set (7 sprites)
- `sprites.ts`: template system + generator
- 1 variant per role (7 creatures × 4 dirs × 2 frames = 56 frames)
- Palette swap from DNA
- Integrate into renderer LOD
- **Ship:** Recognizable creatures, 1 variant each

### Phase 4: Full Variant Set + Polish
- Add remaining 14 creature variants (total 21)
- Walk animation smoothing (tile-to-tile tween)
- Effects upgrade (birth/death/feeding)
- Generation rings, dominant-trait indicators on sprites
- **Ship:** Full visual overhaul complete

### Phase 5: Minimap + UX
- `minimap.ts`: world overview, click-to-jump
- Double-click creature inspection
- Zoom level indicator in HUD
- Keyboard shortcuts (Home = reset zoom, M = minimap)
- **Ship:** Complete UX polish

---

## Success Criteria
1. At 3×+ zoom, can identify creature type at a glance without color legend
2. Terrain and creatures feel like one cohesive visual world
3. Smooth zoom/pan with no performance drops below 30fps
4. DNA variation visible (same role, different lineage = different colors)
5. Full world view (1× zoom) remains functional for macro observation
6. All existing simulation mechanics unchanged — visual-only overhaul

---

## Unresolved Questions
1. **Smooth tile movement?** Should creatures interpolate between tiles (tween over 2-3 frames) or jump? Tweening looks better but adds rendering complexity. Deferred to Phase 4.
2. **Plant animation:** Plants don't move — should they have an idle sway animation instead of walk cycle? Could reuse 2 frames for subtle bobbing.
3. **Sprite editor?** If procedural sprites don't look good enough, may need a runtime sprite editor or manual pixel array overrides. Cross that bridge if needed.
