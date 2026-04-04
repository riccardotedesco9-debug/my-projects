# Code Review: OOZE Pixel-Life Final

**Date:** 2026-04-04 | **Reviewer:** code-reviewer | **Scope:** Full codebase  
**Files:** 43 TypeScript + 1 HTML | **LOC:** ~6,800 | **TypeScript:** Compiles clean (0 errors)

---

## Overall Assessment

Solid simulation engine. Architecture is clean -- each system in its own file, types well-defined, data structures sensible (Map for O(1) pixel lookup, typed arrays for grid data). The code is readable and well-commented. Most issues below are medium-priority refinements, not blockers.

---

## Critical Issues

None found. No null dereference crashes, no uncaught exceptions in the hot path, no type errors.

---

## High Priority

### H1. `(config as any)` bypass for harvestRate/reproTax -- type-unsafe slider wiring

**Files:** `ui-controls.ts:37,41` | `metabolism.ts:57` | `reproduction.ts:54`

The harvest and repro sliders write to `(config as any).harvestRate` and `(config as any).reproTax`, then consumption sites read them back with `(config as any).harvestRate ?? HARVEST_RATE`. This works but:
- No TypeScript protection -- a typo like `harvestrate` silently falls through to the `??` default
- `createDefaultConfig()` never initializes these fields, so after reset the sliders display new values but config holds undefined until the slider is touched

**Fix:** Add `harvestRate` and `reproTax` to the `SimConfig` interface and `createDefaultConfig()`:

```typescript
// types.ts — add to SimConfig
harvestRate: number;
reproTax: number;

// constants.ts — add to createDefaultConfig()
harvestRate: HARVEST_RATE,   // 0.28
reproTax: REPRO_TAX,        // 3.5
```

Then remove all `(config as any)` casts.

### H2. Defaults button resets upkeep slider to 60 but config default is 100

**File:** `ui-controls.ts:55`

```typescript
const defaults = { ..., 'slider-upkeep': 60, ... };
```

But `createDefaultConfig()` sets `upkeepMultiplier: 1.0` and the slider HTML has `value="100"`. The defaults button would reset upkeep to 0.6x instead of 1.0x. This is a **balance-affecting bug**.

**Fix:** Change `'slider-upkeep': 60` to `'slider-upkeep': 100`.

### H3. Tween pruning iterates all pixels per dead entry (O(n*m) worst case)

**File:** `renderer.ts:244-249`

```typescript
for (const [id] of _tweenPositions) {
  let found = false;
  for (const p of world.pixels.values()) { if (p.id === id) { found = true; break; } }
  if (!found) _tweenPositions.delete(id);
}
```

This is O(tweenSize * pixelCount) -- at 3000 pixels with 4500 stale tweens, that's 13.5M iterations every 60 frames. Should use pixel IDs as a Set for O(1) lookup.

**Fix:**
```typescript
if (frameCount % 60 === 0 && _tweenPositions.size > world.pixels.size * 1.5) {
  const liveIds = new Set<number>();
  for (const p of world.pixels.values()) liveIds.add(p.id);
  for (const [id] of _tweenPositions) {
    if (!liveIds.has(id)) _tweenPositions.delete(id);
  }
}
```

---

## Medium Priority

### M1. Inspector popup can position off-screen (negative Y)

**File:** `creature-inspector.ts:45`

```typescript
panelEl.style.top = `${Math.min(screenY - 50, maxY)}px`;
```

If `screenY < 50`, the top is negative and the panel clips above the viewport. Add a `Math.max(10, ...)` clamp:

```typescript
panelEl.style.top = `${Math.max(10, Math.min(screenY - 50, maxY))}px`;
```

### M2. Heart bezier curve renders as an odd shape

**File:** `effects.ts:104-106`

The bezier control points produce a leaf/petal rather than a recognizable heart at small sizes. The issue: both halves of the heart share the same start point but the control points don't create the characteristic two-lobe top.

Current path:
```
moveTo(x, y+s)
bezierTo(x-s, y-0.5s, x-2s, y+0.5s, x, y+2s)  // left half
bezierTo(x+2s, y+0.5s, x+s, y-0.5s, x, y+s)    // right half
```

