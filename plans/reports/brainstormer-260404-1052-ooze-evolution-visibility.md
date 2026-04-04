# OOZE: Making Evolution and Environment Visually Tangible

## Problem Statement

Two core user experience failures:

1. **Evolution is invisible.** DNA mutates, genes drift, speciation occurs in the numbers -- but a creature born at tick 10,000 looks identical to one born at tick 10. The user sees dots moving around with no sense that anything is changing or adapting.

2. **Environment feels disconnected.** Terrain affects food rates, weather modifies upkeep, wear tracks foot traffic -- but these are invisible numerical modifiers. The world and its creatures appear to exist in parallel, not as an interacting system.

Both problems share a root cause: **the simulation communicates through stats panels, not through the canvas itself.** The viewer must read numbers to know evolution is happening. A great life simulator makes you feel it by watching.

---

## Current State Analysis

### What the renderer currently shows per creature
- **Color**: HSL derived from role base hue + DNA shift (~20-degree range from harvest genes) + energy-based luminance
- **Shape**: Fixed per role (circle, triangle, diamond, cross, star, hexagon, arrow)
- **Size**: radius = 2 + (energy/100) * 2.5 -- ranges 2-4.5px, all same base
- **Effects**: Newborn flash (age < 3), dim when starving (energy < 25%), glow when well-fed (energy > 60%)

### What the renderer currently shows for environment
- Terrain: Static colors with season tinting and weather tinting
- Food: Only visible in substrate view mode (not default)
- Wear: Darkened paths (kicks in at wear > 30, max 30% darkening)
- Corpses: Brownish marks (subtle, factor of corpse/50)
- Pheromone: Very subtle warm glow (pheromone * 8 on R, * 5 on G)

### Why evolution is invisible
1. DNA shift on color is only ~20 degrees of hue. Two creatures with very different genomes can look nearly identical.
2. Shape is locked to role archetype. Within a role all creatures look the same.
3. No size variation from genes. Size is purely energy-based.
4. Generation/lineage only visible in lineage view mode, not default.
5. No visual indication of regulatory gene complexity or evolutionary age.

### Why environment feels disconnected
1. Food is invisible in normal view.
2. Wear is too subtle and too slow to build up visibly.
3. Weather modifies numbers but does not change creature behavior in any visible way.
4. Seasonal terrain tinting is subtle (5-15 RGB points).
5. No visible feedback loops: overgrazing does not create visible barren patches.

---

## Proposed Solutions

### PROBLEM 1: Making Evolution Visible

#### Idea 1A: DNA-Driven Size Variation (HIGH impact, LOW effort)

**What:** Let genes influence creature base size, not just energy.

**How:** Add a body mass derived metric from DNA:

    bodyMass = (dna[ARMOR] * 0.4 + harvestAvg * 0.3 + (255 - dna[SPEED]) * 0.3) / 255
    baseRadius = 1.5 + bodyMass * 2.0  // range: 1.5 to 3.5
    finalRadius = baseRadius * (0.5 + (energy/MAX_ENERGY) * 0.5)

**Visual result:** Heavy, armored, slow creatures are visibly LARGER. Fast predators are visibly smaller and sleeker. Over generations, if armor evolves up, you literally SEE creatures getting bigger.

**Performance:** Zero cost. Just a different radius calculation.

**Priority: 1 (do this first)**

---

#### Idea 1B: Continuous Color From Full Genome (HIGH impact, LOW effort)

**What:** Use more genes to determine color, not just harvest genes and role hue.

**How:** Increase DNA shift range from 20 degrees to 60-80 degrees. Use senseTarget, reactType, adhesion, and mutationRate genes for saturation and luminance variation. Two hunter lineages that evolved independently will look distinctly different.

**Visual result:** Speciation becomes visible as color clusters. A group of orange hunters diverges into red-orange and yellow-orange lineages.

**Performance:** Negligible.

**Priority: 2**

---

#### Idea 1C: Generation Markers in Default View (MEDIUM impact, LOW effort)

**What:** Show evolutionary depth without switching to lineage mode.

**How:** Subtle visual markers for high-generation creatures:
- **Outline thickness**: Gen 0-10 = no outline. Gen 10-50 = 0.5px outline. Gen 50+ = 1px outline.
- **Pip count**: Small dots around creature (1 pip per 25 gens, max 4).

**Visual result:** Glance at canvas, see old lineages vs newcomers.

**Performance:** Extra strokeStyle per creature. ~5-10% renderer cost. Acceptable.

