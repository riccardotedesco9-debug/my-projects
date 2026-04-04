# Code Review: OOZE Pixel Alchemy Evolution Simulator

**Scope**: 22 files, 2224 LOC, full codebase review  
**Focus**: Performance, correctness, energy balance, rendering, world size, speed control  
**Date**: 2026-04-04

---

## Overall Assessment

The codebase is well-organized with clean module separation and solid fundamentals (Fisher-Yates shuffle, Float32Array substrate, Map<number,Pixel> O(1) lookup). However, there are **severe performance bottlenecks** in three areas: substrate diffusion, pixel rendering, and stats computation. The energy system has a fundamental trophic balance flaw. Several bugs exist in canvas interaction and rendering.

---

## CRITICAL: Performance Bottlenecks

### P1. Substrate Diffusion is the #1 Perf Killer

**File**: `src/substrate.ts:66-95` (`diffuseSubstrate`)

This runs **every tick** and does:
- 120,000 cells x 4 channels = 480K iterations
- For each cell, 8 neighbor lookups with modulo wrapping = 3.84M array index computations
- Each neighbor index: `(((y+dy) % h + h) % h * w + ((x+dx) % w + w) % w) * 4 + ch`
- That's 4 modulo ops + 2 additions + 1 multiply per neighbor per channel

**Total per tick**: ~3.84M index calculations + 3.84M additions + 480K subtractions. This alone dominates frame time.

**Fix**: Pre-compute neighbor offsets. The wrapping mod is only needed at edges. Use a flat offset table for interior cells and only wrap at boundaries:

```typescript
function diffuseSubstrate(world: World, config: SimConfig): void {
  const { width: w, height: h, substrate, substrateBuf } = world;
  const baseD = config.substrateDiffusion * getDiffMult(world.season);
  substrateBuf.set(substrate);  // This copy alone is 480K floats = fine

  // Pre-compute row offsets for neighbor lookup
  const stride = w * 4;
  
  for (let y = 0; y < h; y++) {
    const yAbove = y === 0 ? (h - 1) * w * 4 : (y - 1) * w * 4;
    const yCenter = y * w * 4;
    const yBelow = y === h - 1 ? 0 : (y + 1) * w * 4;
    
    for (let x = 0; x < w; x++) {
      const bi = yCenter + x * 4;
      const totalSub = substrate[bi] + substrate[bi + 1] + substrate[bi + 2];
      const satMult = totalSub > SUBSTRATE_SATURATION_LIMIT ? 2 : 1;
      
      const xLeft = x === 0 ? (w - 1) * 4 : (x - 1) * 4;
      const xCenter = x * 4;
      const xRight = x === w - 1 ? 0 : (x + 1) * 4;
      
      // Neighbor base indices (no per-channel, add ch offset)
      const n0 = yAbove + xLeft;   // top-left
      const n1 = yAbove + xCenter; // top
      const n2 = yAbove + xRight;  // top-right
      const n3 = yCenter + xLeft;  // left
      const n4 = yCenter + xRight; // right
      const n5 = yBelow + xLeft;   // bottom-left
      const n6 = yBelow + xCenter; // bottom
      const n7 = yBelow + xRight;  // bottom-right
      
      for (let ch = 0; ch < 4; ch++) {
        const val = substrate[bi + ch];
        if (val < 0.001) continue;
        const D = ch === 3 ? baseD * PHEROMONE_DIFFUSION_MULT : baseD * satMult;
        const per = val * D / 8;
        substrateBuf[bi + ch] -= val * D;
        substrateBuf[n0 + ch] += per;
        substrateBuf[n1 + ch] += per;
        substrateBuf[n2 + ch] += per;
        substrateBuf[n3 + ch] += per;
        substrateBuf[n4 + ch] += per;
        substrateBuf[n5 + ch] += per;
        substrateBuf[n6 + ch] += per;
        substrateBuf[n7 + ch] += per;
      }
    }
  }
  substrate.set(substrateBuf);
}
```

This eliminates the inner 3x3 loop and the 4 modulo operations per neighbor. Expected speedup: **2-3x** on diffusion alone.

