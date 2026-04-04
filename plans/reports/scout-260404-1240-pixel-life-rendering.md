# Scout Report: Pixel-Life Rendering System

**Date:** 2026-04-04
**Project:** OOZE Pixel-Life Simulator

## Summary

OOZE uses dual HTML5 Canvas 2D layers:
- Substrate canvas: terrain, food, trails
- Pixel canvas: 7 creature types

Grid: 200×150 tiles at 5px scale = 1000×750px
No sprite assets—all procedural rendering.

## Rendering Pipeline

renderFrame() called per tick:
1. Every 4 frames: renderTerrain() → ImageData
2. renderPixels() → per-creature glyphs
3. renderEffects() → birth rings, death particles
4. renderWeather() → overlays, particles
5. renderCanvasHud() → UI badges, stats

## Creature Types (7 roles)

0. Plant (green circle)
1. Hunter (orange triangle)
2. Apex (red diamond)
3. Scavenger (brown cross)
4. Parasite (magenta star)
5. Swarm (cyan hexagon)
6. Nomad (yellow arrow)

## Colors

DNA → HSL → RGB conversion:
- Hue: role-based anchor ± genetic variation (40° range)
- Saturation: armor + adhesion genes
- Luminance: energy level (0.25-0.7)

Result: Role colors with lineage diversity.

## Size

baseRadius = 1.2 + bodyMass * 2.8
radius = baseRadius * (0.4 + energy/100 * 0.6)
Range: 1.2–4.0 canvas units

## Markers

- Newborn glow: +120 RGB
- Starvation dim: ×0.4 brightness
- Generation ring: outline at gen 10+
- Trait pip: colored square showing dominant gene
- Feeding pulse: green circle under plant
- Hunting glow: red circle on predator

## Grid

200×150 cells, 5px per cell
Toroidal wrapping (edges wrap)

## Terrain

6 types: water, sand, dirt, grass, forest, rock
Base colors + food overlay + wear patterns

## Movement

Sense modes:
1. Food (0-5 cell range)
2. Pheromone trails
3. Approach creatures
4. Flee predators

Cost: 0.02 × terrain × worn bonus × weather

## 16-Gene Genome

[0-2] HARVEST_R/G/B
[3] SPEED
[4] SENSE_RANGE (0-5 cells)
[5] SENSE_TARGET (what to seek)
[6] REACT_TYPE (determines role)
[7] REACT_THRESHOLD
[8-10] WASTE_R/G/B
[11] REPRO_THRESHOLD
[12] REPRO_SHARE
[13] MUTATION_RATE
[14] ARMOR (scales size)
[15] ADHESION (clustering)

+ regulatory genes (conditional modifiers)

## Performance

- Terrain cached every 4 frames
- ImageData bulk writes
- O(1) pixel lookup via Map
- Fixed-size effect buffers
- Selective rendering

## Files

renderer.ts (327): main pipeline
canvas-hud.ts (219): season, population, trends
color-map.ts (69): DNA→RGB
effects.ts (89): birth/death particles
movement.ts (124): sensing, movement