At heartSize=1.5, this draws a ~4px shape where the control points are very close together, making it look like a smear rather than a heart. A simpler two-arc approach reads better at these pixel sizes:

```typescript
// Two arcs + triangle for a cleaner micro-heart
const hs = heartSize * 0.7;
ctx.beginPath();
ctx.arc(b.x - hs * 0.5, heartY, hs * 0.55, Math.PI, 0);
ctx.arc(b.x + hs * 0.5, heartY, hs * 0.55, Math.PI, 0);
ctx.lineTo(b.x, heartY + hs * 1.4);
ctx.closePath();
ctx.fill();
```

This is a visual polish issue, not a crash -- current code works, just doesn't read as "heart" at game zoom.

### M3. `shuffled8()` duplicated in 3 files

**Files:** `reactions.ts:134`, `reproduction.ts:90`, `sexual-reproduction.ts:102`, `adhesion.ts:64`

Four identical copies. Extract to a shared utility:

```typescript
// util.ts
export function shuffled8(): number[] { ... }
```

### M4. Territory `Uint16Array` type comment mismatch

**File:** `types.ts:72`

```typescript
territory: Uint16Array;  // W * H (owner pixel ID, 0 = unclaimed)
```

Comment says "owner pixel ID" but since the territory rewrite it stores role index (1-7), not pixel IDs. The Uint16Array is oversized for values 0-7 -- a Uint8Array would halve memory (same for territoryAge which caps at 200).

**Fix:** Update comment and optionally downsize:
```typescript
territory: Uint8Array;      // W * H (owner role 0-7, 0 = unclaimed)
territoryAge: Uint8Array;   // W * H (ticks since reinforced, max 200)
```

### M5. `reset()` re-registers controls/interaction every call

**File:** `main.ts:29-32`

Each reset calls `initControls()` and `initCanvasInteraction()` again. `initControls` re-binds `onclick` to button elements (safe -- replaces handler). But `initCanvasInteraction` adds new `mousedown/mousemove/mouseup/mouseleave` event listeners to the canvas without removing old ones. Over multiple resets, handlers stack.

The document-level click handler in `initCanvasInteraction:128` also stacks.

**Fix:** Add a guard similar to `_inputsInitialized` in renderer, or use `{ once: true }` / `AbortController` to clean up old listeners.

---

## Low Priority

### L1. Unused exported constants

These constants are declared in `constants.ts` but never imported anywhere:
- `FOOD_PATCH_STRENGTH` (patches use inline `0.02 + random * 0.02` in `world.ts:48`)
- `FOOD_PATCH_DRIFT_SPEED` (drift uses inline `0.02` in `world.ts:49`)
- `CAMOUFLAGE_SPEED_MAX`
- `SUBSTRATE_SATURATION_LIMIT`
- `WALL_ARMOR_MIN`, `WALL_SPEED_MAX`, `WALL_TICKS_THRESHOLD` (wall detection in renderer uses hardcoded `200`, `50`, `50`)

### L2. Unused exports

- `getFood()` in `world.ts:71` -- exported but never imported
- `getDisplayTps()` in `stats.ts:27` -- exported but never called
- `aquaticFoodRate()` in `locomotion.ts:62` -- exported but never called
- `ROLE_HUES_EXPORT` in `color-map.ts:88` -- only used in `sprites.ts` (fine), but the name `_EXPORT` suffix is unusual

### L3. `renderer.ts` at 838 lines

This file is 4x the project's ~200 line target. The `renderPixels` function alone is ~260 lines. Consider extracting:
- `renderPixels` + `drawCreature` + `drawBehaviorIcon` into `pixel-renderer.ts`
- `renderWeatherWorld` + `renderWeatherOverlays` into `weather-renderer.ts`
- `renderPackLines` into `pack-renderer.ts`

### L4. `seekFood` only checks immediate + max-range neighbors, not intermediate

**File:** `movement.ts:110-128`

`seekFood` checks the 8 immediate neighbors and 8 at `range` distance, but skips everything in between. A creature with sense range 4 checks cells at distance 1 and 4, missing food at distance 2-3. This is a design choice (performance) but worth documenting.

---

## Balance Assessment