**Advanced fix**: Skip cells where all 4 channels < 0.001 (early exit the whole cell, not per-channel). This could skip 30-60% of cells depending on substrate distribution.

### P2. Substrate Rendering Creates a 4.3MB ImageData at Scaled Resolution

**File**: `src/renderer.ts:25-26, 37-68`

The `subImage` is created at `w*s x h*s` = 1200x900 = 4.32MB. The `fillBlock` function at line 158-166 writes each logical pixel as a 3x3 block of canvas pixels, meaning 9 writes per world cell = **1.08M pixel writes** per substrate render.

**Fix**: Create the ImageData at native resolution (400x300), write 1 pixel per cell, then use `drawImage` with scaling:

```typescript
// In initRenderer:
subImage = subCtx.createImageData(w, h);  // 400x300, not 1200x900

// In renderSubstrate, replace fillBlock with direct write:
const idx = (y * w + x) * 4;
data[idx] = r; data[idx+1] = g; data[idx+2] = b; data[idx+3] = 255;

// After the loop:
const tempCanvas = document.createElement('canvas');
tempCanvas.width = w; tempCanvas.height = h;
tempCanvas.getContext('2d')!.putImageData(subImage, 0, 0);
subCtx.drawImage(tempCanvas, 0, 0, w * s, h * s);
```

Better yet, use a persistent offscreen canvas. This reduces pixel writes from 1.08M to 120K (9x improvement) and the browser does the scaling in GPU.

### P3. Pixel Rendering Uses fillRect Per Pixel (String Alloc + State Change)

**File**: `src/renderer.ts:83-126` (`renderPixels`)

For each pixel:
- Line 118: `pixCtx.fillStyle = \`rgb(${r},${g},${b})\`` -- **template literal string allocation per pixel**
- Line 119: `pixCtx.fillRect(...)` -- context state change + draw call
- Line 113 (glow): Another fillStyle + fillRect + globalAlpha change
- Line 123-124 (predator marker): Yet another fillStyle + fillRect

At 500-2000 pixels, that's 500-4000+ fillRect calls + string allocations per frame.

**Fix**: Use ImageData for pixel rendering too, or batch pixels by color. At minimum, avoid the template literal:

```typescript
// Pre-allocate a pixel ImageData at native resolution
// Write pixel data directly, then scale with drawImage
```

### P4. drawKinBonds: beginPath/stroke Per Bond

**File**: `src/renderer.ts:129-156`

Line 148-151: For each kin bond found, calls `beginPath()`, `moveTo()`, `lineTo()`, `stroke()`. Each `stroke()` is a full GPU draw call.

With 800 sampled pixels x 8 neighbors x genomeSimilarity check (16 byte comparisons each), this is:
- Up to 800 * 4 neighbor checks (dedup halves it) = 3200 genomeSimilarity calls per frame
- Each genomeSimilarity: 16 iterations with Math.abs = 48 operations
- Up to hundreds of individual stroke() calls

**Fix**: Batch all lines into a single path:
```typescript
pixCtx.beginPath();
for (const pixel of world.pixels.values()) {
  // ... find bonds ...
  pixCtx.moveTo(pixel.x * s + s/2, pixel.y * s + s/2);
  pixCtx.lineTo(nx * s + s/2, ny * s + s/2);
}
pixCtx.stroke();  // single draw call
```

### P5. getEffectiveGene Called Excessively in Hot Path

**File**: `src/pixel.ts:32-34` -> `src/regulation.ts:6-24`

`getEffectiveGene` iterates ALL regulatory genes for each call. It's called:
- `metabolism.ts`: 8 times per pixel (3 harvest + 3 waste + speed + sense)
- `movement.ts`: 3-6 times per pixel (speed, senseRange, senseTarget, + harvest in seekSubstrate)
- `adhesion.ts`: 1 time per pixel
- `reproduction.ts`: 2-3 times per pixel

That's **14-18 calls per pixel per tick**. Each call iterates 0-16 regulatory genes. At 1000 pixels with 4 average reg genes, that's ~56K-72K loop iterations just for regulation.

**Fix**: Cache effective gene values per tick. Add a `Uint8Array(16)` effective gene cache to each pixel, recompute once at tick start:

