# Code Review: OOZE Pixel Life - Final Pre-Ship Review

**Date**: 2026-04-04
**Scope**: All 24 source files in `src/` (2874 LOC)
**TypeScript compilation**: CLEAN (zero errors)

---

## Overall Assessment

Solid simulation with clear architecture. The modular decomposition is excellent - each system has a focused file. Energy balance math is viable but has edge-case risks. Several dead exports, one logic bug in weather intensity scaling, and one `any` type need attention before ship.

---

## CRITICAL Issues

### C1. `canvasToGrid` returns display-pixel coords, not grid coords
**File**: `ui-controls.ts:90-96`

The function converts mouse position to canvas pixel coords (0-1000, 0-750) but the callers at lines 61, 75 treat the result as grid coords (0-200, 0-150). The `pixelScale` division is missing.

```typescript
// Current: returns canvas pixels (0 to canvas.width)
const gx = Math.floor((e.clientX - rect.left) / rect.width * canvas.width);
// Should return: grid coords (0 to world.width)
const gx = Math.floor((e.clientX - rect.left) / rect.width * canvas.width / config.pixelScale);
```

Wait -- re-reading: `canvas.width = w * s` (1000) and `rect.width` is also 1000 (since style.width matches). So `(clientX - left) / rect.width * canvas.width` gives 0-1000. This is then used as `x` in `paintSubstrate` at line 99 which checks `x >= world.width` (200). So **any click beyond pixel 200 of 1000 is out-of-bounds and rejected**. The `pixelCanvas` (line 27 in main.ts) is the one passed to `initCanvasInteraction`. Its width is 1000.

**Verdict**: BUG. Only the leftmost 20% and topmost 20% of the canvas is clickable/paintable. Grid coordinates should be `Math.floor((e.clientX - rect.left) / rect.width * world.width)` but `_config` prefix means `config` is intentionally unused. The function needs `config.pixelScale` or `world.width/height`.

**Impact**: Clicking/painting/inspecting pixels only works in the top-left corner.
**Severity**: CRITICAL - core interaction broken.

---

## HIGH Priority

### H1. `weather.scaleIntensity` uses hardcoded 500 instead of config.seasonLength/4
**File**: `weather.ts:67`

```typescript
const progress = world.seasonTick / 500; // 0-1 within season quarter
```

Season quarter length is `config.seasonLength / 4` = `2000/4 = 500` by default. But if user changes seasonLength via slider, this breaks. `world` doesn't carry `config`, so the function has no access.

**Impact**: Weather intensity scaling breaks when user adjusts season slider.
**Fix**: Pass `config` to `scaleIntensity` or store quarter-length on `world`.

### H2. `world.weather` typed as `any`
**File**: `types.ts:69`

```typescript
weather: any; // Weather state (typed in weather.ts)
```

Every call to weather functions (`weatherUpkeepMult`, `weatherFoodMult`, etc.) passes `world.weather` without type safety. A typo accessing a property would silently return `undefined`.

**Fix**: Import and use `Weather` type from `weather.ts`, or define inline.

### H3. `paintChannel` parameter ignored in `paintSubstrate`
**File**: `ui-controls.ts:98`

```typescript
function paintSubstrate(world: World, x: number, y: number, _ch: number): void {
```

The `_ch` parameter (from `config.paintChannel`, switchable with keys 1/2/3) is never used. The function always paints generic `food`. This was clearly intended to paint different substrate channels (R/G/B) but the substrate model was simplified to a single food float.

**Impact**: Feature incomplete - keyboard shortcuts 1/2/3 do nothing visible.
**Fix**: Either remove `paintChannel` from config and keyboard bindings, or repurpose (e.g., paint food at different intensities).

### H4. Prey death in `resolveAbsorb` bypasses corpse/nutrient cycling from `metabolism`
**File**: `reactions.ts:52-61`

When a predator kills prey, the code does:
```typescript
world.pixels.delete(dy * world.width + dx);
world.corpses[dy * world.width + dx] = Math.min(255, Math.floor(amount * 1.5));
```

This bypasses `removePixel()` from `world.ts`. While functionally equivalent (both call `world.pixels.delete`), it means the death-substrate-release logic in `metabolism.ts:68-69` is skipped. Prey killed by predators don't release food to the substrate on death - only natural deaths do.

