---
title: "Pixel-Life Visual Overhaul"
description: "Camera system + procedural 16x16 pixel-art sprites + terrain tiles for recognizable creatures"
status: pending
priority: P1
effort: 16h
branch: main
tags: [feature, frontend, rendering, pixel-art]
created: 2026-04-04
---

# Pixel-Life Visual Overhaul

## Overview

Transform pixel-life from abstract colored glyphs into a visually rich tile-based ecosystem. Creatures become recognizable animals (wolves, lions, bees, etc.) via procedural 16x16 pixel-art sprites. Camera system enables zooming from macro (full world) to micro (individual sprites). Terrain tiles match sprite art style for visual cohesion.

## Key Decisions

- **Camera:** `ctx.setTransform()` zoom/pan, 3 LOD tiers
- **Sprites:** 21 creatures (7 roles × 3 variants), 4 dirs × 2 walk frames = 168 frames, procedural generation
- **Terrain:** 6 terrain types as 16x16 tiles with overlay system
- **Resolution:** 16×16 pixels per sprite/tile
- **Controls:** Mouse wheel zoom, click-drag pan, minimap

## Phases

| # | Phase | Status | Effort | Link |
|---|-------|--------|--------|------|
| 1 | Camera + LOD Foundation | Pending | 3h | [phase-01](./phase-01-camera-and-lod.md) |
| 2 | Terrain Tiles | Pending | 3h | [phase-02-terrain-tiles.md](./phase-02-terrain-tiles.md) |
| 3 | Creature Sprites — Base Set | Pending | 4h | [phase-03](./phase-03-creature-sprites-base.md) |
| 4 | Full Variants + Polish | Pending | 4h | [phase-04](./phase-04-full-variants-and-polish.md) |
| 5 | Minimap + UX | Pending | 2h | [phase-05](./phase-05-minimap-and-ux.md) |

## Dependencies

- Phase 1 (camera) blocks all other phases
- Phase 2 (terrain) and Phase 3 (sprites) can run in parallel after Phase 1
- Phase 4 depends on Phase 3
- Phase 5 depends on Phase 1

## Validation Summary

**Validated:** 2026-04-04
**Questions asked:** 4

### Confirmed Decisions
- **Zoom pipeline:** drawImage copy for all LODs — render ImageData to substrate canvas, then `drawImage()` to screen with camera transform. ~1ms overhead acceptable for consistent pipeline.
- **Sprite caching:** Pre-generate all palette variants at init (not lazy). Accept 200-500ms startup delay for zero stutter during gameplay.
- **Terrain rendering:** Per-cell `drawImage()` at LOD 2 (~800 calls at max zoom). Simple, fast enough.
- **Sprite/terrain layering:** Terrain always renders under sprites. Sprites have transparent backgrounds — terrain visible through gaps. Creatures cover most of their cell but NOT entirely (natural pixel-art feel, terrain peeks through).

### Action Items
- [ ] Update Phase 3 sprite cache strategy: pre-generate at init, not lazy
- [ ] Ensure all sprite templates have transparent pixels around edges (not full 16×16 fill)

## Context

- [Brainstorm Report](../reports/brainstormer-260404-1239-pixel-life-visual-overhaul.md)
- Project: `Engineering/pixel-life/`
