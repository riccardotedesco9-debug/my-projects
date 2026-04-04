# OOZE Critical Review & Evolution Overhaul

## Brutal Assessment

### What Works
- Clean modular architecture (21 files, all <150 lines)
- Substrate chemistry is a solid foundation
- Energy balance now sustains populations
- Performance is good (Canvas ImageData, Float32Array)
- Seasons create real pressure cycles

### What Doesn't Work

**1. Visuals are unreadable noise**
Tiny 3px dots on dark background. Can't distinguish predators from prey from plants. No trails, no organism shapes, no visual hierarchy. Emergent Garden's sims work because you can SEE behavior — OOZE looks like TV static with colored corners.

**2. No real food chain**
Every pixel eats substrate directly. "Absorb" reaction exists but there's no evolutionary PRESSURE to become an obligate predator or herbivore. Everyone's an omnivore. No trophic levels actually emerge because substrate harvesting is always available.

**3. ReactType gene is too coarse**
One gene (0-255) split into 4 equal buckets = 25% are predators from birth. They don't EVOLVE into predators — they're randomly assigned. No gradient, no hybrid strategies, no specialization pressure.

**4. Regulatory genes are decorative**
+20% stat buff. Doesn't change WHAT the pixel does. Real regulation should enable behavioral switching (hunt when hungry, harvest when safe).

**5. No organism identity**
Every pixel is structurally identical. A fast predator, a sessile plant, and a cooperative tribe member are all the same 3px dot.

**6. Dead zone is dead space**
Center of world = no substrate = nothing happens. Wasted screen real estate. Evolution happens at boundaries, not voids.

---

## Recommended Improvements (Prioritized)

### TIER 1: Critical (Transform the Sim)

#### A. Forced Trophic Specialization
**Problem:** No food chain pressure.
**Fix:** Make harvest efficiency and absorb efficiency INVERSELY correlated.

```
effectiveHarvest = harvestGene * (1 - absorbSkill/255 * 0.7)
effectiveAbsorb  = absorbGene  * (1 - harvestSkill/255 * 0.7)
```

Where `harvestSkill = avg(harvest_R, harvest_G, harvest_B)` and `absorbSkill` derived from reactType when in absorb range.

**Result:** High harvest = bad absorb (herbivore/plant). High absorb = bad harvest (predator). Must specialize. Creates:
- **Producers**: High harvest, low absorb, slow. Eat substrate.
- **Consumers**: Low harvest, high absorb, faster. Eat producers.
- **Apex**: Very low harvest, very high absorb. Eat consumers.

#### B. Corpse Layer
**Problem:** Death is invisible. No scavenger ecology.
**Fix:** Add a corpse array (`Uint8Array`, one byte per cell, 0=empty, 1-255=corpse energy).

- Dead pixel → corpse at its cell (energy = min(255, pixel.energy * 2))
- Corpses decay by 2/tick
- Corpses rendered as grey/brown dots (distinct from live pixels)
- Any pixel on a corpse cell harvests corpse energy (like substrate but faster)
- Creates scavenger niche, visible battlefields, nutrient hotspots

#### C. Visual Overhaul
**Problem:** Can't see what's happening.
**Fix:** Multiple rendering improvements:

1. **Size by energy**: Render pixel as 2px when starving, 3px normal, 4px well-fed
2. **Shape by role** (derived from genes, not explicit):
   - High harvest + low speed → filled square (plant)
   - High absorb + high speed → diamond/triangle (predator)
   - High adhesion + share → circle with ring (cooperator)
3. **Glow for high-energy pixels**: Add 1px halo of pixel color at 30% opacity
4. **Substrate trails**: When a pixel moves, boost substrate intensity along its path (pheromone trails). Already happens via waste genes — just make the rendering more prominent
5. **Death particles**: When a pixel dies, briefly flash its cell white for 2 frames
6. **Adhesion lines**: Draw thin lines between adjacent pixels with similarity > 12 (shows tribal bonds)

#### D. Age Decay
**Problem:** Successful pixels live forever, dominate indefinitely.
**Fix:** After age > 500, upkeep increases by 0.001 per tick of age.