**Impact**: Predator-killed prey return less nutrients to the ecosystem than natural deaths.

---

## MEDIUM Priority

### M1. Dead exports (never imported anywhere)

| Export | File:Line | Notes |
|--------|-----------|-------|
| `applyBehavioralSwitch` | `regulation.ts:28` | Defined but never called |
| `getFood` | `world.ts:69` | Defined but never used |
| `isWallPixel` | `pixel-state.ts:29` | Defined but never used (wall check inlined in `renderer.ts:123`) |
| `getSeasonProgress` | `seasons.ts:24` | Defined but never called |
| `SEASON_ORDER` | `constants.ts:39` | Exported but `seasons.ts:3` defines its own local copy |
| `FOOD_PATCH_STRENGTH` | `constants.ts:88` | Never imported (patches use inline `0.02 + random * 0.02` in `world.ts:47`) |
| `FOOD_PATCH_DRIFT_SPEED` | `constants.ts:91` | Never imported (patches use inline `0.02` in `world.ts:48`) |
| `BLOOM_MULT` | `constants.ts:105` | Never imported (bloom uses hardcoded `0.05` in `events.ts:92`) |
| `SUBSTRATE_SATURATION_LIMIT` | `constants.ts:36` | Never imported |
| `PHEROMONE_DIFFUSION_MULT` | `constants.ts:95` | Never imported (pheromone uses same diffusion as food) |
| `CAMOUFLAGE_SPEED_MAX` | `constants.ts:69` | Never imported |
| `CLUSTER_ADHESION_MIN` | `constants.ts:110` | Never imported |
| `CLUSTER_SIMILARITY_MIN` | `constants.ts:111` | Never imported |
| `CLUSTER_AGE_MIN` | `constants.ts:112` | Never imported |
| `WALL_TICKS_THRESHOLD` | `constants.ts:56` | Never imported (hardcoded 50 in `renderer.ts:123`) |
| `WALL_ARMOR_MIN` | `constants.ts:57` | Never imported (hardcoded 200 in `renderer.ts:123`) |
| `WALL_SPEED_MAX` | `constants.ts:58` | Never imported (hardcoded 50 in `renderer.ts:123`) |

**Total**: 17 dead exports. Several constants have been defined but their intended consumers use hardcoded values instead.

### M2. `shuffled8()` duplicated 4 times
**Files**: `adhesion.ts:64`, `reactions.ts:94`, `reproduction.ts:81`, `sexual-reproduction.ts:91`

Exact same Fisher-Yates shuffle of 8 indices. Should be extracted to a shared utility.

### M3. DX/DY arrays duplicated 5 times
**Files**: `movement.ts:10-11`, `reactions.ts:12-13`, `reproduction.ts:14-15`, `sexual-reproduction.ts:14-15`, `adhesion.ts:14-15`

Same `[-1,0,1,-1,1,-1,0,1]` and `[-1,-1,-1,0,0,1,1,1]` in every file.

### M4. `renderer.ts` at 301 lines (over 200-line limit)
**File**: `renderer.ts`

The rendering code has terrain rendering, pixel rendering, shape drawing, and weather effects all in one file. Could split into `render-terrain.ts`, `render-creatures.ts`, `render-weather.ts`.

### M5. Bloom event ignores `BLOOM_MULT` constant
**File**: `events.ts:92`

```typescript
addFood(world, nx, ny, 0.05);  // hardcoded, BLOOM_MULT=8 is never used
```

Bloom was likely intended to use `config.substrateEmission * BLOOM_MULT` or similar.

### M6. Species sort is destructive
**File**: `stats.ts:84`

```typescript
const sample = pixels.length > 200
  ? pixels.sort(() => Math.random() - 0.5).slice(0, 200) : pixels;
```

`Array.sort()` mutates in-place. This shuffles the `pixels` array extracted from `world.pixels.values()` every 100 ticks. While not destructive (it is a copy from `Array.from`), using `sort` for shuffle produces biased results. Should use Fisher-Yates.

---

## LOW Priority

### L1. Pheromone doesn't diffuse faster than food
**File**: `substrate.ts:96-113`

