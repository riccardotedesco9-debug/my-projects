# OOZE Pixel-Life — Full Code Review

Reviewer: senior eng + gamedev hat on. No sugar-coating.

## Scope

- 42 source files, ~7,276 LOC total (includes `index.html` 340 LOC).
- Stack: Vite 6 + strict TS + Canvas 2D + Web Audio.
- No tests. No `npm run test`. No CI mentioned.
- `tsc --noEmit` is clean. That's the floor, not a quality signal.

---

## Executive Summary

1. **Multiple module-level state leaks across `reset()`.** Nearly every “system” module (`species-tree`, `ecosystem-graph`, `pack-hunting`, `migration`, `arms-race`, `canvas-hud`, `renderer._tweenPositions`, `replay`, `creature-inspector._cachedPixel`) holds its own top-level `let` state. `reset()` in `main.ts` rebuilds only the `world`; everything else keeps thinking it’s mid-run. Species from the previous session are still “alive” in the tree, trait history still references dead pixels, pack IDs collide, tween cache keys collide with new-world IDs starting at 1. Worst case is visible (ghost species bars); best case is subtle (wrong pack leader positions).
2. **Event listener stacking on every reset.** `initControls` and `initCanvasInteraction` both call `document.addEventListener(...)` unconditionally, and `reset()` calls both on every click of the Reset button. Every reset doubles key handlers, click handlers, mouse handlers. Infinite stacking. Only the *camera* inputs are guarded (`_inputsInitialized`).
3. **Real keybinding collision: M mutes audio AND toggles minimap.** Pressing M fires both. Recent audio change silently broke an existing binding.
4. **Ecosystem graph flow matrix never resets after windowing.** `updateEcosystemGraph` divides `flowMatrix` by `SAMPLE_WINDOW` every 200 ticks — then keeps accumulating on top of the averaged values. It grows monotonically and never converges.
5. **Hunting ally-filter is too coarse and breaks Swarm behavior.** The new `isAllyOf` in `movement.ts` and the mirrored rule in `reactions.ts` treat any same-role as an ally. Swarm (role 5) now refuses to target its own role for absorption or for sensing, which eliminates swarm-on-swarm `Share` / sexual reproduction pathways at sense-target ≥ 85. Worse: swarm-adjacent sense at `senseTarget ≥ 85` makes swarm creatures unable to see other swarm, so they cannot coordinate (which is the *entire point* of role 5). Confirmed via `seekPixel` + `sexual-reproduction` gating.
6. **Multiple dead/unused code paths and misleading “no-op” exports** (weather audio hook, `_inputsInitialized` guard scope, `_pixelScale` hack in reactions). Suggests recent surgery left scar tissue.

Overall quality: better than the average prototype, worse than shippable. Architecture is reasonable; hygiene is the weakness. Recent audio + ally changes introduced regressions that would catch any QA pass.

---

## Critical Issues (fix before shipping)

### C1. Keybinding collision: M key triggers both mute and minimap
**Files:** `src/audio.ts:43-45`, `src/renderer.ts:836`
```ts
// audio.ts
document.addEventListener('keydown', (e) => {
  if (e.key === 'm' || e.key === 'M') toggleMute();
});
```
```ts
// renderer.ts:836
if (e.key === 'm' || e.key === 'M') { toggleMinimap(); e.preventDefault(); }
```
Both handlers fire on one press. `preventDefault()` in the renderer doesn’t stop the audio handler; they’re on different registrations and `document.addEventListener` does not propagate `preventDefault` to siblings. Instructions in `index.html:305` still advertise "M = minimap". The README/inline help says M is minimap; the new audio change silently stole it.

**Fix:** pick a different mute key. The audio help text says "M mute" (`audio.ts:4` comment), the HTML UI says "M = minimap". Pick one. Suggest repurposing mute onto a dedicated icon button, or use `U` (unmuted/muted) or `N` (noise) — no existing bindings. Minimum fix:
```ts
// audio.ts
if (e.key === 'u' || e.key === 'U') toggleMute();
```

### C2. Event listener leak on every `reset()`
**Files:** `src/main.ts:23-35`, `src/ui-controls.ts:12-90,93-137`
`reset()` calls `initControls(config, …)` and `initCanvasInteraction(pixelCanvas, world, config)` every time. Both register global handlers via `document.addEventListener` / `canvas.addEventListener` with no `removeEventListener`, no `{ once: true }`, no `_initialized` guard. Click Reset five times and there are five copies of every keydown handler running. `Space` toggles pause five times in a row → never toggles. `ViewMode` buttons stack `playUiSfx()` calls each time.

**Repro:** click Reset 3 times, press Space — paused state flickers but never changes because each listener toggles `config.paused`.

**Fix:** same pattern as `renderer.ts:_inputsInitialized`:
```ts
// ui-controls.ts
let _controlsInitialized = false;
let _canvasInitialized = false;
export function initControls(config, onReset) {
  resetCallback = onReset;
  if (_controlsInitialized) return;  // only bind DOM once
  _controlsInitialized = true;
  // ...rest of bindings
}
export function initCanvasInteraction(canvas, world, config) {
  _world = world;  // refresh world ref even if already bound
  if (_canvasInitialized) return;
  _canvasInitialized = true;
  // ...listener setup
}
```
Note that sliders re-bind `.oninput` which is fine — that's property assignment, not addEventListener. But the `document.addEventListener('keydown'/`click`)` calls MUST be gated.