```typescript
function cacheEffectiveGenes(pixel: Pixel): void {
  for (let i = 0; i < CORE_GENOME_SIZE; i++) {
    pixel.effectiveGenes[i] = applyRegulation(pixel, i);
  }
}
```

Then replace all `getEffectiveGene(pixel, idx)` with `pixel.effectiveGenes[idx]`.

### P6. shuffled8() Allocates a New Array Every Call

**Files**: `src/reactions.ts:79-86`, `src/reproduction.ts:79-86`, `src/sexual-reproduction.ts:89-96`, `src/adhesion.ts:63-70`

Four identical copies of `shuffled8()`, each allocating `[0,1,2,3,4,5,6,7]` and performing destructuring swaps. Called per pixel for reproduction and adhesion, plus per reaction.

At 1000 pixels: ~2000-3000 array allocations per tick.

**Fix**: Single shared module-level array, mutate in place:
```typescript
const _shuffle8 = [0, 1, 2, 3, 4, 5, 6, 7];
function shuffled8(): number[] {
  for (let i = 7; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = _shuffle8[i]; _shuffle8[i] = _shuffle8[j]; _shuffle8[j] = tmp;
  }
  return _shuffle8;
}
```

Also: DRY violation -- 4 copies of the same function across 4 files. Extract to a shared utility.

### P7. Array.from() in Sexual Reproduction Sampling

**File**: `src/simulation.ts:68`

```typescript
const pixels = Array.from(world.pixels.values());
```

This creates a full array copy of all pixel references **every tick**. At 2000 pixels, that's 2000-element array allocation + iterator consumption per tick. The shuffle in `simulateTick` already does this at line 27, but into a reusable `shuffleArr`.

**Fix**: Reuse `shuffleArr` from the main tick:
```typescript
function checkSexualReproduction(world: World, config: SimConfig, events: TickEvents): void {
  // shuffleArr is already populated from the main loop
  const sample = Math.max(1, Math.floor(shuffleArr.length * 0.1));
  for (let i = 0; i < sample; i++) {
    const pixel = shuffleArr[Math.floor(Math.random() * shuffleArr.length)];
    // ...
  }
}
```

### P8. Stats computeSpecies() is O(n^2)

**File**: `src/stats.ts:70-99`

Line 75: `pixels.sort(() => Math.random() - 0.5).slice(0, 200)` -- This "random shuffle" via sort is:
1. Non-uniform (biased shuffle)
2. O(n log n) for the sort, followed by a 200-element slice
3. Creates a new sorted array + a new sliced array

Lines 79-86: O(n^2) nested loop on the sample (200 x 200 = 40K iterations worst case). Each iteration calls `genomeDistance` (16 iterations). That's 640K operations.

Mitigated by `SPECIES_COMPUTE_INTERVAL = 100` (only runs every 100 ticks), but still a frame spike.

**Fix for the shuffle**: Fisher-Yates partial shuffle to get 200 random elements:
```typescript
const sample = Math.min(200, pixels.length);
for (let i = 0; i < sample; i++) {
  const j = i + Math.floor(Math.random() * (pixels.length - i));
  [pixels[i], pixels[j]] = [pixels[j], pixels[i]];
}
// Use pixels[0..sample-1]
```

### P9. updateStatsDisplay Runs Every Frame

**File**: `src/main.ts:53`, `src/stats.ts:22-68`

`updateStatsDisplay` is called every animation frame. It:
- Iterates ALL pixels (line 33-42) to compute totalEnergy, maxGen, genome complexity, trophic counts
- Calls `genomeComplexity()` per pixel (trivial but unnecessary at 60fps)
- Calls `getTrophicLevel()` per pixel
- Updates 12+ DOM elements via `textContent`
- Draws population graph

At 1000 pixels, 60fps: 60K pixel iterations/sec + 720 DOM writes/sec for stats.

**Fix**: Throttle to every 10-15 frames:
```typescript
if (frameCount % 10 === 0) updateStatsDisplay(world, config);
```

### P10. emitFromZones Iterates Large Regions Every Tick

**File**: `src/substrate.ts:19-44`