```
agePenalty = max(0, (pixel.age - 500) * 0.001)
totalUpkeep += agePenalty
```

Forces generational turnover. Old pixels die of old age, making room for evolved offspring. Prevents stagnation.

### TIER 2: Important (Deepen Evolution)

#### E. Food Patches (Substrate Heterogeneity)
**Problem:** Emission zones are static rectangles.
**Fix:** Add 8-12 random "food patches" — small circular regions (radius 10-20) that emit substrate.

- Patches drift slowly (1 cell per 50 ticks in random direction)
- Each patch emits only 1-2 channels (not all RGB)
- Patches have lifespans (500-2000 ticks), then fade and respawn elsewhere
- Creates dynamic geography — pixels must migrate to track resources

#### F. Pheromone Communication
**Problem:** No long-range signaling.
**Fix:** Add a 4th substrate channel: "pheromone" (yellow).

- All pixels deposit pheromone proportional to their energy
- Pheromone diffuses faster than RGB substrate (2x diffusion rate)
- Pheromone decays faster (0.98 vs 0.997)
- Pixel seekers can choose to follow pheromone gradient instead of pixel detection
- Creates ant-trail-like behavior, visible migration highways

#### G. Better Regulatory Genes → Behavioral Switching
**Problem:** Reg genes just buff stats.
**Fix:** Let reg genes modify the SENSE_TARGET gene based on internal state.

```
For each regulatory gene:
  if pixel.state[conditionIdx % 3] > threshold:
    override senseTarget temporarily
```

This means: "when threatened, become a fleeer" or "when full, become a pixel-seeker (predator)". Actual behavioral switching, not stat buffing.

### TIER 3: Nice to Have (Polish)

#### H. Mini-Organism Clustering
Pixels with adhesion > 200 and similarity > 14 that are adjacent for > 20 ticks form a "cluster". Clusters:
- Share energy equally (commune)
- Move as a unit (slowest member's speed)
- Display as a connected blob (filled polygon)
- Take combined damage from absorb attacks

#### I. Environmental Events
Random events every 500-2000 ticks:
- **Meteor**: Kills all pixels in a 15-cell radius, deposits massive substrate
- **Drought**: One substrate channel stops emitting for 200 ticks
- **Bloom**: Random area gets 10x emission for 100 ticks
- **Plague**: Random reactType becomes 2x lethal for 100 ticks

#### J. Expanded Stats
- Trophic distribution pie chart (% producers vs consumers vs apex)
- Kill/death ratio per species
- Phylogenetic tree (simplified: track lineage branching)
- Heatmap overlay showing where deaths cluster

---

## Implementation Priority

```
MUST DO (transforms the experience):
  A. Forced trophic specialization  → metabolism.ts, reactions.ts, constants.ts
  B. Corpse layer                   → new: corpses.ts, world.ts, renderer.ts
  C. Visual overhaul                → renderer.ts, color-map.ts
  D. Age decay                      → metabolism.ts, constants.ts

SHOULD DO (deepens evolution):
  E. Food patches                   → substrate.ts, world.ts
  F. Pheromone channel              → substrate.ts, types.ts, movement.ts
  G. Behavioral switching           → regulation.ts, movement.ts

NICE TO HAVE (polish):
  H. Mini-organism clusters         → new: clusters.ts
  I. Environmental events           → new: events.ts
  J. Expanded stats                 → stats.ts, renderer.ts
```

## Risk Assessment
- Trophic specialization needs careful tuning — too aggressive = all herbivores die
- Corpse layer adds O(n) per tick but it's just Uint8Array decrement = trivial
- Visual changes are rendering-only, no simulation impact
- Food patches add complexity to substrate but isolated in one function
- Pheromone is just a 4th channel — minimal architecture change

## Success Criteria
- Within 2000 ticks: visible distinct producer/consumer populations (color-coded)
- Corpse patches visible after predator attacks
- Pixel size visibly varies by energy level
- Tribal bonds visible as connecting lines
- Food patches create migration patterns
- Population sustains 500+ with active predator-prey cycling