### C3. Module-level state not reset across `reset()`
**Affected files (at least):**
- `species-tree.ts:24-28` — `species` Map, `pixelSpecies` Map, `nextSpeciesId`, `lastComputeTick`
- `ecosystem-graph.ts:11,14,17` — `flowMatrix`, `windowTicks`, `rolePopulations`
- `pack-hunting.ts:24,25,26` — `packs` Map, `nextPackId`, `lastFormationTick`
- `migration.ts:11,12` — `lastUpdateTick`, `prevSeason`
- `arms-race.ts:26-29` — `snapshots`, `eventLog`, `notifications`, `lastSnapshotTick`
- `canvas-hud.ts:10,11,14,15` — `traitHistory`, `lastSampleTick`, `prevSeason`, `seasonFlashAlpha`
- `renderer.ts:635` — `_tweenPositions` (never cleared)
- `creature-inspector.ts:24,60,61` — `trackedId`, `_cachedPixel`, `_cacheFrame`, `energyHistory`
- `audio.ts:17-22` — `currentSeason`, `lastSeenPopulation`, `lastExtinctionTick`, `muted`, `initialized`
- `replay.ts:13-18` — `snapshots`, `recording`, `replaying`, `replayIdx`, `lastRecordTick`
- `sprites.ts:24,25` — `cache` (800-entry cap cap but stale palettes persist), `baseTemplates`
- `stats.ts:12,13,25` — `cachedSpeciesCount`, `cachedDiversity`, `_displayTps`
- `substrate.ts:13-14` — `neighborOffsets`, `cachedW/H` (size-guarded, so this one is OK)

**Consequences:**
- Species tree shows ghost species from previous runs; `nextSpeciesId` keeps climbing.
- Pack assignments via `pixel.packId = packId` reference packs from the OLD run. A new pixel with `packId = 42` from previous world matches `packs.get(42)` from the OLD map → `getPackMoveBias` steers new pixel toward dead leader coords.
- `_tweenPositions` map holds entries keyed by old pixel IDs; new world starts at `nextPixelId: 1`, so the tween for dead pixel #1 is applied to the first newly-spawned creature — it appears to teleport from the dead pixel's last-known position.
- `canvas-hud` trait history grows until `TRAIT_HISTORY_LEN` trims, but first 20 samples are pre-reset. Sparkline looks broken for ~30 seconds.
- `audio.ts:18` `lastSeenPopulation = -1` state is fine across reset — but `currentSeason` being 'spring' is assumed; if last run ended in winter the first season change back to spring is a silent no-op in `updateAmbientSeason`.

**Fix:** each module exposes a `reset()` function, call them from `main.ts:reset()`:
```ts
// species-tree.ts
export function resetSpeciesTree() {
  species.clear(); pixelSpecies.clear();
  nextSpeciesId = 1; lastComputeTick = 0;
}
```
Same pattern for all others. Add central:
```ts
// main.ts reset()
resetSpeciesTree(); resetEcosystemGraph(); resetPacks();
resetMigration(); resetArmsRace(); resetHud();
_tweenPositions.clear();
resetInspector(); resetReplay();
```
Alternatively (cleaner): move module state into `World`. The whole point of a "World" struct is to hold per-run state. Species/packs/etc belong there. Big refactor, but YAGNI/KISS says just add the resetters.

### C4. Ecosystem `flowMatrix` averaging bug — unbounded accumulation
**File:** `src/ecosystem-graph.ts:37-44`
```ts
windowTicks++;
if (windowTicks >= SAMPLE_WINDOW) {
  for (let i = 0; i < 7; i++)
    for (let j = 0; j < 7; j++)
      flowMatrix[i][j] /= SAMPLE_WINDOW;   // divides
  windowTicks = 0;
  // BUG: doesn't zero the matrix after "averaging"!
}
```
Division by 200 produces an average. But the next tick, `recordEnergyFlow` continues adding on top of those averaged values, not zero. Over 1000 ticks the matrix values drift unbounded. The rendering at line 77 (`if (flow < 0.01) continue`) means early game looks fine; after 2000 ticks, every edge renders thick because accumulated sums are large. The graph stops reflecting reality.

**Fix:** take a snapshot before reset, reset to zero:
```ts
windowTicks++;
if (windowTicks >= SAMPLE_WINDOW) {
  // snapshot averages to a render-ready copy
  for (let i = 0; i < 7; i++)
    for (let j = 0; j < 7; j++) {
      flowRender[i][j] = flowMatrix[i][j] / SAMPLE_WINDOW;
      flowMatrix[i][j] = 0;
    }
  windowTicks = 0;
}
```
Then render from `flowRender`.

### C5. Hunting ally-filter coarseness silently broke Swarm + Sexual repro
**Files:** `src/movement.ts:169-172,186-191`, `src/reactions.ts:32-34`
```ts
// movement.ts seekPixel
if (targetRole === selfRole) continue;
if (selfIsPredator && (targetRole === 1 || targetRole === 2)) continue;
```
```ts
// reactions.ts resolveAbsorb gate
if (aRole === dRole) return;
```
The rule "same role never fights" collides with mechanics that require same-role contact:

**a) Swarm cohesion broken.** Swarm creatures (role 5) have `senseTarget 85 + rand(80)` (see `pixel.ts:136`). That puts most swarms in the `senseTarget ∈ [85, 170)` range — `seekPixel(flee=false)`. With the new filter, swarm #1 looking for *another swarm creature* has `selfRole === targetRole === 5` and continues. They literally cannot find each other via sensing anymore. The `adhesion.ts` neighbor scan still works for 8-neighbor bonding, but longer-range swarm movement is gone.

**b) Sexual reproduction suppressed.** `checkSexualReproduction` in `simulation.ts:87` samples random pixels and looks at the 3×3 neighbors. It still works on Share-gene creatures (`dna[6] in [64,127)`). That's fine — it bypasses `seekPixel`. So sexual repro isn't broken. I take this one back.

