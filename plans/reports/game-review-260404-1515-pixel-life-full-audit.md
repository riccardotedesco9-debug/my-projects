# OOZE Pixel-Life Full Game Review & Code Audit

**Date:** 2026-04-04 | **Reviewer:** code-reviewer | **LOC:** 7,018 across 41 TS files + HTML
**TypeScript compilation:** CLEAN (zero errors)

---

## 1. GAMEPLAY BALANCE

### 1.1 Food Economy: Producers Over-Favored

**Problem:** The food system is too generous for producers and creates an unstable energy surplus.

- `HARVEST_RATE = 0.4` combined with `substrateEmission = 0.012` and terrain-based food rates (Grass=1.0, Forest=0.5) means a producer on grass with decent harvest genes (avg ~200/255 = 0.78) collects:
  - `food_available * 0.78 * 0.4 * foodAffinity(~1.05) * harvestPenalty(1.0) = ~0.33 * available_food` per tick
- Meanwhile `BASE_UPKEEP = 0.05` + low speed/sense costs = total upkeep ~0.07 per tick
- **Net gain is strongly positive** on any food-bearing tile. Producers barely need to move to survive.

**Evidence:** Food patches (`FOOD_PATCH_COUNT = 8`, radius 5-12, strength 0.02-0.04) plus terrain emission plus water adjacency bonus (+30%) plus seasonal boosts (summer 1.4x, spring 1.2x) create food abundance. Only winter (0.8x) and droughts provide real scarcity.

**Impact:** Population will tend toward MAX_POP_FRACTION (10% = 3,000 pixels) quickly, then oscillate at the cap rather than through natural predator-prey dynamics.

**Fix:**
- Reduce `HARVEST_RATE` to **0.25** (from 0.4) -- forces producers to compete harder
- Reduce `FOOD_PATCH_COUNT` to **5** (from 8) -- fewer free lunch zones
- Increase `BASE_UPKEEP` to **0.07** (from 0.05) -- makes "just existing" cost more

### 1.2 Predator Economics: Absorbers Are Either Feast or Famine

**Problem:** `ABSORB_EFFICIENCY = 0.8` is extremely generous. A single kill of a 50-energy prey yields:

- Base: `50 * 0.8 * (0.3 + absorbSkill * 0.7)` -- for a pure apex (reactType ~5, absorbSkill ~0.92): `50 * 0.8 * 0.94 = 37.6 energy`
- With pack bonus (1.5x): **56.4 energy** -- more than the prey had after armor reduction
- One kill feeds a predator for ~400+ ticks at BASE_UPKEEP (0.07 base + speed/sense costs ~0.15 total)

**Impact:** A successful predator can sustain itself with one kill every ~250 ticks. This is too easy. Predators either find prey quickly (feast) or the population crashes before they find any (famine). No middle ground.

**Fix:**
- Reduce `ABSORB_EFFICIENCY` to **0.55** (from 0.8) -- kills still rewarding but require more frequent hunting
- Reduce `PACK_HUNT_BONUS` to **1.25** (from 1.5) -- packs still advantageous but not dominant

### 1.3 Same-Species Protection: Energy Threshold Too Low

**Problem:** `similarity > 12 AND energy > 25` skips attacks. With energy > 25 covering ~70%+ of a predator's lifetime, same-species protection is almost always active.

**Impact:** Predators will almost never attack kin, which means large populations of similar predators peacefully coexist while only hunting dissimilar species. This eliminates intraspecific competition -- a critical driver of evolution.

**Fix:**
- Raise energy threshold to **45** (from 25) -- kin protection only when well-fed, hungry predators still compete
- OR lower similarity threshold to **14** (from 12) -- only very close relatives protected

### 1.4 Pack Hunting: Packs Are Overpowered

**Problem:** Pack formation requires adhesion > 180 and 3+ members within 5 cells. The 1.5x kill bonus stacks with already-high absorb efficiency. A pack of 3 apex predators can kill any creature in one tick.

**Additional issue:** Pack formation (`PACK_FORMATION_INTERVAL = 50` ticks) completely rebuilds all packs from scratch every 50 ticks. This means packs are ephemeral -- they form, hunt, dissolve, reform. No persistent social structure.