Red zone: `h*0.25 * w` = 75 * 400 = 30,000 cells  
Green zone: `h * w*0.2` = 300 * 80 = 24,000 cells  
Blue zone: `h*0.5 * w*0.5` = 150 * 200 = 30,000 cells  

Total: 84,000 array accesses + Math.min calls per tick. Not the worst offender but adds up.

### P11. emitFromPatches Iterates Circular Areas

**File**: `src/substrate.ts:47-64`

10 patches, each with radius 8-20. Average area = pi*14^2 = ~616 cells per patch.
Total: ~6160 cells with sqrt + modulo + array access per tick. Moderate cost.

---

## HIGH: Correctness Bugs

### B1. paintSubstrate Uses Wrong Stride (CRITICAL BUG)

**File**: `src/ui-controls.ts:99-103`

```typescript
function paintSubstrate(world: World, x: number, y: number, ch: number): void {
  const idx = (y * world.width + x) * 3 + ch;  // BUG: * 3
  world.substrate[idx] = Math.min(1, world.substrate[idx] + 0.3);
}
```

The substrate array uses 4 channels (RGBP), so the stride should be `* 4`, not `* 3`. This writes to wrong memory locations, corrupting substrate data when users paint.

**Fix**: Change `* 3` to `* 4`.

### B2. Population Graph Math.max(...history) Can Stack Overflow

**File**: `src/stats.ts:110`

```typescript
const maxPop = Math.max(...history, 1);
```

`POP_HISTORY_LENGTH = 500`, so this spreads 500 elements as arguments to `Math.max`. While 500 is safe (V8 limit is ~65K), it's unnecessary allocation of 500 stack frames.

**Fix**: Manual loop:
```typescript
let maxPop = 1;
for (let i = 0; i < history.length; i++) if (history[i] > maxPop) maxPop = history[i];
```

### B3. Season Progression Uses Incorrect Division

**File**: `src/seasons.ts:13`

```typescript
if (world.seasonTick >= config.seasonLength / 4) {
```

With `seasonLength = 2000`, a full year = 4 * 500 = 2000 ticks. This is correct BUT the config slider goes up to 10000, meaning at max: a season lasts 2500 ticks = very slow. The division by 4 means `seasonLength` is actually the YEAR length. The label says "Season Len" but behaves as year length. This is a UX confusion, not a code bug.

### B4. Bloom Event Randomizes Channel Every Tick

**File**: `src/events.ts:88-98`

```typescript
function applyBloom(world: World, ev: EnvironmentEvent): void {
  const ch = Math.floor(Math.random() * 3);  // random channel EVERY tick
```

The bloom event picks a random substrate channel each tick instead of storing it on creation. Over 150 ticks of a bloom, it deposits roughly equally across all channels rather than creating a focused resource hotspot. This negates the evolutionary pressure a bloom should create.

**Fix**: Store `channel` on the bloom event at creation (like drought does), use `ev.channel ?? 0`.

### B5. Dead Pixel Energy Used Incorrectly for Corpse

**File**: `src/metabolism.ts:78`

```typescript
world.corpses[cIdx] = Math.min(255, world.corpses[cIdx] + Math.floor(Math.abs(pixel.energy) * CORPSE_ENERGY_MULT + 10));
```

When a pixel dies, `pixel.energy <= 0`. `Math.abs(pixel.energy)` will be a small positive number (0 to ~1, since energy just went below 0). So corpse energy is basically always `10 * 2 + 10 = 10-12`, regardless of how much energy the pixel had before dying. The pixel's useful energy was already consumed.

This means corpses are nearly worthless and the scavenger niche has almost no selective pressure.

**Fix**: Track peak energy or use absolute energy at death-1 tick, or set a minimum corpse value proportional to the pixel's age/generation.

### B6. Repel Reaction Ignores the Defender

**File**: `src/reactions.ts:65-77`

```typescript
function resolveRepel(pixel: Pixel, world: World, events: TickEvents): void {
  pixel.energy -= REPEL_COST;
  // moves the ATTACKER to an empty cell
```

Repel moves the attacker away, not the defender. The attacker tried to move into an occupied cell, couldn't, so it repels... itself? The defender isn't affected at all. This makes repel functionally identical to "random walk" but with an energy cost. It provides no defensive benefit.

