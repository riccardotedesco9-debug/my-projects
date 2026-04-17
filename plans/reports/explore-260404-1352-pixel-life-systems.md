# Pixel-Life Simulation: Systems & Extension Points

**Date**: 2026-04-04
**Scope**: Analysis for spatial memory, pack behavior, territorial systems

---

## OVERVIEW

Pixel-life is a 2D cellular simulation where organisms with genomes compete, evolve, and form emergent behaviors.

---

## 1. PIXEL STATE SYSTEM

Internal State (3 registers, Uint8Array[3]):
- state[0] = Threat — decays 1/tick, boosted (+50) when attacked
- state[1] = Satiety — decays 2/tick, boosted when eating
- state[2] = Social — decays 1/tick, boosted when near kin

**What Exists:**
- Registers decay each tick, update on events
- Can trigger gene switches via regulatory genes (indices 16-18)
- Movement.ts uses threat/satiety for behavior overrides (lines 25-26)

**Missing:**
- No spatial memory (scalar registers, reset each tick)
- No pack/territory markers
- No multi-tick persistence

**Extension Hooks:**
- Add Pixel.memory: Map for spatial storage
- Add Pixel.territories: number[] for claimed areas

---

## 2. MOVEMENT DECISION-MAKING (movement.ts)

Per tick: Speed roll → Sense setup → State overrides → Target selection

Sense targets (SENSE_TARGET gene):
- <60: seekFood() — check 8 adjacent + 8 distant cells
- 60-85: seekPheromone() — 8 adjacent only
- 85-170: seekPixel() approach
- >=170: seekPixel() flee

**What Exists:**
- 8-direction discrete movement
- Lookahead sensing with range parameter
- State-driven behavior switching (threat→flee, hunger→hunt)
- Pheromone awareness, terrain impact on speed/cost

**Missing:**
- No path memory (greedy seeking only)
- No colony marking (pheromone unmarked)
- No territory defense
- No multi-step planning

**Extension Hooks:**
- Extend seekPixel() to filter by packId
- Add world.territory: Map<cellIdx, ownerId>
- Add world.pheromone.species: Map<cellIdx, speciesId>

---

## 3. REGULATION SYSTEM (regulation.ts)

16 core genes + 0-16 regulatory genes per individual.

Each reg gene: conditionIdx (0-15 core, 16-18 state), threshold (0-255), targetIdx

**What Exists:**
- Boolean logic (if X > threshold, modify Y by ±20