The current constants are **viable for sustained populations**. Key ratios:

| Metric | Value | Assessment |
|--------|-------|------------|
| Harvest rate | 0.28 | Good -- food affinity (0.2-1.5) creates niche pressure |
| Base upkeep | 0.06 | Survivable for plants on grass (harvest ~0.28 * 0.6 * 0.8 = 0.13 >> 0.06) |
| Repro tax | 3.5 | Meaningful cost at 30-60 energy threshold range |
| Repro threshold | 30-60 | Achievable -- creatures can accumulate this in 200-400 ticks on good terrain |
| Max pop | 10% of grid | 3000 creatures on 200x150 -- adequate for ecosystem dynamics |
| Age decay | +0.001/tick after 500 | Very gentle -- creatures live ~1000+ ticks before noticeable |
| Winter upkeep | 1.25x | Mild seasonal pressure |

**Concern:** Apex predators have near-zero harvest genes but `TROPHIC_INVERSE_FACTOR = 0.7` means they only get 30% of terrain food. Combined with `ABSORB_EFFICIENCY = 0.55` and armor reduction, they need ~3-4 kills per reproduction cycle. This is intentionally hard but may cause apex extinction in small populations. The auto-seed at 0 population is the safety net. Consider monitoring apex survival rates.

---

## Territory System Review

The role-based rewrite is clean and correct:
- `markTerritory`: correctly uses `getCreatureRole(pixel) + 1` so role 0 (plant) maps to territory owner 1, keeping 0 as "unclaimed"
- `getTerritoryMoveCost`: correctly compares `myRole` against `owner`, returning 2.0x penalty for foreign territory
- `decayTerritories`: linear decay, clears at max age -- correct
- `getTerritoryColor`: bounds-checks `owner > 7` -- correct, 8 entries including index 0
- Color array has 8 entries (0-7) matching the 7 roles + unclaimed -- correct

No bugs found in the territory system.

---

## Edge Cases Found

1. **Inspector on dead creature:** Handled -- `getTrackedPixel` returns null, panel shows "Creature died". Good.
2. **Population 0:** Handled via `AUTO_SEED_EMPTY_TICKS`. After 100 empty ticks, 50 new creatures spawn.
3. **Canvas resize:** Not handled -- if the window resizes, canvas dimensions are fixed at init. Not critical for a dev sim but worth noting.
4. **Toroidal wrap in tween:** Handled -- renderer skips tween for moves > 2 cells (line 316). Good.
5. **Pixel at negative coordinates:** Impossible -- `wrapX/wrapY` always normalize.

---

## Positive Observations

- Ring buffer for effects (birth/death/interaction) -- zero allocation during gameplay
- Fisher-Yates shuffle for fair tick processing -- no first-mover advantage
- LOD system (3 levels) with appropriate detail reduction at zoom
- Stochastic terrain emission (~25% of cells per tick) creates natural patchiness without starving
- Per-frame cache on inspector pixel lookup avoids O(n) scan at 60fps
- Pre-computed neighbor offsets in substrate diffusion -- good perf optimization
- Camera input registration guard (`_inputsInitialized`) prevents listener stacking in renderer

---

## Recommended Actions (Priority Order)

1. **Add `harvestRate` and `reproTax` to SimConfig** -- eliminates all `(config as any)` casts (H1)
2. **Fix defaults button upkeep value** -- 60 -> 100 (H2)
3. **Fix tween pruning to use Set** -- prevents frame drops at high pop (H3)
4. **Clamp inspector Y position** -- prevents off-screen panel (M1)
5. **Guard `initCanvasInteraction` against re-registration** -- prevents handler stacking on reset (M5)
6. **Extract `shuffled8` to shared util** -- DRY cleanup (M3)
7. **Update territory type comment** and consider Uint8Array downsize (M4)

---

## Unresolved Questions

1. Should apex predators get a scavenging fallback (eat corpses more efficiently) to prevent extinction in small pops?
2. Should `harvestRate` and `reproTax` fields be added as proper SimConfig members, or is the `(config as any)` pattern intentional to avoid touching types.ts?
3. The `aquaticFoodRate()` function in locomotion.ts is exported but never called -- was this meant to feed into substrate emission for water tiles?