`PHEROMONE_DIFFUSION_MULT = 2.0` is defined in constants but never imported. `diffuseFood()` only diffuses the `food` array. Pheromone only decays (line 123-125), never diffuses. This limits pheromone's utility as a trail signal.

### L2. `_config` prefix in `canvasToGrid` hides needed parameter
**File**: `ui-controls.ts:90`

```typescript
function canvasToGrid(e: MouseEvent, canvas: HTMLCanvasElement, _config: SimConfig)
```

The underscore prefix signals "unused" but the function needs pixelScale from config (see C1).

### L3. Drought event AND drought weather stack
**Files**: `events.ts:77-83` + `weather.ts:110`

A drought event applies `food *= 0.95` per tick globally. Drought weather applies `weatherDecayMult = 1 + intensity` (up to 2x decay). If both are active simultaneously, food decays extremely fast (~10% per tick), potentially causing mass extinction.

### L4. `crossoverRegulatoryGenes` alternation skips genes
**File**: `genome.ts:84-97`

If parent A has 3 reg genes and B has 5, the alternating pick pattern (even=A, odd=B) means: i=0 picks A[0], i=1 picks B[1], i=2 picks A[2], i=3 picks B[3], i=4 picks A[4] -- but A only has 3 genes, so i=4 skips. This results in a child with only 4 genes from the potential 5. Minor but technically lossy.

---

## Energy Balance Analysis

### Producer sustainability

A producer with average genes: harvest_eff ~0.6, speed ~0.15, sense ~0.25

- **Income**: `food_avail * 0.6 * HARVEST_RATE(0.5) * harvestPenalty(1.0)` = `food * 0.3`
- On grass: food ~0.012 * 1.0 * emission_mult (spring=1.2) = ~0.014 per tick accumulating to ~0.3-0.5 at steady state
- Harvest per tick: ~0.3 * 0.3 = ~0.09
- **Cost**: `BASE_UPKEEP(0.05) + speed(0.15)*SPEED_UPKEEP(0.08) + sense(0.25)*SENSE_UPKEEP(0.03)` = 0.05 + 0.012 + 0.0075 = **0.07/tick**
- **Net**: +0.02/tick. **Sustainable.** Producers slowly accumulate energy.

### Hunter sustainability

A hunter: speed ~0.7, sense ~0.6, harvest_eff ~0.3, absorbSkill ~0.5, harvestPenalty = 1 - 0.5*0.7 = 0.65

- **Food income**: food * 0.3 * 0.5 * 0.65 = food * 0.0975 (much less than producer)
- **Cost**: 0.05 + 0.7*0.08 + 0.6*0.03 = 0.05 + 0.056 + 0.018 = **0.124/tick**
- **Food alone**: On grass at ~0.3 food: 0.3 * 0.0975 = 0.029 (not enough)
- **Kill income**: Absorb from a pixel with 50 energy: `50 * 0.8 * (0.3 + 0.5*0.7) * armorMult` = `50 * 0.8 * 0.65 * ~0.7` = ~18.2 energy per kill
- At 0.124/tick cost, that sustains for ~147 ticks between kills.
- **Verdict**: Hunters need ~1 kill per 147 ticks. With speed 0.7 and sense range 3-4 cells, this is feasible against a producer population. **Viable.**

### Apex predator sustainability

Apex: speed ~0.9, sense ~0.85, harvest ~0.1, absorbSkill ~0.9, harvestPenalty = 1 - 0.9*0.7 = 0.37

- **Food income**: negligible (~0.01/tick)
- **Cost**: 0.05 + 0.9*0.08 + 0.85*0.03 = 0.05 + 0.072 + 0.0255 = **0.148/tick**
- **Kill income**: Against a 50-energy pixel: `50 * 0.8 * (0.3 + 0.9*0.7) * ~0.8` = `50 * 0.8 * 0.93 * 0.8` = ~29.8 per kill
- Sustains for ~201 ticks between kills.
- **Verdict**: Apex can survive but needs prey density. At 5% initial population and only 15% being hunters/producers, viable in small numbers. **Marginally viable -- will go extinct if population drops.**

### Population dynamics