**Fix**: Repel should push the DEFENDER to a random empty neighbor cell, or both should be pushed apart.

---

## HIGH: Energy Balance / Trophic System

### E1. Predators Can Still Harvest Substrate Effectively

**File**: `src/metabolism.ts:23`

```typescript
const harvestPenalty = 1 - absorbSkill * TROPHIC_INVERSE_FACTOR;
```

`TROPHIC_INVERSE_FACTOR = 0.6`. Maximum `absorbSkill = 1.0` (when `REACT_TYPE = 0`).

So maximum harvest penalty = `1 - 1.0 * 0.6 = 0.4`. A maximum predator still harvests at **40% efficiency**. With `HARVEST_RATE = 0.5` and catalyze boost, a predator sitting on rich substrate can easily sustain itself without ever hunting.

**This completely undermines the trophic specialization the system is designed to create.** Predators have no real pressure to hunt because substrate harvesting is still viable.

**Fix**: Increase `TROPHIC_INVERSE_FACTOR` to 0.85-0.95, so apex predators harvest at 5-15% efficiency. They should be forced to hunt or scavenge to survive.

### E2. Absorb Doesn't Kill the Defender

**File**: `src/reactions.ts:27-47`

The absorb reaction takes energy from the defender (`defender.energy -= amount`) but never kills them directly. The defender just loses energy and may die on their next metabolism tick. But if the defender has high energy, a single absorb takes maybe 25 energy (50% of ~50 energy). The defender survives and walks away.

Combined with E1, this means predation is a weak pressure. The system will converge toward all-producer populations with occasional absorb interactions that don't create real food chains.

### E3. Cooperation Bonus is Negligible

**File**: `src/adhesion.ts:40-44`

```typescript
const bonus = pixel.state[2] > SOCIAL_DOUBLE_THRESHOLD
  ? COOPERATION_BONUS * 2 : COOPERATION_BONUS;
pixel.energy += bonus;
```

`COOPERATION_BONUS = 0.02`, doubled = 0.04. `BASE_UPKEEP = 0.05`.

The cooperation bonus doesn't even cover base upkeep. A cluster of perfectly cooperating pixels gains 0.04 energy/tick while paying 0.05 upkeep minimum. Adhesion/clustering provides zero net energy benefit.

**Fix**: Increase `COOPERATION_BONUS` to 0.08-0.12, or make it scale with cluster size.

---

## MEDIUM: Rendering Quality Issues

### R1. Glow Halo is Imperceptible at 3px Scale

**File**: `src/renderer.ts:110-115`

The glow effect draws a `s+2 = 5px` rect at `alpha = 0.15` behind a `3px` pixel. That's a 1px transparent border around a 3px dot. At 0.15 opacity, this is barely visible -- the substrate background will show through at 85%.