**c) Hunter-swarm interactions:** a hunter (role 1) sensing looks for prey, but the filter `selfIsPredator && targetRole === 1|2` only skips *other predators*. Hunters will still find plants, scavengers, parasites, swarms, nomads. OK.

**d) Scavenger role 3 is NOT in the predator skip.** Scavengers are `absorber` (role 3: `rt >= 15 && rt < 64`) and `reactions.ts:34` only skips role 1 vs role 2. So a hunter can still absorb a scavenger (scavengers eat corpses, they shouldn't be prey for hunters? Actually in this sim there's no formal food web hierarchy beyond the predator-predator skip). Design intent unclear.

**Fix:**
- For swarm, allow same-role sensing *unless* the predator-skip rule applies. The rule should be: skip same-role-allies only if they are *hostile* (absorbers). Swarm is Share-based → not hostile → swarm can sense swarm.
- Cleaner: derive `isHostile` from react_type, not role. A scavenger with REACT_TYPE < ABSORB_SKILL_THRESHOLD is hostile; a swarm member with REACT_TYPE 64-127 is not. Then: `if (!selfIsHostile) do not filter allies — they are not threats`.

Concrete patch for `movement.ts:seekPixel`:
```ts
function seekPixel(pixel, world, range, flee) {
  const selfRole = getCreatureRole(pixel);
  const selfIsHostileAbsorber = pixel.dna[GENE.REACT_TYPE] < ABSORB_SKILL_THRESHOLD;
  // ...
  for (...) {
    const target = world.pixels.get(...);
    if (!target) continue;
    // Only hostile absorbers skip allies — sharers/catalysts WANT to find same-role
    if (selfIsHostileAbsorber) {
      const tRole = getCreatureRole(target);
      if (tRole === selfRole) continue;
      if ((selfRole === 1 || selfRole === 2) && (tRole === 1 || tRole === 2)) continue;
    }
    // ...
  }
}
```
Mirror the same logic in `reactions.ts:resolveReaction` (though there it only matters for the absorb branch, which is the only hostile one already — so `reactions.ts` is probably OK as-is once you understand "absorb = hostile").

### C6. `reroute when blocked by ally` branch in `movePixel` silently desyncs energy and direction accounting
**File:** `src/movement.ts:82-96`
```ts
const firstOccupant = world.pixels.get(cellKey(nx, ny, world.width));
if (firstOccupant && isAllyOf(pixel, firstOccupant)) {
  const start = Math.floor(Math.random() * 8);
  for (let k = 0; k < 8; k++) {
    const i = (start + k) % 8;
    const tx = wrapX(pixel.x + DX[i], world.width);
    const ty = wrapY(pixel.y + DY[i], world.height);
    if (world.pixels.has(cellKey(tx, ty, world.width))) continue;
    if (!canTraverse(pixel, world.terrain[ty * world.width + tx])) continue;
    bestDx = DX[i]; bestDy = DY[i]; nx = tx; ny = ty;
    break;
  }
}
```
After this block, execution continues to line 99 where `canTraverse` is checked *again* redundantly, and then to the reaction/move logic. Two problems:

1. If the reroute found an empty cell, great — it updates `bestDx/bestDy/nx/ny` and falls through. But if the reroute *didn't* find anything, `nx/ny` are unchanged (pointing at the ally). The subsequent `canTraverse` check passes, then `occupant` check fires, then `resolveReaction(pixel, occupant=ally, ...)` runs — which returns immediately at `reactions.ts:32` for same-role. Net effect: movement blocked, *but the pixel also pays no move cost nor leaves wear/pheromone*. The creature was supposed to do SOMETHING this tick — it just idles silently without the `wallTicks++` that the early-return path at line 23 would have incremented. This is a silent "lost" tick.

2. If rerouted into a *nonempty* cell held by a non-ally predator/prey, that's fine (the reroute only picks empty cells).

**Fix:** if the reroute finds nothing, fall back to the "blocked by terrain" path at line 23 style (bump `wallTicks`) or bail entirely:
```ts
let rerouted = false;
if (firstOccupant && isAllyOf(pixel, firstOccupant)) {
  const start = Math.floor(Math.random() * 8);
  for (let k = 0; k < 8; k++) {
    const i = (start + k) % 8;
    const tx = wrapX(pixel.x + DX[i], world.width);
    const ty = wrapY(pixel.y + DY[i], world.height);
    if (world.pixels.has(cellKey(tx, ty, world.width))) continue;
    if (!canTraverse(pixel, world.terrain[ty * world.width + tx])) continue;
    bestDx = DX[i]; bestDy = DY[i]; nx = tx; ny = ty;
    rerouted = true;
    break;
  }
  if (!rerouted) { pixel.wallTicks++; return; }
}
```

### C7. `audioCtx` never resumed after being suspended by autoplay policy
**File:** `src/audio.ts:41-89`
User clicks once → `enableAudio` is called, AudioContext created. But on many browsers/phones the AudioContext starts in `'suspended'` state and needs `audioCtx.resume()`. The code never calls `.resume()`. If the browser suspends it, audio is silent until page reload.

**Fix:** add to `enableAudio`:
```ts
audioCtx = new AudioContext();
if (audioCtx.state === 'suspended') await audioCtx.resume();
```
Also expose a `resumeAudio` + hook it to `visibilitychange` resume in `main.ts:81-88`.

---

## High-Priority Issues