**Priority: 3**

---

#### Idea 1D: Adaptation Glow / Fitness Indicator (MEDIUM impact, LOW effort)

**What:** Creatures well-adapted to their current terrain glow brighter.

**How:** Compute fitness based on gene-environment match. Display as brightness boost.

**Visual result:** Bright clusters where adapted. Dim strugglers in hostile territory.

**Performance:** One fitness calc per creature per frame. Cheap.

**Priority: 4**

---

#### Idea 1E: Birth/Death Particle Effects (HIGH impact, MEDIUM effort)

**What:** Make reproduction and death visually dramatic.

**How:**
- **Birth**: Brief expanding ring (2-3 frames) in creature color at birth location.
- **Death**: 2-3 tiny particles scatter outward (1-2 frames), fading to corpse brown.
- Ring buffer of recent events (max 50-100), rendered as overlay.

**Visual result:** Active areas pulse with birth ripples. Kill zones flicker with death particles. You SEE where evolution is fastest.

**Performance:** 50-100 particles max. Trivial for Canvas 2D.

**Priority: 2 (tie with 1B -- both transformative for feel)**

---

#### Idea 1F: Speciation Color Clustering (HIGH impact, HIGH effort)

**What:** Auto-detect species clusters and assign stable distinct colors.

**How:** Extend existing computeSpecies() to keep cluster centroids. Map creatures to nearest centroid for coloring.

**Visual result:** Species become visually distinct groups. Speciation visible as new colors.

**Performance:** O(n * k) cached every 100 ticks. Fine.

**Priority: 5 (great but complex for stable color assignment)**

---

### PROBLEM 2: Making Environment-Creature Interaction Visible

#### Idea 2A: Always-On Food Visualization (HIGH impact, LOW effort)

**What:** Show food levels in default view, not just substrate mode.

**How:** In renderTerrain, always blend food into terrain color at reduced intensity. Move the food overlay outside the showFood guard at half intensity (~15 green boost instead of 35).

**Visual result:** Grass brighter where food abundant, fading where grazed bare. Overgrazing visible. Recovery visible as greening.

**Performance:** Already computed. Zero additional cost.

**Priority: 1 (highest ROI of any environment change)**

---

#### Idea 2B: Visible Resource Depletion Halos (HIGH impact, LOW effort)

**What:** Show feeding activity under creatures.

**How:** Since 2A shows food depletion, amplify contrast -- low-food cells get slight brown/yellow tint instead of just darker green.

**Visual result:** Visible grazing marks under feeding clusters. Carrying capacity visible.

**Performance:** Minimal.

**Priority: 3**

---

#### Idea 2C: Weather-Driven Visible Behavior Changes (HIGH impact, MEDIUM effort)

**What:** Make weather visibly change creature behavior.

**How (simulation changes):**
- **Storm/snow**: Multiply speed by (1 - intensity * 0.4). Creatures visibly slow and cluster.
- **Drought**: Creatures migrate toward water-adjacent cells. Die-offs in dry areas.
- **Rain**: Amplify food boost to 1.5x+. Terrain visibly greens. Birth rate spikes.
- **Heatwave**: Extra upkeep in sand/rock. Die-offs in desert, clustering in forest.

**Visual result:** Storm -> creatures slow, huddle. Drought -> migration. Rain -> green explosion.

**Performance:** Speed modifiers already exist. Key is visible magnitude.

**Priority: 2**

---

#### Idea 2D: Terrain Transformation from Creature Activity (MEDIUM impact, MEDIUM effort)

**What:** Creatures change terrain appearance over time.

**How:**
- **Heavy wear (> 150)**: Strong blend toward dirt brown. Visible highways.
- **Corpse zones**: Reddish-brown stain, fading over ~200 ticks. Battlefield memory.
- **Rewilding**: High food + no wear = cells get greener.

Current wear caps at 30% darkening. Double it. At wear 200+, looks like different biome.

**Visual result:** Map tells story -- corridors, battlefields, pristine vs exploited.

**Performance:** Just color blending. Negligible.

**Priority: 3**

---

#### Idea 2E: Terrain Preference Amplification (MEDIUM impact, LOW effort)

**What:** Steepen food rate differences between terrains.

**How:**
- Current: grass=1.0, forest=0.6, dirt=0.3, sand=0.1
- Proposed: grass=1.0, forest=0.5, dirt=0.12, sand=0.02

**Visual result:** Dense in grass/forest. Sparse in dirt. Empty sand. Ecological map visible.

