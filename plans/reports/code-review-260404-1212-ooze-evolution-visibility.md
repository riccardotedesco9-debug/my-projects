# Code Review: OOZE Pixel Evolution -- Visual Overhaul (3 Phases)

**Date**: 2026-04-04
**Scope**: 10 files changed, 165 insertions, 68 deletions + 1 new file (`effects.ts`, 83 lines)
**Focus**: Correctness, performance, balance, integration, edge cases
**TypeScript compile**: CLEAN (zero errors)

---

## Overall Assessment

Solid, well-structured set of changes that achieves the stated goal of making evolution and environment visually tangible. The code is clean, well-commented, and consistent with the existing codebase style. No critical bugs found. A few medium-priority correctness and performance issues documented below.

---

## Critical Issues

None.

---

## High Priority

### H1. Operator precedence bug in terrain corpse/food coloring (terrain.ts, renderer.ts)

Bitwise OR `|` has **lower precedence than addition**. Several expressions produce wrong results:

```typescript
// terrain.ts:127-129
r = Math.min(255, r + (cf * 50) | 0);   // evaluates as: Math.min(255, (r + (cf*50)) | 0)
g = Math.min(255, g + (cf * 10) | 0);   // the | 0 truncates the ENTIRE sum, not just cf*50
b = Math.max(0, b - (cf * 5) | 0);      // same problem
```

When `r` is e.g. 180 and `cf * 50 = 25.6`, this computes `Math.min(255, (180 + 25.6) | 0)` = `Math.min(255, 205)` = 205. That happens to be correct *by accident* because `| 0` on the full sum is still a valid truncation. However it is semantically confusing and **breaks for the `Math.max(0, ...)` case**: `Math.max(0, (b - cf*5) | 0)` would clamp negative sums to a wrong 32-bit integer before `Math.max` sees it.

Actually, `| 0` on a negative float like -3.7 gives -3 (not 0), so `Math.max(0, -3)` correctly returns 0. So no data corruption here, but the precedence is still misleading and fragile.

**Same pattern appears in renderer.ts lines 64-66 and 70-71** (food overlay / depletion tint). All work "by accident" but are fragile.

**Recommendation**: Add explicit parentheses: `r = Math.min(255, r + ((cf * 50) | 0));`

### H2. weatherSpeedMult can return <= 0 (weather.ts:143-149)

```typescript
case 'storm': return 1 - weather.intensity * 0.4;
```

`weather.intensity` is set at line 31: `0.3 + Math.random() * 0.7`, giving range `[0.3, 1.0]`. After `scaleIntensity`, winter storms can reach `1.0 * (0.6 + 1.0 * 0.5) = 1.1`. Then `weatherSpeedMult = 1 - 1.1 * 0.4 = 0.56` -- still positive.

But if `scaleIntensity` ever returns > 2.5 (future tuning), speed goes negative, causing `Math.random() > negative` to always be true, making all creatures freeze. **Currently safe**, but fragile.

**Recommendation**: Clamp return value: `return Math.max(0.1, 1 - weather.intensity * 0.4);`

### H3. Food curve change is a major balance shift (terrain.ts:47-49)

```
Dirt: 0.3 --> 0.12  (60% reduction)
Sand: 0.1 --> 0.02  (80% reduction)
Forest: 0.6 --> 0.5  (17% reduction)
```

Combined with drought multiplier increase (0.5 -> 0.6) and heatwave (0.15 -> 0.25), total food availability in non-grass terrain drops dramatically. Sand cells are now nearly barren (`0.02 * base_emission` is almost zero).

This could cause population crashes in runs where grass coverage is low (unlucky terrain generation). The seasonal latitude gradient (0.75x multiplier on sparse side) further compounds this.

**Recommendation**: Monitor energy balance. If extinction events become too frequent, consider raising `SAND` back to 0.05 or increasing `AUTO_SEED_COUNT`. This isn't a bug, but it's the highest-risk balance change in this PR.

---

## Medium Priority

### M1. effects.ts ring buffer: stale entries rendered (effects.ts:57-67)

When the ring buffer wraps, old entries with `age >= BIRTH_LIFETIME` remain in the array and are iterated every frame. With `MAX_BIRTHS = 60` and `MAX_DEATHS = 80`, the loop iterates 140 items per frame. Each expired entry hits the `continue` branch, which is cheap but wastes cycles.

Not a real problem at 140 items, but if these limits grow, it matters.

**Minor**: The birth ring buffer pushes new entries until `length < MAX_BIRTHS`, then overwrites at `birthHead`. The `birthHead` advances regardless. This is correct -- no overflow bug.

### M2. Generation outline overlaps swarm ring (renderer.ts:180-185, 193-200)

Swarm creatures (role 5) already draw a ring at `radius + 1.5` (line 184). The generation marker also draws at `radius + 1.5` (line 198). For swarm creatures with `generation > 10`, both rings overlap at the same radius, creating visual noise/muddy color.

**Recommendation**: Offset the generation ring to `radius + 3` when `role === 5`, or skip generation outlines for swarm.

### M3. Adaptation glow only in 'normal' view mode (renderer.ts:112-119)

The terrain fitness boost only applies in `viewMode === 'normal'`. This is intentional (stated in the PR), but worth noting that 'substrate' mode also uses `dnaToColor` (line 101), so the visual appearance differs between modes. Not a bug, just a design choice to document.