### H1. Pack leader position is cached at formation and never updated
**File:** `src/pack-hunting.ts:82-88`
```ts
packs.set(packId, {
  id: packId, leader: leader.id,
  leaderX: leader.x,  // snapshot only
  leaderY: leader.y,
  members: new Set(cluster.map(c => c.id)),
});
```
Formation happens every `PACK_FORMATION_INTERVAL = 50` ticks. Between formations, the leader moves but `pack.leaderX/leaderY` don't. `getPackMoveBias` (line 99) reads the cached leader pos — so followers steer toward the leader's *50-ticks-ago* position. Pack cohesion is effectively random.

**Fix:** update leader coords each tick, or resolve leader by ID on each call:
```ts
export function getPackMoveBias(pixel, world) {
  if (pixel.packId === 0) return [0, 0];
  const pack = packs.get(pixel.packId);
  if (!pack) return [0, 0];
  if (pixel.id === pack.leader) return [0, 0];
  // find leader by ID each time — O(pack.members.size) worst case, usually immediate
  let leader: Pixel | null = null;
  for (const p of world.pixels.values()) {
    if (p.id === pack.leader) { leader = p; break; }
  }
  if (!leader) return [0, 0];
  // compute bias from leader.x/y
}
```
Better: maintain a `Map<pixelId, Pixel>` secondary index in World. Current `world.pixels` is keyed by cell — looking up by pixel.id is O(n). The inspector has the same problem (`creature-inspector.ts:78-80`).

### H2. `getCreatureRole` called everywhere, every tick, for every pixel
**Files:** pervasive — 26 call sites in 18 files
`getCreatureRole(p)` in `metabolism.ts:117` re-reads 5 DNA bytes and runs ~7 branches. It's called from:
- Every pixel, every tick in `simulation` iterator indirectly (renderer, ecosystem graph, arms race, species tree, territory, pack hunting, reactions, etc).
- `movement.ts:seekPixel` calls it on every candidate cell in the range-scan window (up to `(2R+1)² = 121` calls per pixel per tick with R=5).

Not a catastrophic hot-loop killer, but it's wasteful. The role for a pixel never changes unless DNA changes (via regulation? no — role uses raw `pixel.dna`, not `getEffectiveGene`). **So role can be cached on `Pixel` directly.**

**Fix:**
```ts
// pixel.ts, in createPixel, precompute role:
return { ..., role: computeRole(dna) };
// mutate role in reproduction when DNA changes
```
Or, if you prefer lazy: `getCreatureRole` could memoize into `pixel._role` with an invalidation flag. Roughly 10-20% reduction in hot-path CPU based on how often it's called. Measure before committing.

### H3. `seekPixel` is O((2R+1)²) per pixel per tick — meaningful at high pop
**File:** `src/movement.ts:158-184`
With `range=5` and 3000 pixels, that's 121 × 3000 = 363K cell lookups per tick. At 40 TPS, 14M/s. Each lookup is `world.pixels.get(cellKey(...))` → Map hash. On Chromium it's fine until ~5K pixels; on lower-end it chokes.

**Fix:** spatial binning or reusing a pre-computed 8-offset sample (the first 8 neighbors already happen via `seekFood` pattern). Alternatively, skip the full range scan unless the center 8 returned nothing — short-circuit.

### H4. `renderTerrainImageData` regenerates full 1000×750 ImageData every `SUBSTRATE_RENDER_INTERVAL=4` frames
**File:** `src/renderer.ts:181-241`
Triple nested loop: H × W × (S × S) = 150 × 200 × 25 = 750K ImageData writes per regen, every 4 frames, at 60 FPS = **11.2M writes/second** just for substrate, even when nothing on screen changed. The food/pheromone might not change much over 4 frames.

**Fix:** either extend `SUBSTRATE_RENDER_INTERVAL` (currently 4; try 8), or dirty-flag only regions that changed (harder, but a Uint8Array "dirty" grid would cut writes 10x).

### H5. `panelEl.innerHTML = ...` with interpolated values — theoretical XSS
**File:** `src/creature-inspector.ts:142-176`
All interpolated values (`pixel.id`, `pixel.generation`, `pixel.energy.toFixed(1)`, `pixel.x`, `pixel.y`, `ROLE_NAMES[role]`, etc) are numbers or internal constants. No user-controlled string flows in. So practical risk is zero.

But this is a latent trap: if later work adds a pixel "name" field from URL/localStorage, it would be injected. Using `textContent` or a real rendering framework would be safer. Low priority; flag for later.

### H6. Tween cache key collisions after reset
**File:** `src/renderer.ts:635`
`_tweenPositions` is a module-level `Map<number, ...>` keyed by `pixel.id`. Never cleared on reset. After reset, `world.nextPixelId` restarts at 1, so the first new pixel with id=1 looks up the tween from the PREVIOUS run's pixel #1. Visual: new creature spawns already tweening from some prior position.

**Fix:** add `export function resetTween() { _tweenPositions.clear(); }` and call from `main.ts:reset()`.

### H7. `updateAmbientWeather` is dead but called every frame
**Files:** `src/audio.ts:110`, `src/main.ts:70`
```ts
export function updateAmbientWeather(_weather: unknown): void { /* reserved */ }
```
Per-frame function call doing nothing. Remove the call, or remove the export and its import.

### H8. Inspector O(n) scan when cached pixel doesn't match
**File:** `src/creature-inspector.ts:60-85`
The "check if creature is at its known position first (O(1))" branch is fine. The fallback linear scan runs when the creature moved (every few ticks) — 3000 iteration linear scan 60 times per second is 180K ops/sec. Not terrible, but avoidable.

**Fix:** add a secondary `Map<id, Pixel>` to World. All writes (`movePixelTo`, `set`, `delete`) keep it in sync. O(1) lookup for inspector and pack-hunting.