**Fix**: Either increase the glow size to `s+4` with alpha 0.25, or skip this feature entirely (it's just wasting fillRect calls).

### R2. Size-by-Energy Difference is 1px -- Invisible

**File**: `src/renderer.ts:96`

```typescript
const size = energyFrac < 0.3 ? Math.max(1, s - 1) : energyFrac > 0.7 ? s + 1 : s;
```

At `s=3`: starving = 2px, normal = 3px, well-fed = 4px. A 1px size difference on a 3px base is hard to perceive, especially with varied substrate backgrounds. The well-fed 4px size also bleeds into neighbor cells.

### R3. Predator Center Dot is 1x1 Pixel -- Invisible

**File**: `src/renderer.ts:123-125`

```typescript
pixCtx.fillStyle = '#ff4444';
pixCtx.fillRect(px + Math.floor(s / 2), py + Math.floor(s / 2), 1, 1);
```

A single canvas pixel (not even a world pixel) as a marker. At any resolution, this is invisible.

### R4. Kin Lines at 0.08 Opacity Are Ghost Lines

**File**: `src/renderer.ts:131`

```typescript
pixCtx.strokeStyle = 'rgba(100,255,150,0.08)';
```

8% opacity lines between 3px dots on a dark background. These are essentially invisible.

### R5. Substrate Colors Are Dim (max 120 brightness)

**File**: `src/color-map.ts:55-61`

```typescript
const scale = 120;
return [Math.round(Math.min(1, r) * scale), ...];
```

Max substrate brightness is RGB(120,120,120) -- a dim gray. The "chemical world" looks like a dark cave. Consider `scale = 180` or `200` for more vivid substrate visualization.

---

## MEDIUM: World Size Analysis

Current: 400x300 @ 3x = 1200x900 canvas.

**Performance cost breakdown**:
- Substrate diffusion: O(W*H*4) = O(480K) -- the killer
- Substrate rendering: O(W*H*9) per render = O(1.08M) pixel writes
- Emission zones: O(84K)
- Corpse decay: O(120K)

**Recommended**: 200x150 @ 4x = 800x600 canvas.
- Diffusion: 200*150*4 = 120K (4x reduction)
- Rendering: 200*150*16 = 480K pixel writes (2.25x reduction from scale, but 4x fewer cells)
- Total substrate ops: ~4x faster
- Canvas is 800x600 -- fits most screens comfortably
- 4px scale makes individual pixels more visible, improving all the rendering features (glow, size variation, kin lines)
- Max population: 200*150*0.8 = 24,000 (still plenty)
- Sweet spot for "visible individual organisms" aesthetic

**Alternative**: 250x200 @ 3x = 750x600. Middle ground. 50K cells = 2.4x reduction.

---

## MEDIUM: Speed Control Analysis

**File**: `src/main.ts:32-46`

```typescript
const TICK_MS = 1000 / 30;  // 33.3ms per tick

if (!config.paused) {
  tickAccumulator += dt;
  const ticksThisFrame = Math.min(config.simSpeed, 10);
  let ran = 0;
  while (tickAccumulator >= TICK_MS && ran < ticksThisFrame) {
    simulateTick(world, config);
    ran++;
    tickAccumulator -= TICK_MS;
  }
  if (tickAccumulator > TICK_MS * 3) tickAccumulator = 0;
}
```

**Problem**: At speed 1x, the system runs 1 tick per ~33ms frame. At speed 10x, it tries to run up to 10 ticks per frame. But if a single tick takes >33ms (which it will at 400x300), the accumulator builds up debt.

At speed 1x: if tick takes 40ms, `tickAccumulator` grows by 16.7ms/frame (60fps rAF = 16.7ms dt, but tick takes 40ms). The accumulator never catches up -> the simulation runs at sub-1x speed even at "1x" setting. The debt cap at `TICK_MS * 3` (~100ms) prevents runaway but means the sim is always behind.

At speed 10x: tries 10 ticks per frame. If each tick takes 20ms, that's 200ms of blocking per frame -> **3-5 FPS**. The browser freezes.

**Fix**: Decouple tick rate from render rate. Use `performance.now()` profiling to measure actual tick cost and cap ticks-per-frame dynamically:

```typescript
const tickStart = performance.now();
while (tickAccumulator >= TICK_MS && ran < ticksThisFrame) {
  simulateTick(world, config);
  ran++;
  tickAccumulator -= TICK_MS;
  if (performance.now() - tickStart > 12) break;  // leave 4ms for rendering
}
```

Also: the speed slider should probably control `TICK_MS` (tick interval) rather than ticks-per-frame. Speed 2x = `TICK_MS / 2`, not "2 ticks per frame."

---

## LOW: Code Quality

### L1. DRY Violation: shuffled8() x4

Files: `reactions.ts:79`, `reproduction.ts:79`, `sexual-reproduction.ts:89`, `adhesion.ts:63`

Four identical implementations. Extract to a shared utility module.

### L2. DRY Violation: DX/DY Direction Arrays x4

Files: `movement.ts:9-10`, `reactions.ts:10-11`, `reproduction.ts:13-14`, `adhesion.ts:12-13`

Same `[-1,0,1,-1,1,-1,0,1]` arrays in four files.

### L3. Dead Import: applyBehavioralSwitch

**File**: `src/regulation.ts:28-43`

`applyBehavioralSwitch` is exported but never imported anywhere. Dead code.

### L4. Module-Level Mutable State in simulation.ts

**File**: `src/simulation.ts:15-16`

```typescript
let shuffleArr: Pixel[] = [];
export let lastTickEvents: TickEvents = createTickEvents();
```

Module-level mutable state makes testing hard and creates hidden coupling. `lastTickEvents` is exported as a mutable binding.

### L5. initRenderer Creates Non-Reusable Canvas References

**File**: `src/renderer.ts:15-27`

Module-level variables (`subCanvas`, `pixCanvas`, `subCtx`, `pixCtx`, `subImage`) are set in `initRenderer` but there's no cleanup. Calling `reset()` reinitializes the renderer but the old ImageData/contexts are just orphaned.

---

## Positive Observations

1. **Module separation is clean**: Each file has a single responsibility, all under 170 lines
2. **Fisher-Yates shuffle**: Correct implementation, properly avoids modulo bias
3. **Map<number, Pixel>**: O(1) lookup by cell key is the right data structure
4. **Float32Array substrate**: Correct choice for numeric density
5. **Double-buffered diffusion**: `substrate` + `substrateBuf` prevents read-during-write artifacts
6. **Visibility change handling**: Pauses sim when tab hidden -- prevents tick debt accumulation
7. **Audio graceful degradation**: Properly handles missing audio files
8. **Wrapping world**: Toroidal topology eliminates edge effects
9. **Regulatory gene system**: Genuinely interesting emergent complexity mechanism
10. **Event system**: Meteor/drought/bloom/plague add meaningful environmental pressure

---

## Recommended Actions (Priority Order)

1. **[CRITICAL]** Fix `paintSubstrate` stride bug (`*3` -> `*4`) in `ui-controls.ts:101`
2. **[CRITICAL]** Optimize `diffuseSubstrate` -- pre-compute neighbor indices, eliminate inner 3x3 loop
3. **[CRITICAL]** Reduce world size to 200x150 @ 4x scale (or make configurable)
4. **[HIGH]** Render substrate to native-res ImageData, scale with `drawImage`
5. **[HIGH]** Batch kin bond lines into single `beginPath`/`stroke` call
6. **[HIGH]** Cache effective gene values per pixel per tick
7. **[HIGH]** Throttle stats display to every 10 frames
8. **[HIGH]** Fix `TROPHIC_INVERSE_FACTOR` to 0.85+ for real predator pressure
9. **[HIGH]** Fix bloom event channel randomization (store on creation)
10. **[HIGH]** Fix speed control to use time-budgeted tick loop
11. **[MEDIUM]** Extract shared `shuffled8()` and `DX/DY` to utility module
12. **[MEDIUM]** Fix repel reaction to push defender, not attacker
13. **[MEDIUM]** Increase cooperation bonus to be meaningful
14. **[MEDIUM]** Fix corpse energy calculation to reflect pre-death energy
15. **[MEDIUM]** Replace per-pixel `fillRect` with ImageData writes for pixel layer
16. **[LOW]** Increase substrate color scale from 120 to 180
17. **[LOW]** Remove or enhance imperceptible visual features (1px predator dot, 0.08 kin lines)
18. **[LOW]** Remove dead `applyBehavioralSwitch` export

---

## Metrics

- **Type Coverage**: ~95% (TypeScript strict mode, minimal `any`)
- **Test Coverage**: 0% (no test files found)
- **Linting Issues**: None configured (no eslint/biome in package.json)
- **Build**: Vite + TSC, zero dependencies beyond dev tools

---

## Unresolved Questions

1. Is the regulatory gene system actually producing measurably different behaviors? Without logging/metrics on regulatory gene activation frequency, it's unclear if they matter or are just complexity overhead.
2. Should the simulation use Web Workers for tick computation? At 200x150, the main thread should handle it. At 400x300, a worker would prevent UI jank but adds message-passing complexity for the substrate array.
3. The audio system loads 12 audio files on first click. If any are large, this blocks the main thread. Consider lazy-loading SFX on first use rather than all at once.
4. `popHistory` uses `Array.shift()` which is O(n) on the array. At 500 elements this is trivial, but a circular buffer would be cleaner.