**Fix:**
- `PACK_HUNT_BONUS = 1.25` (from 1.5)
- Increase `PACK_MIN_MEMBERS` to **4** (from 3) -- real packs need more members
- Add persistence: instead of clearing all packs every 50 ticks, only dissolve packs whose members have scattered beyond PACK_PROXIMITY

### 1.5 Swimming/Flying Balance

**Swimming:** Harvest_B > 180 + 10% upkeep + 0.7x water move cost + 1.3x land cost. Swimmers can access water tiles (food rate 0.3). This is **reasonably balanced** -- water food is less than grass (1.0) but swimmers face less competition. The 1.3x land penalty creates genuine niche separation.

**Flying:** Speed > 200 + Armor < 60 + 40% upkeep + 0.8x move cost on all terrain. Flying is **too expensive**. The 40% upkeep multiplier on top of already-high speed upkeep (`SPEED_UPKEEP * (speed/255)` where speed > 200/255 = 0.78, so ~0.062) means total upkeep is:
- `(0.05 + 0.062 + sense_cost) * 1.4 = ~0.18 per tick` for a fast flyer
- With move cost reduction (0.8x) and terrain ignoring, net savings are ~0.004 per move
- **The upkeep penalty far outweighs the mobility advantage**

**Fix:**
- Reduce flying upkeep to **1.25** (from 1.4) -- still expensive but survivable
- OR increase the move cost benefit to **0.6x** (from 0.8) -- bigger payoff for the investment

### 1.6 Territory System: Largely Decorative

**Problem:** Territory marking (adhesion > 150, radius 3, 200 tick decay) with 1.4x foreign movement cost. The penalty is too small and too easy to ignore. A creature paying 0.02 * 1.4 = 0.028 per move in foreign territory barely notices the extra 0.008 cost.

**Impact:** Territory provides almost no strategic advantage. It's visual fluff.

**Fix:**
- Increase `TERRITORY_MOVE_PENALTY` to **2.0** (from 1.4) -- entering foreign territory is genuinely costly
- Increase `TERRITORY_MARK_RADIUS` to **5** (from 3) -- territories are larger and more impactful
- Add: territory should provide a food harvest bonus (+15%) for the owner

### 1.7 Food Specialization: Weak Niche Separation

**Problem:** `foodAffinity` ranges from 0.5 (wrong terrain) to 1.2 (perfect match). The difference is only 2.4x. A creature with max Harvest_R on grass gets foodAffinity 1.2. The same creature on dirt (B-dominant) still gets 0.5. That's not punishing enough to force niche commitment.

**Fix:**
- Widen the range: wrong terrain = **0.2**, right terrain = **1.5** -- 7.5x difference forces real specialization
- Sand foodAffinity should be **0.15** (from 0.4) -- sand is barren, not a general fallback

### 1.8 Reproduction Dynamics

**Problem:** `REPRO_MIN_ENERGY = 30`, `REPRO_MAX_ENERGY = 60`. With energy equilibrium at 50-70 for well-positioned producers, reproduction happens constantly. The `REPRO_TAX = 2.5` split between parent and child is negligible.

**Impact:** Exponential growth until the 10% pop cap. The cap becomes the primary population regulator, not natural selection.

**Fix:**
- Increase `REPRO_TAX` to **5.0** (from 2.5) -- reproduction is a serious investment
- Increase `REPRO_MIN_ENERGY` to **40** (from 30) -- need to be well-fed, not just surviving

### 1.9 Degenerate Strategies