---

## Medium Priority

### M1. Pixel tick loop can process a pixel that died this tick
**File:** `src/simulation.ts:42-54`
```ts
for (const pixel of shuffleArr) {
  const key = pixel.y * world.width + pixel.x;
  if (world.pixels.get(key) !== pixel) continue;
  // ...
  movePixel(pixel, world, config, events);
  if (world.pixels.get(pixel.y * world.width + pixel.x) !== pixel) continue;
  // applyAdhesion, markTerritory, tryReproduce
}
```
Works OK — checks after `movePixel`. But what if `metabolize` killed the pixel? Then `movePixel` is called on a pixel where `world.pixels.get(cellKey(pixel.x, pixel.y)) !== pixel` because the pixel was removed from the map. `movePixel` doesn't re-check; it processes happily. Actually wait — `metabolize` returns `false` and the loop does `if (!alive) continue;` at line 50. Good.

But `tryReproduce` doesn't check if `pixel.energy` is depleted below zero after a deferred kill from adhesion. Minor edge case. OK.

### M2. `foodPatches[i]` is reassigned on expiry, but `foodBuf` diffusion adds up partial patches over two frames
**File:** `src/substrate.ts:155-163`
```ts
if (p.life <= 0) world.foodPatches[i] = createFoodPatch(w, h);
```
The new patch emits food starting from next tick at a *different location* than the old one. Visual transition may look like a patch jumps suddenly. Cosmetic.

### M3. `crossoverRegulatoryGenes` loses genes
**File:** `src/genome.ts:84-98`
```ts
for (let i = 0; i < maxLen; i++) {
  const source = i % 2 === 0 ? a : b;
  if (i < source.length) result.push({ ...source[i] });
}
```
If `a.length = 5` and `b.length = 3`: at i=3 (odd) picks b, b[3] undefined → skipped. At i=4 (even) picks a, a[4] exists. Final length = 4, not 5 or 8. Silently drops half of the longer parent's regulatory genes. Whether that's intentional (bottleneck) is unclear; comment says "alternate picking from each parent" but that only works cleanly with equal-length arrays.

**Fix:** if you mean "random crossover per slot":
```ts
for (let i = 0; i < maxLen; i++) {
  const useA = Math.random() < 0.5;
  const source = useA ? a : b;
  if (i < source.length) result.push({ ...source[i] });
}
```

### M4. Inconsistent mutation-drift reference point between asexual & sexual repro
**Files:** `src/reproduction.ts:77`, `src/sexual-reproduction.ts:51-52`
Asexual measures drift between `childDna` and **parent.dna** (parent → child). Sexual measures between `childDna` and **crossovered** (pre-mutation intermediate → post-mutation child). The sexual version reports only the mutation magnitude, not the full genetic distance from either parent. That's actually *correct* for "mutation pulse" (the crossover is not a mutation — it's recombination) but differs from the asexual version, which confuses "mutation" with "parent-to-child delta". For mutation-pulse consistency, asexual should also compare pre/post-mutation DNA. Since asexual has no pre-mutation intermediate distinct from parent.dna, the two are numerically identical — but the intent should be explicit.

**Non-bug, just inconsistent framing.** Low priority.

### M5. `plague` event damages pixels without counting deaths
**File:** `src/events.ts:97-111`
```ts
pixel.energy -= 0.3 * PLAGUE_DAMAGE_MULT;
```
Drives pixels below 0 energy; metabolism next tick will detect and call removePixel + increment `events.deaths`. So deaths are correctly counted. However, the plague zone doesn't mark pixels as dying visually; no interaction effect. Minor.

### M6. `seekFood` reads only 8 neighbors at range=1 and 8 more at `range > 1` — skipping 9+ interior rings
**File:** `src/movement.ts:126-144`
```ts
for (let i = 0; i < 8; i++) { /* neighbors at offset 1 */ }
if (range > 1) {
  for (let i = 0; i < 8; i++) { /* same 8 directions at offset *range* */ }
}
```
This samples 16 cells total regardless of range. For range=5, the rings at distance 2/3/4 are completely ignored. Probably intentional for performance, but the comment says "sense in range R" and the food gradient check only looks at the extremes. Any food in the interior rings is invisible. Either add proper gradient sampling or rename/document the limitation.

### M7. `_pixelScale` hack in reactions
**File:** `src/reactions.ts:19,25,101,112,119`
```ts
let _pixelScale = 5;
// ...set inside resolveReaction
_pixelScale = _config.pixelScale;
```
Module-level mutable state to pass a value between functions in the same file. Just pass the config into the helpers. Or make `pixelScale` a constant export. Code smell.

### M8. `resolveAbsorb` uses `_config` but passes it around anyway
**File:** `src/reactions.ts:21-44`
The underscore prefix means "unused" (TS strict `noUnusedParameters`), but then line 26 uses `_config.pixelScale`. Prefix convention is misleading. Rename to `config`.

### M9. Species tree: alive species can die from pruning
**File:** `src/species-tree.ts:143-150`
Prunes "very old extinct species (keep last 50)" but the sort is by `lastTick`, and the slice takes the *first* (oldest) ones. Then `if (!sp.alive) species.delete(sp.id);` skips alive species. Fine, except: if an alive species has an old `firstTick` but gets updated each tick, it stays. OK. But the prune budget is 50 extinct. If there are 79 extinct + 10 alive = 89 species, the prune loop runs on first 39 by lastTick. Fine, works. Slightly confusing control flow.

