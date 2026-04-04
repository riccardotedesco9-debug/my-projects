# Code Review: Pixel-Life 10 New Features

**Reviewer:** code-reviewer | **Date:** 2026-04-04 | **Build:** PASS (tsc --noEmit clean)

## Scope

- **New files (10):** spatial-memory, creature-inspector, territory-system, god-mode, pack-hunting, ecosystem-graph, migration, species-tree, arms-race, snapshot + replay
- **Modified files (10):** types, pixel, constants, simulation, movement, reactions, renderer, main, ui-controls, world
- **Focus:** Critical bugs, O(n^2) performance, integration, memory leaks
- **Total LOC reviewed:** ~2,800 (new) + ~600 (diffs in modified)

## Overall Assessment

Solid implementation. All 10 systems are properly wired into the tick loop via `simulation.ts`. TypeScript compiles clean. Most systems use interval-gating to avoid per-tick cost. Three performance issues found, one potential crash, and two memory leak risks.

---

## Critical Issues

### C1. Species Tree: O(n^2) clustering on full population

**File:** `src/species-tree.ts:41-58`

The clustering loop iterates all pixels against all pixels:
```ts
for (const p of pixels) {        // n pixels
  for (const other of pixels) {  // n pixels
    // ...genome distance check
  }
}
```

With 500+ creatures, this is 250,000 distance comparisons (each comparing 16 genes). At `SPECIES_COMPUTE_INTERVAL = 100` ticks, this fires ~once per 10 seconds at default speed, so it won't cause frame drops constantly -- but at high populations (MAX_POP_FRACTION = 10% of 30,000 = 3,000 creatures), this becomes 9 million comparisons causing a multi-frame stall.

**Fix:** Sample before clustering (same pattern as `stats.ts:computeSpecies` which already caps at 200). Add:
```ts
const sample = pixels.length > 300
  ? pixels.sort(() => Math.random() - 0.5).slice(0, 300)
  : pixels;
```

**Severity:** HIGH -- will cause visible lag spikes at high populations.

### C2. Pack Hunting: O(n^2) neighbor search in clustering

**File:** `src/pack-hunting.ts:59-68`

The flood-fill searches all candidates for proximity to every queue member:
```ts
for (const other of candidates) {  // up to n candidates
  // for each queue member
}
```

With `PACK_FORMATION_INTERVAL = 50`, this runs every 5 seconds. The candidate pool is filtered to adhesion >= 180 predators only, so typically small. At high populations with many predators, worst case ~hundreds of candidates making this O(k^2) where k = predator count. Acceptable for most cases but worth noting.

**Severity:** MEDIUM -- only impacts predator-heavy ecosystems.

### C3. getTrackedPixel: O(n) scan every frame

**File:** `src/creature-inspector.ts:51-60`

```ts
export function getTrackedPixel(world: World): Pixel | null {
  for (const p of world.pixels.values()) {
    if (p.id === trackedId) return p;
  }
```

This scans all pixels every render frame (60fps) when inspector is open. The world stores pixels by position key `y*w+x`, not by ID. With 500+ creatures this is 30,000 comparisons/sec.

**Fix:** Maintain a `Map<number, Pixel>` index by ID in world, or cache the tracked pixel reference and re-validate:
```ts
let trackedPixel: Pixel | null = null;
export function getTrackedPixel(world: World): Pixel | null {
  if (!trackedPixel || trackedPixel.id !== trackedId) {
    trackedPixel = null;
    for (const p of world.pixels.values()) {
      if (p.id === trackedId) { trackedPixel = p; break; }
    }
  }
  // Validate still in map (may have been removed on death)
  if (trackedPixel && !world.pixels.has(trackedPixel.y * world.width + trackedPixel.x)) {
    trackedPixel = null; trackedId = null;
  }
  return trackedPixel;
}
```

**Severity:** MEDIUM -- only when inspector panel is open, but 60fps * O(n) adds up.

### C4. getPackMoveBias: O(n) leader search every movement

**File:** `src/pack-hunting.ts:90-103`

```ts
export function getPackMoveBias(pixel: Pixel, world: World): [number, number] {
  // ...
  for (const p of world.pixels.values()) {
    if (p.id === pack.leader) { ... break; }
  }
```

Every pack member scans all world pixels each tick to find the leader's position. With 100 pack members and 500 total, that's 50,000 comparisons per tick.

**Fix:** Cache leader position in the Pack struct during `updatePacks()`:
```ts
interface Pack {
  // ...existing
  leaderX: number;
  leaderY: number;
}
```

**Severity:** HIGH -- runs per-tick per-pack-member, multiplied with population.

---

## Memory Leak Risks

### M1. Species Tree: pixelSpecies map never prunes dead creatures

**File:** `src/species-tree.ts:21`

```ts
const pixelSpecies = new Map<number, number>(); // pixelId -> speciesId
```

Entries are added whenever a creature is assigned to a species but never removed when a creature dies. Over a long session with thousands of creature births/deaths, this map grows unboundedly. IDs are monotonically increasing (`world.nextPixelId++`), so old entries are never reused.

**Fix:** Clear the map at the start of each `updateSpeciesTree` call (since it rebuilds cluster assignments from scratch anyway), or prune IDs not in `world.pixels` during the species computation.

**Severity:** HIGH for long sessions (hours). Map will hold millions of stale entries.

### M2. Replay snapshots: unbounded TypedArray accumulation

**File:** `src/replay.ts:57-68`

The downsampling from `MAX_SNAPSHOTS = 500` is correct but each snapshot allocates 4 TypedArrays of creature count size. With 500 snapshots x 500 creatures = 1MB. This is bounded and fine.

However, `nextPackId` in pack-hunting.ts increments forever -- after millions of ticks, it could overflow Number.MAX_SAFE_INTEGER. Theoretical, not practical.

