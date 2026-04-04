# Phase 4: Full Variant Set + Polish

## Context Links
- [plan.md](./plan.md) | [Phase 3](./phase-03-creature-sprites-base.md)
- [Brainstorm Report](../reports/brainstormer-260404-1239-pixel-life-visual-overhaul.md)

## Overview
- **Priority:** P2
- **Status:** Pending
- **Effort:** 4h
- **Depends on:** Phase 3 (base sprites)

Add remaining 14 creature variants (total 21), smooth tile-to-tile movement tweening, upgraded effects, and visual polish.

## Key Insights
- Variant selection: `(dna[0] + dna[1] + dna[2] + dna[6]) % 3` → 0/1/2 per role
- Phase 3 implemented Variant A (index 0). This phase adds Variants B and C.
- Walk animation smoothing: interpolate pixel screen position over 2-3 render frames between ticks
- Effects at LOD 2 need to match pixel-art style (sparkle patterns, not smooth circles)

## Requirements

### Functional

**14 new creature templates:**

| Role | Variant B | Variant C |
|------|-----------|-----------|
| Plant | Mushroom (cap + stem) | Cactus (spiky column) |
| Hunter | Fox (slim, big tail) | Hawk (winged, talons) |
| Apex | Bear (bulky, round) | Eagle (large wingspan) |
| Scavenger | Vulture (hunched wings) | Rat (small, long tail) |
| Parasite | Leech (worm shape) | Mosquito (needle nose, wings) |
| Swarm | Ant (segmented body) | Fish (fin, scales) |
| Nomad | Rabbit (big ears, small) | Horse (tall, mane) |

**Movement tweening:**
- When a pixel moves to a new cell, interpolate screen position over ~3 render frames
- Store `prevX, prevY` on pixel, blend toward `x, y` each render frame
- Only at LOD 2 — LOD 0/1 keep instant jumps

**Effects upgrade for LOD 2:**
- Birth: pixel-art sparkle pattern (4 small diamond shapes expanding outward)
- Death: sprite fades (decreasing alpha) + scatter particles in creature colors
- Feeding pulse: 2-frame green glow under plant sprite
- Hunting glow: 2-frame red pulse around predator sprite

**Visual markers on sprites:**
- Generation ring: gold/silver 1px border around cell for gen 10+/50+
- Dominant-trait pip: 2×2 colored dot at sprite top-right
- ARMOR-based size: scale sprite slightly (0.85× to 1.1×) based on ARMOR gene

## Related Code Files

### Files to Modify
- `src/sprites.ts` — Add 14 new templates, wire variant selection
- `src/renderer.ts` — Add tweening logic, ARMOR-based scale
- `src/effects.ts` — Upgrade birth/death effects for LOD 2 style
- `src/types.ts` — Add `prevX, prevY` to Pixel for tweening (optional, can use render-time map)

## Implementation Steps

### 1. Add variant selection to sprites.ts
```typescript
export function getVariantIndex(pixel: Pixel): number {
  return (pixel.dna[0] + pixel.dna[1] + pixel.dna[2] + pixel.dna[GENE.REACT_TYPE]) % 3;
}
```

Update `initSprites()` to generate all 21 templates × 4 dirs × 2 frames = 168 base frames.

### 2. Define 14 new templates
Same format as Phase 3. Each template = front/side/back pixel arrays + leg positions.

Group by effort:
- **Simplest** (compact shapes): mushroom, cactus, rat, leech, ant, fish, rabbit
- **Medium** (limbs/wings): fox, vulture, mosquito, horse
- **Complex** (large/detailed): bear, eagle, hawk

### 3. Movement tweening
Option A (render-time map, no Pixel change):
```typescript
const prevPositions = new Map<number, {x: number, y: number, t: number}>();

// In renderPixels() LOD 2:
const prev = prevPositions.get(pixel.id);
if (prev && (prev.x !== pixel.x || prev.y !== pixel.y)) {
  prev.t = Math.min(1, prev.t + 0.35); // ~3 frames to reach target
  const drawX = prev.x + (pixel.x - prev.x) * prev.t;
  const drawY = prev.y + (pixel.y - prev.y) * prev.t;
  if (prev.t >= 1) { prev.x = pixel.x; prev.y = pixel.y; prev.t = 0; }
  // Draw at interpolated position
} else {
  prevPositions.set(pixel.id, {x: pixel.x, y: pixel.y, t: 0});
}
```

### 4. Upgrade effects for LOD 2
In `effects.ts`, check LOD level and use different rendering:
- LOD 2 birth: 4 small diamond shapes (3×3 pixels each) expanding from center
- LOD 2 death: fade sprite alpha over 4 frames + colored pixel scatter
- Both scale properly with camera transform (they're in world-space)

### 5. ARMOR-based sprite scaling
```typescript
const armorScale = 0.85 + (pixel.dna[GENE.ARMOR] / 255) * 0.25; // 0.85 to 1.1
const drawSize = S * armorScale;
const offset = (S - drawSize) / 2;
ctx.drawImage(sprite, pixel.x * S + offset, pixel.y * S + offset, drawSize, drawSize);
```

## Todo List
- [ ] Add variant selection function to sprites.ts
- [ ] Define mushroom template (Plant B)
- [ ] Define cactus template (Plant C)
- [ ] Define fox template (Hunter B)
- [ ] Define hawk template (Hunter C)
- [ ] Define bear template (Apex B)
- [ ] Define eagle template (Apex C)
- [ ] Define vulture template (Scavenger B)
- [ ] Define rat template (Scavenger C)
- [ ] Define leech template (Parasite B)
- [ ] Define mosquito template (Parasite C)
- [ ] Define ant template (Swarm B)
- [ ] Define fish template (Swarm C)
- [ ] Define rabbit template (Nomad B)
- [ ] Define horse template (Nomad C)
- [ ] Implement movement tweening at LOD 2
- [ ] Upgrade birth/death effects for LOD 2
- [ ] Add ARMOR-based sprite scaling
- [ ] Visual test: verify all 21 variants distinguishable
- [ ] Compile check: `npm run dev`

## Success Criteria
- All 21 creature variants render correctly at LOD 2
- Variant determined by genome — same pixel always renders same variant
- Movement looks smooth (tile-to-tile interpolation, no jarring jumps)
- Effects match pixel-art aesthetic at LOD 2
- Larger ARMOR creatures visually bigger than fast/small creatures

## Risk Assessment
- **Scope:** 14 templates is substantial. Each needs front/side/back views + walk frames.
  - **Mitigation:** Start with simplest shapes, use mirroring aggressively. Some creatures (leech, ant, fish) are small/simple.
- **Tweening edge cases:** Toroidal wrapping can cause creatures to appear to slide across entire screen
  - **Mitigation:** If distance > 2 cells, skip tweening (instant jump)

## Next Steps
- Phase 5 (minimap + UX) can start after Phase 1