### M10. `audio.ts:playUiSfx` bypasses master gain but respects mute
**File:** `src/audio.ts:140-151`
```ts
source.connect(gain);
gain.connect(audioCtx.destination);   // <-- bypasses masterGain
```
UI clicks won't be muted when the user mutes the app (unless you read `muted` — which line 141 does). OK, behavior is mute-aware. But the volume isn't affected by the master gain anymore, so if MASTER_GAIN is later exposed via a slider, UI clicks won't scale. Minor future-proofing miss.

### M11. `sfxLastFired` Map keys are strings from SFX_FILES — bounded at 5 entries
**File:** `src/audio.ts:16`
Bounded, fine. Mentioned in task list; confirming non-issue.

### M12. `movement.ts:62` `bestDx = Math.sign(bx); bestDy = Math.sign(by);` can produce (0,0) when both biases are tiny
If `|bx| > 0.1` but `|by| < 1` and `Math.sign(by) === 0`, the creature moves orthogonally — fine. Bug-free. Just flagging for awareness.

### M13. `renderer.ts:661` pack line range check `bestDist < (S * 8) * (S * 8)` is world-space squared distance
With S=5, that's `(40)² = 1600`. Members within 8 cells. Not toroidal-aware — packs that wrap the edge won't draw connecting lines. Cosmetic.

### M14. Sprite cache keyed by `paletteHash` which is 6 bits — 64 buckets
**File:** `src/sprites.ts:553-556`
Creatures with similar (but not identical) DNA share a palette. Intentional to bound cache size. Comment should make that explicit; right now it looks like a possible collision bug. Add a one-liner.

---

## Low Priority / Style

### L1. `_world` module global in `ui-controls.ts:9`
Used only in one slider handler to repopulate population. Could be closed-over instead.

### L2. `DX`/`DY` arrays duplicated across `movement.ts`, `reactions.ts`, `reproduction.ts`, `sexual-reproduction.ts`, `adhesion.ts`, `pack-hunting.ts` (via `wrapX/wrapY`).
YAGNI-KISS violation. Export once from `world.ts` or `constants.ts`.

### L3. `shuffled8()` reimplemented identically in 3 files.
`reactions.ts:133`, `reproduction.ts:95`, `sexual-reproduction.ts:106`, `adhesion.ts:64`. DRY.

### L4. `renderer.ts:728` `'FOOD'` icon is drawn as a drumstick — cute but the in-HUD legend says "Warning" + triangle. Inconsistency between ui help and actual rendering.

### L5. `renderer.ts:522` `isWall` check relies on raw `dna[14]` + `dna[3]`. These magic numbers should use `GENE.ARMOR` / `GENE.SPEED` from `types.ts`. There's a `pixel-state.ts:isWallPixel` that uses the same bare numbers.

### L6. `pixel-state.ts` also uses `dna[14]` and `dna[3]` directly — same problem. Break out into one canonical `isWallPixel`.

### L7. `sprites.ts:592` `getVariantIndex` is exported but has zero call sites.

### L8. `ecosystem-graph.ts:48` `renderEcosystemGraph` takes `_canvasW`, `_canvasH` but ignores them, hardcodes positions.

### L9. Tiny TS friction: `creature-inspector.ts:66` `(world as any).tick` — World has a `tick: number` field; the `as any` is gratuitous. Remove.

### L10. `ecosystem-graph.ts:7` ROLE_NAMES, `arms-race.ts:50`, `canvas-hud.ts:18`, `minimap.ts:14`, `creature-inspector.ts:21`, `species-tree.ts:9` — five+ copies of role name arrays and role color arrays. Consolidate into `color-map.ts` or a new `role-meta.ts`.

### L11. `migration.ts:12` module-level `prevSeason` is only reset via `onSeasonChange` which requires a season transition. On world reset from winter back to spring, the logic works — but only coincidentally. Move into World.

### L12. No `.gitignore` check done; `node_modules/` is present in listing so probably fine. Didn't verify.

### L13. Vite config exposes `base: '/my-projects/'` via env. Deploy target confusion — README doesn't explain.

### L14. The `MAX_PARTICLES = 150` constant in `weather.ts:16` is module-local. Every other constant lives in `constants.ts`. Inconsistent.

### L15. `reaction.ts:59` `defenderArmor * 4` magic factor. What's 4 here? Comment says "caps at 70% reduction" but the math is 0.5 unconditionally when the threshold passes, then `Math.max(0.3, 1 - defenderArmor/340)`. Either refactor or comment the derivation.

---

## Recent-Change Specific Findings (this session's work)

### Audio rewrite (`src/audio.ts`, `src/main.ts`, `src/ui-controls.ts`)
- **Bugs C1 (M-key collision), C7 (no AudioContext resume), H7 (dead `updateAmbientWeather` called every frame).**
- `initAudio` adds a document-level keydown listener that is never removed. Since `initAudio(config)` is called once from `main.ts:94` outside of `reset()`, this is OK — won't stack. But fragile: if you ever move it into `reset()`, stacks.
- `playSfx` cooldown via `performance.now()` is correct, but uses wall-clock time, not sim-tick time. If the sim is paused, cooldowns still tick. Minor.
- `sfxLastFired` bounded as noted.
- **Nitpick:** `MASTER_GAIN = 0.5` is a constant described as "user controls via M mute" — but mute is binary (0 or MASTER_GAIN), not continuous. Comment is misleading.

### Hunting fix (`src/movement.ts`)
- **C5 (ally filter too coarse for swarm), C6 (reroute branch silent desync).** See above.
- `isAllyOf` is defined in `movement.ts:186-191` and duplicates the rule from `reactions.ts:32-34`. DRY violation. If you update one, you must update the other. Move to shared helper in `metabolism.ts` or a new `roles.ts`.
- The comment "mirror reactions.ts ally rule" at line 169 is exactly the kind of thing that will rot. Code that must stay in sync should live in one place.