**Severity:** LOW -- bounded by MAX_SNAPSHOTS.

### M3. Arms Race notifications array splice in render loop

**File:** `src/arms-race.ts:96-100`

```ts
for (let i = notifications.length - 1; i >= 0; i--) {
  notifications[i].age++;
  if (notifications[i].age > 180) notifications.splice(i, 1);
}
```

This splices during the render loop at 60fps. With max 3 notifications capped by `addEvent`, this is fine. No memory leak -- properly bounded.

**Severity:** NONE (correctly bounded).

---

## Integration Issues

### I1. Ecosystem graph updated in render loop, not tick loop

**File:** `src/renderer.ts:128`

```ts
updateEcosystemGraph(world);  // inside renderFrame()
```

This updates population counts every render frame (60fps) rather than per simulation tick. The flow matrix averaging divides by `SAMPLE_WINDOW = 200`, but `windowTicks` increments at render framerate, not simulation tick rate. At 60fps with 10 TPS, the graph updates 6x faster than simulation ticks, causing the flow data to be diluted.

**Fix:** Move `updateEcosystemGraph(world)` into `simulateTick()` in simulation.ts, alongside the other periodic systems.

**Severity:** MEDIUM -- ecosystem graph data will be inaccurate (understated flows).

### I2. God mode executeGodTool doesn't validate world bounds for wrapped coordinates

**File:** `src/god-mode.ts:36-43`

The area tools use `wrapX/wrapY` which handles wrapping correctly. Single-cell tools validate bounds at line 29. This is fine.

### I3. Replay mode skips stats update

**File:** `src/main.ts:49-54`

During replay mode, `updateStatsDisplay` and `updateInspector` are never called -- only `renderReplayFrame`. This is intentional design (replay shows minimal HUD). Not a bug.

### I4. Territory view mode added to ViewMode type

**File:** `src/types.ts:17` and `src/ui-controls.ts:33-34`

Territory is properly added to `ViewMode` union and wired to view buttons. The renderer handles it in `renderTerrainImageData`. Integration is complete.

---

## Edge Cases

### E1. Territory system uses pixel.id as owner, but IDs are not globally unique after death

**File:** `src/territory-system.ts:31`

Territory cells store `pixel.id` as owner. When a creature dies, its ID is never reused (IDs are monotonically increasing). However, `world.territory` stores `Int16Array` values, and `pixel.id` can exceed 32,767 after many births. `Int16Array` overflows to negative values, which would collide with `-1` (unclaimed sentinel).

After 32,768 total creature births across the session, territory ownership breaks silently. With 100 creatures reproducing, this happens in ~300 generations.

**Fix:** Use `Uint16Array` (max 65,535) or modular ID assignment. Or change sentinel from -1 to 0 and start IDs at 1.

**Severity:** HIGH -- guaranteed to corrupt territory data in any extended session.

### E2. Snapshot xs/ys are Uint8Array, but world is 200x150

**File:** `src/snapshot.ts:12-13`

```ts
xs: Uint8Array;  // x positions (0-199)
ys: Uint8Array;  // y positions (0-149)
```

Uint8Array max value is 255. With default world 200x150, positions fit. But if `worldWidth` or `worldHeight` exceeds 255 in config, positions silently wrap to `value % 256`.

**Severity:** LOW -- default config is safe, but the comment "0-199" hints this was designed for current defaults only.

### E3. Memory bias can produce NaN if all memories are at pixel location

**File:** `src/spatial-memory.ts:83-84`

When `dist < 1`, we `continue`. If ALL memories are within distance 1, `bx` and `by` remain 0, and `mag < 0.01` returns `[0,0]`. This is correct -- no NaN risk. Safe.

---

## Positive Observations

1. **Interval gating everywhere:** Species tree (100 ticks), pack hunting (50 ticks), arms race (200 ticks), migration (100 ticks). This prevents new systems from dominating tick cost.
2. **Ring buffer effects:** `effects.ts` uses fixed-size arrays with head pointer -- zero allocation during gameplay.
3. **Replay downsampling:** Snapshots auto-downsample when exceeding 500 entries. Prevents runaway memory.
4. **Clean separation of concerns:** Each system in its own file, clear exports, no circular dependencies.
5. **Territory decay:** Proper age-based decay prevents stale territory from persisting forever.
6. **Toroidal wrapping** handled consistently across memory bias, pack hunting, and migration.

---

## Recommended Actions (prioritized)

1. **[HIGH] Fix territory Int16Array overflow (E1)** -- change to `Uint16Array` + sentinel 0 instead of -1, or use modular IDs. This WILL corrupt data in normal gameplay.
2. **[HIGH] Sample species tree clustering (C1)** -- cap input to 300 pixels before O(n^2) loop.
3. **[HIGH] Cache pack leader position (C4)** -- store leaderX/leaderY in Pack struct during updatePacks.
4. **[HIGH] Prune pixelSpecies map (M1)** -- clear at start of each updateSpeciesTree call.
5. **[MEDIUM] Move updateEcosystemGraph to tick loop (I1)** -- currently in render loop, diluting flow data.
6. **[MEDIUM] Cache tracked pixel in inspector (C3)** -- avoid O(n) scan at 60fps.

---

## Unresolved Questions

1. Should `world.territory` be sized by cell count (200*150 = 30K) using creature IDs that can reach millions? Fundamentally the Int16Array choice needs revisiting.
2. The `stats.ts:computeSpecies` and `species-tree.ts:updateSpeciesTree` both compute species clustering independently with different algorithms. Should they share a single computation?
3. `shuffled8()` is duplicated in 3 files (reactions.ts, reproduction.ts, sexual-reproduction.ts). Extract to a shared utility?