**Risk 1: Swarm immortality.** Swarm creatures (adhesion > 200, sharer reaction type) cluster and share energy. With `COOPERATION_BONUS = 0.06` per tick (exceeding BASE_UPKEEP of 0.05), a cluster of 3+ swarm members gains energy just by existing. Combined with energy sharing (averaging two creatures' energy), swarms can sustain indefinitely without food.

**Fix:** `COOPERATION_BONUS = 0.04` (from 0.06) -- must still be below BASE_UPKEEP so cooperation helps but doesn't replace food

**Risk 2: Apex predators with armor > 200 are nearly unkillable.** Armor reduces absorb damage by `(1 - armor/255)`. At armor 200, that's 0.22x damage. Combined with the armor threshold check (`defenderArmor > reactType * 4` gives another 0.5x), a high-armor apex takes ~0.11x damage. Nothing can kill it except starvation.

**Fix:** Cap armor damage reduction at 0.7x minimum (armor can never reduce damage below 30%). Add to `resolveAbsorb`:
```typescript
amount *= Math.max(0.3, 1 - defenderArmor / 255);
```

---

## 2. AI BEHAVIOR

### 2.1 Movement Decision Chain: Too Many Overlapping Biases

The movement system in `movePixel` applies biases sequentially:

1. Sensing (food/pheromone/pixel seek/flee) -- base direction
2. Memory bias blended at 30% weight
3. Pack bias at 40% weight
4. Migration bias at 25-50% weight

**Problem:** These weights don't sum to 1.0 and are applied sequentially with `Math.sign(Math.round(...))`. The quantization to {-1, 0, 1} at each step destroys gradient information. A creature simultaneously influenced by memory, pack, and migration will have its direction overwritten multiple times, with each step's `Math.sign(Math.round(...))` collapsing nuance to a binary choice.

**Impact:** Later biases dominate earlier ones. Pack bias (applied third) often overrides memory and sensing. Migration (applied fourth) can override everything.

**Fix:** Accumulate all biases as weighted vectors first, then quantize once:
```typescript
let fx = 0, fy = 0;
fx += senseDx * 0.4; fy += senseDy * 0.4;
fx += memBx * 0.2;   fy += memBy * 0.2;
fx += packBx * 0.25; fy += packBy * 0.25;
fx += migBx * 0.15;  fy += migBy * 0.15;
bestDx = Math.sign(Math.round(fx)) || bestDx;
bestDy = Math.sign(Math.round(fy)) || bestDy;
```

### 2.2 Spatial Memory: Functional but Subtle

- 8 entries, 0.5% decay per tick (MEMORY_DECAY_RATE = 0.995), food threshold 0.4
- At 0.995 decay: strength halves every ~139 ticks. With season length 2000 ticks, memories last about 1/14 of a season.
- **Verdict:** Memory is too short-lived to produce interesting long-term navigation. Creatures forget good food spots before the season repeats.

**Fix:**
- `MEMORY_DECAY_RATE = 0.998` (from 0.995) -- memories last ~347 ticks, ~1/6 of a season
- Increase `MEMORY_MAX_ENTRIES` to **12** (from 8) -- richer spatial map

### 2.3 Migration: Works In Theory, Invisible In Practice

Migration requires speed > 150 and updates targets every 100 ticks. Seasonal food memory stores positions from previous seasons. The latitude gradient (0.75-1.25x food based on y-position and season) creates the pressure.

**Problem:** The gradient is only 1.67x between best and worst latitude. Combined with the 100-tick update interval and 25% movement weight (50% for nomads), migration direction changes very slowly. On a 200x150 world, crossing the map takes ~75 ticks at max speed -- but migration targets are recalculated from averaged positions that converge to the map center over time.

**Impact:** Migration looks like a slight drift, not visible seasonal movement.

**Fix:**
- Strengthen latitude gradient to **0.5-1.5x** (from 0.75-1.25) -- 3x difference creates real pressure
- Increase migration weight to **0.35** for non-nomads, **0.6** for nomads
- Don't average seasonal memory positions -- keep the best single position per season

### 2.4 Emergent Behavior Assessment

**What works well:**
- Predator-prey chasing is visible and dramatic
- Pack formation creates visible hunting groups
- Forest camouflage (50% miss chance) creates ambush zones
- Worn paths from creature traffic are a wonderful emergent feature
- Corpse battlefields create scavenger hotspots

**What doesn't emerge:**
- No visible speciation events (species clustering is too permissive at threshold 20)
- No stable ecosystem equilibria (pop cap does all the work)
- No territorial wars (territory is too weak)
- No seasonal migration patterns (gradient too subtle)

---

## 3. VISUAL CLARITY

### 3.1 LOD 2 (Zoomed In): GOOD

- 16x16 sprites are well-designed, chunky, and distinguishable
- All 7 roles have distinct silhouettes: flower, wolf, lion, cross (scavenger), star (parasite), hexagon (swarm), arrow (nomad)
- Walk animations (2-frame) give life to the scene
- Energy/armor bars below sprites are readable and useful
- Flying hover + shadow and swimming ripple animations are clear indicators

### 3.2 LOD 0/1 (Zoomed Out): MIXED

- Role shapes (circles, triangles, diamonds, etc.) work at medium zoom but become indistinguishable at LOD 0
- Cluster labels ("Plant x12", "Wolf x5") help but fire at a 2.5px font size in world space -- may be unreadable at some zoom levels
- The population bar at bottom is helpful for macro-level species balance tracking

### 3.3 Behavior Icons: PROBLEMATIC

- Icons use `font: bold ${S * 0.45}px` where S = 5, so 2.25px font -- this is **sub-pixel** and will render as blurry smudges on most displays
- Unicode characters (crossed swords, shamrock, tilde, heart, radioactive) render inconsistently across browsers
- The FOOD icon (custom drawn drumstick) at S*0.2 = 1px is barely a pixel

**Fix:**
- Only render behavior icons when `S * camera.zoom > 12` (icons need at least 12px to be readable)
- Use colored dots/shapes instead of text/unicode for icons -- they scale better
- Currently icons render at all LOD 2+ zoom levels; gate them to LOD 2 with zoom > 4

### 3.4 Pack Connection Lines: TOO SUBTLE

- `rgba(255,120,60,0.2)` with 0.4px line width and 1,2 dash pattern
- At default zoom, these are literally invisible on most monitors
- **Fix:** Increase to `rgba(255,120,60,0.4)` with 0.8px line width

### 3.5 Weather Particles: Scale Issue

Weather particles spawn with coordinates based on `world.width * 5` and `world.height * 5` (hardcoded pixelScale = 5). But particles are drawn in world space with camera transform applied.

**Bug:** When zoomed in, weather particles are very sparse (they're distributed across the full world but you're only seeing a fraction). When zoomed out, they're too dense.

**Fix:** Particle count should scale with the visible viewport area, not world area.

---

## 4. CODE QUALITY

### 4.1 Bugs Found

**BUG 1: Dead creature still processed after kill-on-contact (CRITICAL)**

In `reactions.ts:resolveAbsorb()` line 79:
```typescript
world.pixels.delete(cellIdx);  // Uses cellIdx (number) directly
```
But in `world.ts:removePixel()`:
```typescript
world.pixels.delete(pixel.y * world.width + pixel.x);
```
The `resolveAbsorb` function manually deletes the pixel and creates a corpse, bypassing `removePixel()`. If `removePixel` ever adds cleanup logic (e.g., clearing territory), `resolveAbsorb` will miss it.

**Fix:** Use `removePixel(world, defender)` instead of manual delete.

**BUG 2: Tween position map leaks memory**

`renderer.ts` line 618: `_tweenPositions` is a `Map<number, {...}>` keyed by pixel ID. When pixels die, their entries are never removed. Over a long session with thousands of births/deaths, this map grows unbounded.

**Fix:** Periodically (every 100 frames) sweep `_tweenPositions` and remove entries for dead pixel IDs, or use a WeakRef pattern.

**BUG 3: Sexual reproduction samples from stale array**

`simulation.ts:checkSexualReproduction()` line 88:
```typescript
const pixels = Array.from(world.pixels.values());
```
This snapshot is taken once, but the loop modifies the world (creating new pixels). New pixels from sexual reproduction within the same tick won't be in the sample -- that's fine. But if a pixel dies from metabolize earlier in the tick and gets sampled for sexual reproduction, it will fail gracefully (findEmptyNear returns null). Not a crash, but wasted computation.

**BUG 4: `aquaticFoodRate()` in locomotion.ts is defined but never called**

The function returns 0.4 but nothing imports or uses it. The actual water food rate is in `terrain.ts:terrainFoodRate()` which returns 0.3 for water. These values disagree.

**Fix:** Remove unused `aquaticFoodRate()` from locomotion.ts.

**BUG 5: `applyBehavioralSwitch` in regulation.ts is never called**

Exported function that modifies senseTarget based on regulatory genes, but `movement.ts` reads GENE.SENSE_TARGET directly via `getEffectiveGene` and applies its own state overrides. The behavioral switch function is dead code.

**Fix:** Either integrate it into the movement pipeline or remove it.

### 4.2 Performance Concerns

**P1: O(n^2) pack formation** -- `pack-hunting.ts` line 62 iterates all candidates for every candidate in the queue. With 200+ predators, this is O(n^2) every 50 ticks. Not terrible but a spatial hash would make it O(n).

**P2: O(n^2) species clustering** -- `species-tree.ts` line 63 iterates all sampled pixels for every seed pixel. Capped at 300 samples, so worst case ~90,000 comparisons per SPECIES_COMPUTE_INTERVAL (100 ticks). Acceptable but could use spatial hashing.

**P3: Full-world territory decay** -- `territory-system.ts:decayTerritories()` iterates all 30,000 cells (200*150) every tick. Most cells are unclaimed. Use a Set of claimed cell indices instead.

**P4: Substrate neighbor offset table** -- `substrate.ts` pre-computes a `Int32Array(200*150*8) = 240,000 entries`. This is ~960KB of memory. Acceptable but could be computed inline.

**P5: `popHistory` uses Array.shift()** -- `world.ts:recordPopulation()` calls `popHistory.shift()` which is O(n) for arrays. With POP_HISTORY_LENGTH=500, this means copying 499 elements every tick. Use a ring buffer.

### 4.3 Module Organization

- `renderer.ts` at **803 lines** is the largest file and exceeds the 200-line target by 4x. Should be split into: `render-substrate.ts`, `render-creatures.ts`, `render-weather.ts`, `render-hud.ts`.
- `sprites.ts` at **594 lines** is mostly data (sprite templates). Acceptable for a data-heavy file.
- `terrain-tiles.ts` at **290 lines** is borderline.
- All other files are within guidelines.

### 4.4 DRY Violations

- `shuffled8()` is copy-pasted in 4 files: `reproduction.ts`, `sexual-reproduction.ts`, `reactions.ts`, `adhesion.ts`. Extract to a shared utility.
- `DX/DY` 8-neighbor offset arrays are defined in 4 separate files. Extract to a shared constant.
- `toCanvasCenter()` is defined in `effects.ts` but used across rendering code. Fine, but the import path is unusual.

### 4.5 Type Safety

- TypeScript strict mode compiles clean -- no errors.
- The `const enum Terrain` prevents runtime access to enum names but works for value comparison.
- `Pixel.state` as `Uint8Array(3)` is functional but loses semantic clarity. A named tuple type would be clearer: `{ threat: number; satiety: number; social: number }`.
- Module-level mutable state (`let lastFormationTick`, `let snapshots`, `let _lastWorld`) makes testing difficult. Consider encapsulating in class instances or closures.

---

## 5. SPECIFIC RECOMMENDATIONS (Priority Ordered)

### CRITICAL

| # | Issue | File | Fix |
|---|-------|------|-----|
| C1 | Dead pixel bypass of removePixel | reactions.ts:79 | Replace manual delete with `removePixel(world, defender)` |
| C2 | Tween map memory leak | renderer.ts:618 | Add periodic cleanup of `_tweenPositions` for dead pixels |

### HIGH

| # | Issue | File | Fix |
|---|-------|------|-----|
| H1 | Food economy too generous | constants.ts | `HARVEST_RATE=0.25`, `BASE_UPKEEP=0.07`, `FOOD_PATCH_COUNT=5` |
| H2 | Absorb efficiency too high | constants.ts | `ABSORB_EFFICIENCY=0.55` |
| H3 | Same-species threshold too easy | reactions.ts:31 | Change `energy > 25` to `energy > 45` |
| H4 | Flying upkeep too punishing | locomotion.ts:56 | `return 1.25` (from 1.4) |
| H5 | Cooperation bonus exceeds upkeep | constants.ts | `COOPERATION_BONUS=0.04` (from 0.06) |
| H6 | Movement bias chain destroys info | movement.ts:50-82 | Accumulate all biases as weighted vectors, quantize once |
| H7 | Armor makes creatures unkillable | reactions.ts:60 | `Math.max(0.3, 1 - defenderArmor / 255)` |

### MEDIUM

| # | Issue | File | Fix |
|---|-------|------|-----|
| M1 | Territory system decorative | constants.ts | `TERRITORY_MOVE_PENALTY=2.0`, `TERRITORY_MARK_RADIUS=5` |
| M2 | Food specialization too weak | metabolism.ts:38-48 | Wrong terrain=0.2, right terrain=1.5 |
| M3 | Memory decays too fast | constants.ts | `MEMORY_DECAY_RATE=0.998` |
| M4 | Migration invisible | substrate.ts:70-77 | Latitude gradient 0.5-1.5x (from 0.75-1.25) |
| M5 | Repro tax too low | constants.ts | `REPRO_TAX=5.0`, `REPRO_MIN_ENERGY=40` |
| M6 | renderer.ts 803 lines | renderer.ts | Split into 4 files by concern |
| M7 | shuffled8() duplicated 4x | multiple | Extract to shared utility |
| M8 | Dead code: aquaticFoodRate | locomotion.ts:62 | Remove |
| M9 | Dead code: applyBehavioralSwitch | regulation.ts:28 | Remove or integrate |
| M10 | popHistory uses Array.shift | world.ts:94 | Use ring buffer |

### LOW

| # | Issue | File | Fix |
|---|-------|------|-----|
| L1 | Pack formation rebuilds from scratch | pack-hunting.ts:35-36 | Incremental pack updates instead of full clear |
| L2 | Full-world territory decay scan | territory-system.ts:42 | Track claimed cells in a Set |
| L3 | Behavior icons at sub-pixel size | renderer.ts:711 | Gate icons to zoom > 4x |
| L4 | Pack lines too subtle | renderer.ts:632 | Increase alpha to 0.4, width to 0.8 |
| L5 | Weather particles don't scale with zoom | renderer.ts/weather.ts | Scale particle count to viewport |

---

## 6. POSITIVE OBSERVATIONS

1. **Clean architecture.** 41 well-named modules with clear single responsibilities (except renderer.ts). Module boundaries are logical.
2. **Zero TypeScript errors.** Strict mode, proper typing throughout.
3. **Efficient data structures.** Float32Array for substrate, Uint8Array for terrain/corpses/wear, Map for pixel lookup. Good memory layout choices.
4. **Ring buffer effects system.** `effects.ts` uses fixed-size arrays with head pointers -- no GC pressure during gameplay.
5. **Fisher-Yates shuffle** for fair processing order -- statistically correct.
6. **Dual-canvas architecture** separates static terrain from dynamic creatures, avoiding full-screen redraws.
7. **LOD system** with 3 tiers is well-designed and provides appropriate detail at each zoom level.
8. **Tween interpolation** for smooth creature movement is a nice touch.
9. **Weather system** is comprehensive (7 types, seasonal weighting, intensity scaling) and integrates with all game systems.
10. **Corpse/scavenger cycle** creates real nutrient cycling -- dead creatures feed the living, which is ecologically elegant.

---

## 7. OVERALL VERDICT

The simulation is technically solid and architecturally clean, but **the balance is wrong**. The core issue is that food is too abundant and reproduction is too cheap, so the population always rushes to the cap. Predator-prey dynamics are swamped by the cap acting as the primary regulator instead of natural selection.

The secondary issue is that several "deep" systems (territory, migration, food specialization, spatial memory) are tuned too weakly to produce visible emergent behavior. They exist in code but don't manifest as observable patterns in gameplay.

**If you fix only three things:**
1. Tighten the food economy (H1 + M5)
2. Fix the movement bias chain (H6)
3. Strengthen niche systems (M1 + M2 + M4)

These three changes would transform the simulation from "pretty screensaver" to "emergent ecosystem with visible evolutionary arms races."

---

## Unresolved Questions

1. Is the `canBirthOn()` restriction (only Grass/Forest/Dirt) intentional for swimmers? Aquatic creatures can enter water but can never reproduce there since `canBirthOn` excludes WATER terrain. This means swimmers must return to land to breed -- ecologically interesting but possibly unintended.
2. The `BLOOM_MULT = 8` constant is defined but never used. `applyBloom` adds a flat 0.05 food instead. Dead constant or intended for future use?
3. Pack leader position is cached at formation time but never updated between reforms (50 ticks). A moving leader's pack follows a ghost position. Is this intentional (simulating "last known position" communication) or a limitation?
4. `Pixel.id` is assigned from `world.nextPixelId++` which never wraps. After millions of births, `territory` (Uint16Array) can only store IDs 0-65535. Territory ownership will silently alias after 65K creatures. Use modular ID assignment or expand to Uint32Array.