### Role glyphs (`src/renderer.ts:408-415`)
- 1.3×1.3 role marker is fine. Minor concern: at LOD 2 with heavy zoom the marker is 1-2 pixels wide against a rich background — low contrast. Black outline helps but might disappear on dark terrain.
- No bugs. Cosmetic only.

### Evolution visibility (`src/species-tree.ts`, `src/ecosystem-graph.ts`, `src/effects.ts`, `src/reproduction.ts`, `src/sexual-reproduction.ts`, `src/arms-race.ts`)
- **C3 (module-level state across resets) hits hardest here** — the species tree in particular will show species from the previous session as "still alive" until `SPECIES_COMPUTE_INTERVAL * 3 = 300` ticks pass without a match (plus the prune threshold).
- **C4 (ecosystem flow matrix leak)** is a direct consequence of this session's choice to expose the graph always-visible. It wasn't visible, no one noticed the bug.
- Mutation-pulse:
  - Asexual: `dnaDelta` compares child to parent. Sum of |Δ| over 16 genes > 30. Typical mutation: `numMutations = Math.floor((mutationRate/255)*8)` — so 0-8 bytes mutated, each by `±intensity` (default 15). Max possible |Δ| = 8×15 = 120. Threshold 30 fires on ~2-3 fully-maxed mutations. Fires often. Might be too chatty.
  - Sexual: `dnaDelta` compares child to crossover result. Same threshold. Fires less often because crossover doesn't count, only mutation contributes. Better calibrated.
  - Inconsistency: pulse is "significant drift" per both files. Threshold 30 is arbitrary and identical for both despite different scales. Consider: asexual threshold 60, sexual 20.
- `arms-race.ts:pushNotification` is now cross-module. `species-tree.ts:130` calls it. Creates a reverse dependency (tree → race). Acceptable but document the coupling. Race is also the home of `notifications` state; tree is a consumer. That's fine architecturally; just note it.
- `NEW_SPECIES_NOTIFY_AFTER_TICK = 500` suppresses startup flurry — but this is **world.tick**, and since `world.tick` resets to 0 on reset, the suppression works per-run. GOOD. No bug here. But see C3 — the `species` Map itself doesn't reset, so the old run's species will show up *in the tree* with their old first/lastTick values, which are > 500.

---

## Architecture Notes

### The Good
- Tick orchestration in `simulation.ts:26-85` is clear and readable: substrate → seasons → events → weather → shuffle → per-pixel → aggregates. This is how it should be.
- `movement.ts`'s decision to accumulate all directional biases then quantize once is correct and well-reasoned. The comment at line 49 shows the author knows why.
- Float32Array substrate + Uint8Array grids + Map<number, Pixel> is the right data model.
- 16-gene fixed DNA + variable regulatory overlay is a clean genome design.
- Camera/LOD separation between zoomed-out (ImageData fast path) and zoomed-in (tile + camera transform) is solid.
- Separation of `world` (pure data) from `main.ts` orchestration loop, from `renderer.ts` (pure rendering) is healthy.

### The Bad
- `renderer.ts` is 851 lines. The project conventions (`CLAUDE.md`, `development-rules.md`) target 200 LOC per file. Renderer does way too much: camera setup, substrate raster, pixel drawing, sprite decoration, behavior icons, pack lines, weather overlays, HUD passthrough, keybinding setup. Should split into:
  - `renderer-core.ts` (frame orchestrator)
  - `renderer-substrate.ts` (ImageData + tiles)
  - `renderer-pixels.ts` (sprite + glyph)
  - `renderer-decorations.ts` (auras, bars, icons, crowns, fins)
  - `renderer-input.ts` (camera wheel/pan/keyboard) — currently inside renderer.ts for no obvious reason
- `sprites.ts` is 594 lines of hand-rolled pixel art. Justifiable — it's essentially a data file. Not a file-size bug.
- `species-tree.ts` does clustering + tree rendering + notification pushing. Three concerns. Split.
- `ecosystem-graph.ts`, `arms-race.ts`, `species-tree.ts`, `canvas-hud.ts` each own their own render function that's called from `renderer.ts:renderFrame`. Reasonable. But they also each own their own update (tick) logic called from `simulation.ts`. This is essentially ECS without types — consider formalizing.

### The "Why is this still here"
- `audio.ts:109-110` `updateAmbientWeather` kept for "API compatibility". Kept and called from main every frame. Kill it. YAGNI.
- `sprites.ts:592-594` `getVariantIndex` exported, zero consumers.
- `types.ts:92` `FoodPatch.channel` marked "unused now but kept for type compat". Kill it or explain in a comment what would use it.

---

## Appendix: file-by-file one-liner