- Reproduction threshold: 30-60 energy. A producer gains ~0.02/tick, reaching 30 from 50 (start) means immediate reproduction possible.
- REPRO_TAX=2.5 is modest.
- MAX_POP_FRACTION=0.08 caps at 2400 pixels on 200x150 grid.
- **Risk**: Producers can reproduce quickly in spring/summer (high emission), potentially hitting cap. The cap prevents explosion.
- Auto-seed at 0 population with 100-tick delay + 50 new pixels prevents total extinction.
- **Verdict**: System is stable. Producers carry the ecosystem. Predators are viable but population-dependent. Boom-bust cycles expected, which is desirable for an evolution sim.

---

## Missing Integrations Checklist

| Feature | Status |
|---------|--------|
| `weatherMoveCostMult` used? | YES - `movement.ts:67` |
| `weatherUpkeepMult` (heatwave) used? | YES - `metabolism.ts:46` |
| Wear affects terrain color? | YES - `terrain.ts:113-118` |
| Pheromone diffusion? | NO - only decays, `PHEROMONE_DIFFUSION_MULT` unused |
| `paintChannel` functional? | NO - parameter ignored in `paintSubstrate` |
| Wall pixel constants used? | NO - hardcoded in `renderer.ts:123` |
| Cluster constants used? | NO - `CLUSTER_*` constants never imported |
| `applyBehavioralSwitch` called? | NO - regulation.ts exports it but nobody calls it |

---

## Performance Notes

**Canvas rendering**: 200x150 grid at 5x scale = 1000x750 display. `renderTerrain` iterates 30,000 cells and writes 5x5 pixel blocks (750,000 pixels). At `SUBSTRATE_RENDER_INTERVAL=4`, this runs every 4th frame. Acceptable.

**Weather particles**: MAX_PARTICLES=150. Drawing 150 arcs/lines per frame is negligible.

**Simulation tick**: Main loop shuffles all pixels, iterates once for metabolism+movement+adhesion+reproduction. With max 2400 pixels (8% cap), plus a 10% sexual reproduction pass, total is ~2640 iterations per tick. At 10 TPS, this is ~26,400 operations/sec. Well within budget.

**Species computation**: `computeSpecies` does O(n^2) pairwise distance on 200-sample every 100 ticks. 200*200 = 40,000 comparisons of 16-byte arrays. Runs once per ~10 seconds at default speed. Fine.

**Potential concern**: `popHistory.shift()` in `recordPopulation` (world.ts:92) is O(n) on every tick. With POP_HISTORY_LENGTH=500, this copies 499 elements per tick. Minor but could use a ring buffer for large history sizes.

---

## Recommended Actions (Priority Order)

1. **FIX C1**: Fix `canvasToGrid` to divide by `pixelScale` - breaks all mouse interaction
2. **FIX H2**: Type `world.weather` as `Weather` instead of `any`
3. **FIX H1**: Pass `config` or season-quarter-length to `scaleIntensity`
4. **FIX H3**: Remove `paintChannel` feature or implement it
5. **CLEAN M1**: Remove 17 dead exports or wire them up (especially wall/cluster/bloom constants)
6. **DRY M2/M3**: Extract `shuffled8()` and DX/DY to a shared `util.ts`
7. **FIX M5**: Use `BLOOM_MULT` constant in bloom event
8. **SPLIT M4**: Break `renderer.ts` into 3 files

---

## Positive Observations

- Clean TypeScript compilation with zero errors
- Excellent modular decomposition - each system in its own file
- Smart performance choices: Float32Array, Map O(1) lookup, Fisher-Yates, 14ms tick budget cap
- Robust auto-seed mechanism prevents permanent extinction
- Thoughtful trophic system with harvest penalty creating genuine predator/prey dynamics
- Weather state machine correctly cycles between clear and active weather
- Terrain generation with value noise + moisture creates natural-looking biomes
- Regulatory gene system adds emergent depth without complexity overhead
- Audio gracefully degrades when files are missing
- Visibility-change handler prevents runaway accumulator when tab is hidden

---

## Unresolved Questions

1. Should pheromone diffuse (using `PHEROMONE_DIFFUSION_MULT`) or is decay-only intentional?
2. Were cluster mechanics (cluster constants) planned but deferred?
3. Was `applyBehavioralSwitch` meant to be called from `movement.ts` during sensing?
4. Is the drought event + drought weather stacking intentional or should they be exclusive?