### M4. DRY: Death effect coordinate calculation repeated 3 times

The pattern `pixel.x * config.pixelScale + config.pixelScale / 2` appears identically in:
- `metabolism.ts:71`
- `reactions.ts:61`
- `reproduction.ts:71`
- `sexual-reproduction.ts:81`

**Recommendation**: Extract a helper `pixelToCanvasCenter(pixel, config)` into `effects.ts` or a shared utility.

### M5. getSeasonalLatitude never returns for unexpected season (substrate.ts:69-77)

The switch statement covers all 4 seasons but has no `default` case. TypeScript's exhaustiveness checking should catch this since `Season` is a union type, so this is safe. But an explicit `default: return 1;` would be more defensive.

---

## Low Priority

### L1. Unused parameters in renderEffects (effects.ts:55)

`_dw` and `_dh` are declared but unused. They could be removed or used for bounds-checking particles that fly off-screen.

### L2. Death particles have gravity but no bounds check (effects.ts:79-80)

`d.y += d.dy; d.dy += 0.3;` means particles accelerate downward. After 5 frames they've moved ~6px down. At `DEATH_LIFETIME = 5`, they're culled before going far. No issue currently, but if lifetime increases, particles could drift off-canvas with no visual effect.

### L3. Magic numbers in renderer.ts

`bodyMass` formula (line 142), `baseRadius` (line 143), glow thresholds (line 147), generation thresholds (10, 50) -- all hardcoded. Consider extracting to constants if they'll be tuned frequently.

---

## Edge Cases Found by Scout

1. **`const enum Terrain` comparison safety**: `world.terrain[ci] >= Terrain.GRASS` (renderer.ts:68) works correctly because `const enum` compiles to integer literals. However, if `Terrain` order ever changes, this comparison breaks silently. Currently GRASS=3, FOREST=4, ROCK=5 -- the comparison intends "fertile terrain" which is correct.

2. **Corpse parameter default in terrainColorInContext**: The new signature uses `corpse = 0` default, so any existing callers without the parameter still work. Verified: only `renderer.ts` calls it, and it now passes `world.corpses[ci]`. Clean.

3. **Birth effect color uses parent's energy, not child's**: In `reproduction.ts:70`, `dnaToColor(pixel.dna, pixel.energy, ...)` uses the parent's post-split energy. This is a design choice (shows parent lineage color), not a bug. Sexual reproduction (line 80) uses child DNA + child energy, which is the alternative approach. Slight inconsistency but visually fine.

4. **weatherSpeedMult stacks with terrainSpeedMult**: In `movement.ts:16`, both multipliers are multiplied together. A storm (0.56x) + sand (0.5x) = 0.28x effective speed. Creatures in sand during storms are nearly immobile. This is dramatic but could cause mass starvation if storms are long. Current storm duration (300-800 ticks) is survivable since upkeep still ticks.

5. **No circular dependency risk**: `effects.ts` has zero imports from project modules (only uses native types). It's imported by metabolism, reactions, reproduction, sexual-reproduction, and renderer. Clean dependency graph, no cycles.

---

## Positive Observations

- **Ring buffer pattern in effects.ts** is allocation-free during gameplay -- good for 30fps performance
- **Consistent coordinate transform** (`pixel.x * config.pixelScale + config.pixelScale / 2`) correctly centers effects on the canvas pixel
- **Food overlay always-on** is a good UX choice -- players can see food availability without switching view modes
- **Seasonal latitude gradient** adds meaningful migration pressure without complex pathfinding
- **Corpse staining moved to terrainColorInContext** is a cleaner separation of concerns than the previous renderer-only approach
- **Weather affects both movement cost AND speed probability** -- double effect creates visible behavioral change during storms

---

## Recommended Actions (Priority Order)

1. **Add parentheses** to all `| 0` truncation expressions for clarity (H1) -- 5 minutes
2. **Clamp weatherSpeedMult** return to `Math.max(0.1, ...)` (H2) -- 1 minute
3. **Playtest food balance** under drought + winter + sand-heavy terrain (H3) -- manual testing
4. **Offset generation ring for swarm** to avoid visual overlap (M2) -- 2 minutes
5. **Extract coordinate helper** for death/birth effect positions (M4) -- 5 minutes
6. **Remove unused `_dw`/`_dh` params** from renderEffects (L1) -- 30 seconds

---

## Metrics

- **Type Coverage**: 100% (strict mode, compiles clean)
- **Test Coverage**: N/A (no test suite in project)
- **Linting Issues**: 0 compile errors
- **New file**: `effects.ts` (83 lines, well within 200-line guideline)
- **Largest file**: `renderer.ts` (277 lines, acceptable for rendering code)

---

## Unresolved Questions

1. Has the food curve change been playtested for >5 minutes? Sand/dirt populations may collapse in edge-case terrain generation.
2. Should `weatherSpeedMult` and `weatherMoveCostMult` be combined or kept separate? They both reduce mobility but through different mechanisms (skip-turn probability vs energy cost).
3. The `getTerrainFitness` function in renderer.ts is rendering-only. Should this data also feed into gameplay (e.g., energy bonus for adapted creatures)?