**Performance:** Zero.

**Priority: 4**

---

#### Idea 2F: Seasonal Migration via Geographic Food Gradient (HIGH impact, MEDIUM effort)

**What:** Food gradient shifts with seasons, driving visible migration.

**How:** In emitFromTerrain, modulate food emission by latitude. Summer boosts northern half, winter boosts southern half. Creates food gradient that creatures naturally follow.

**Visual result:** Waves of creatures drifting with seasons. Nomads benefit visibly.

**Performance:** One multiply per cell. Negligible.

**Priority: 3**

---

## Impact vs Effort Matrix

|                   | LOW EFFORT             | MEDIUM EFFORT          | HIGH EFFORT        |
|-------------------|------------------------|------------------------|--------------------|
| HIGH IMPACT       | 1A DNA-Driven Size     | 1E Birth/Death FX      | 1F Species Colors  |
|                   | 2A Always-On Food      | 2C Weather Behavior    |                    |
|                   | 1B Wider Color Range   | 2F Seasonal Migration  |                    |
| MEDIUM IMPACT     | 1C Generation Markers  | 2D Terrain Transform   |                    |
|                   | 1D Adaptation Glow     | 2B Depletion Halos     |                    |
|                   | 2E Terrain Preference  |                        |                    |

---

## Recommended Implementation Order

### Phase 1: Immediate Wins (1-2 hours total)
1. **2A: Always-on food visualization** -- Guard removal + intensity tweak in renderer.ts
2. **1A: DNA-driven size** -- New radius formula in drawCreature
3. **1B: Wider color range** -- Modify dnaToColor to use more genes

**Expected result:** I can see the food! Creatures are different sizes! Colors diverge between groups!

### Phase 2: Dramatic Feel (2-4 hours total)
4. **1E: Birth/death particle effects** -- Event ring buffer + overlay render
5. **2C: Weather behavior changes** -- Amplify weather multipliers, storm speed reduction
6. **1C: Generation markers** -- Outline on high-gen creatures

**Expected result:** World feels alive. Births pulse, storms matter, old lineages distinct.

### Phase 3: Deep Ecosystem (3-5 hours total)
7. **2F: Seasonal migration** -- Geographic food gradient
8. **2D: Terrain transformation** -- Stronger wear, corpse staining
9. **2E: Terrain preference** -- Steeper food curves
10. **1D: Adaptation glow** -- Fitness brightness

**Expected result:** Real ecosystem. Migration, terrain history, niche adaptation all visible.

### Phase 4: Polish (optional)
11. **1F: Species color clustering** -- Stable species colors

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Visual clutter with too many effects | Add each with conservative intensity; tune down if noisy |
| Performance from particles | Cap at 50-100 active; ring buffer, no dynamic allocation |
| Color changes break view modes | Only modify normal mode; keep view mode switch logic |
| Size variation causes overlap | Cap max radius; high density naturally shrinks via energy |
| Food viz makes terrain muddy | Additive green only; 50% of substrate-view intensity |
| Migration breaks balance | Gentle gradient (25-30%); test with current constants |

---

## Success Criteria

The viewer should answer these by LOOKING, not reading stats:

1. Are creatures evolving? -- YES: colors and sizes change. Distinct species appear.
2. Where is the food? -- YES: terrain brightness shows food availability.
3. Does weather matter? -- YES: creatures slow, cluster, migrate, die during events.
4. Are there predators and prey? -- YES: small fast ones chase large slow ones. Death particles show kills.
5. Is the ecosystem healthy? -- YES: birth ripples, diverse colors, multiple zones populated.
6. What happened here? -- YES: worn paths, corpse stains, depleted zones tell spatial story.

---

## Unresolved Questions

1. **Particle canvas**: Should birth/death effects render on pixel canvas (overlay) or a third canvas? Third avoids clearing issues but adds DOM complexity.

2. **Color stability vs expression**: If color range widens, regulatory gene activation could cause color flicker. Should effective genes or raw DNA drive color? (Recommendation: raw DNA for stability.)

3. **Food visualization intensity**: How bright in normal view? Needs playtesting between informative and distracting.

4. **Terrain recovery from wear**: If grass darkens to dirt, should it recover? (Recommendation: slow recovery, ~500 ticks without traffic.)

5. **Migration at 200x150**: With 30,000 cells and max 2,400 creatures, is grid large enough for visible migration? May need testing.

6. **Corpse stain persistence**: How long should stains last? (Recommendation: 200-300 tick fade.)