| File | What it does | Risk / Note |
|---|---|---|
| `main.ts` | Boot, reset, tick loop, RAF | **Reset doesn't reset module globals (C3). Listeners stack (C2).** |
| `simulation.ts` | Tick orchestrator — fisher-yates shuffle + per-pixel cascade | Clean. Plague kills don't credit events.deaths until next metabolize tick (OK). |
| `world.ts` | World struct, seed, wrap, cellKey, move/remove helpers | Clean. |
| `constants.ts` | Tuning knobs + default config factory | Clean. `SEASON_ORDER` is unused here (duplicated in `seasons.ts`). |
| `types.ts` | Genome, World, TickEvents types + Terrain enum | Clean. |
| `pixel.ts` | Pixel factory + 7 archetype DNA seeders | Clean. |
| `genome.ts` | Mutation + crossover helpers | **M3: crossoverRegulatoryGenes silently drops genes.** |
| `regulation.ts` | Gene-modifier application | Clean. |
| `metabolism.ts` | Harvest + upkeep + death; getCreatureRole | **H2: role is recomputed everywhere.** |
| `movement.ts` | Sensing + movement + ally filter | **C5, C6 as above.** |
| `reactions.ts` | Absorb/share/catalyze/repel | **M7 _pixelScale module state. M8 misnamed _config.** Ally rule duplicates movement. |
| `reproduction.ts` | Asexual repro | Clean except mutation-pulse threshold framing (M4). |
| `sexual-reproduction.ts` | Share-based sexual repro | Clean. |
| `adhesion.ts` | Neighbor similarity bonus/flee | DRY violation (shuffled8). |
| `pack-hunting.ts` | Pack formation + movement bias | **H1: leader coords stale between formations. C3: packs map leaks across reset.** |
| `territory-system.ts` | Role-based territory tagging | Clean. |
| `migration.ts` | Seasonal memory + migration target | **C3: prevSeason/lastUpdateTick leak across reset.** |
| `spatial-memory.ts` | Food/danger memory entries | Clean. |
| `pixel-state.ts` | Threat/satiety/social decay | **L6: duplicate isWallPixel logic vs renderer.** |
| `arms-race.ts` | Trait spike detection + notifications | **C3: snapshots/notifications leak across reset.** |
| `species-tree.ts` | Genome clustering + tree panel | **C3: species Map leaks across reset. Ghost species.** |
| `ecosystem-graph.ts` | Food web render + energy flow tracking | **C4: flowMatrix never zeroed after averaging.** |
| `weather.ts` | Weather types + particles | **L14: MAX_PARTICLES lives here not in constants.** |
| `seasons.ts` | Season progression | Clean. |
| `substrate.ts` | Food emit/diffuse/decay + pheromone/corpse/wear | Clean. `neighborOffsets` size-guarded. |
| `terrain.ts` | Noise → tile type + context color | Clean. |
| `terrain-tiles.ts` | 16×16 tile pregeneration + overlays | Clean. |
| `color-map.ts` | HSL/RGB + role colors | Clean. |
| `sprites.ts` | 16×16 sprite templates + palette cache | **M14: 6-bit palette hash buckets creatures. L7: getVariantIndex dead export.** |
| `effects.ts` | Ring buffer birth/death/interaction FX | Clean. Added mutation pulse. Fine. |
| `canvas-hud.ts` | Season badge + pop bar + evolution sparklines | **C3: traitHistory/prevSeason leak.** |
| `minimap.ts` | Bottom-right minimap + click-to-jump | Clean. Terrain cache handled via reset-hash. |
| `creature-inspector.ts` | Rich side panel on click | **H5 innerHTML (latent XSS), H8 O(n) scan, L9 as any.** |
| `camera.ts` | Zoom/pan/LOD/transforms | Clean. |
| `renderer.ts` | Substrate + pixel + HUD + input (!) | **851 LOC. Too big. Otherwise working.** M-key collision lives here. |
| `god-mode.ts` | Wall/food/spawn/kill/boost tools | Clean. |
| `replay.ts` | Snapshot record + replay | **C3: snapshots leak. Reset doesn't clear.** |
| `snapshot.ts` | Compact world snapshot capture | Clean. Uint8Array for positions OK since world is 200×150. |
| `stats.ts` | Side-panel stats + pop graph | **C3: cachedSpeciesCount/_displayTps leak.** |
| `ui-controls.ts` | Sliders + view buttons + canvas interaction | **C2: stacks listeners on every reset.** |
| `audio.ts` | TTS drones + SFX cooldowns + mute | **C1 keybinding, C7 no resume, H7 dead function.** |
| `locomotion.ts` | walk/swim/fly derivation from DNA | Clean. |
| `events.ts` | Meteor/drought/bloom/plague | Clean. Minor M5. |
| `index.html` | UI scaffold + CSS + legend | M-key legend wrong after audio change (says minimap, not mute). |

---

## Open Questions

1. Is the ally-filter meant to prevent hunters from cannibalizing *same-role* (e.g. hunter eating hunter) or is it strictly predator-vs-predator? The current rule does both, but the second is documented and the first is implied. Intent?
2. What's the actual performance budget? The loop at `main.ts:61` says 14ms per RAF. Have you measured `simulateTick` wall time at 3000 pixels?
3. Are module-level globals (species, packs, flowMatrix, etc.) an intentional design choice (singleton systems) or accidental (never thought about reset)? If intentional, need reset hooks. If accidental, move to World.
4. Is there a plan for tests? Even basic unit tests on `movement.seekPixel`, `reactions.resolveAbsorb`, `genome.mutateDna` would catch regressions like C5 and C6 immediately. No package-level test framework is configured.
5. The `paletteHash` 6-bit bucketing means two creatures with identical roles but different DNAs can share sprite palettes. Is this intentional gradient smoothing, or unnoticed collision?
6. `Terrain.ROCK = 5` + `classify` in `terrain.ts:36` produces rock at `elev > 0.78`. But `canBirthOn` excludes rock. Is this desired (rock is lifeless) or a bug? Right now plants can't birth on rock.
7. What's the priority — stability (fix C1–C7 first) or features (keep iterating on visible evolution)?

---

*Reviewer note: This codebase's weakness is statefulness, not logic. The simulation math is solid; the fabric around it (reset discipline, listener hygiene, module boundaries) is the problem. A single afternoon's work on C1–C4 and C6 would fix the top cluster. C3 is the hardest because it requires touching ~12 files, but skipping it guarantees weird bugs every time the user presses Reset.*
