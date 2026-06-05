# CLAUDE.md — OOZE: Pixel Alchemy Evolution Simulator

Domain: Engineering — lives in `projects/` (uses global + Engineering skills/agents).
> Toolkit + mandatory gates: [agents/Engineering/CLAUDE.md](../../agents/Engineering/CLAUDE.md) — your agents, skills, and the code-reviewer-before-deploy/push gate.

Browser-based autonomous artificial life simulation. Pixels carry 16-gene DNA controlling chemical reactions (not physics forces). Evolution is fully self-sustaining — watch or play god.

## Quick Start
```bash
npm install
npm run dev    # opens http://localhost:5173
```

## Architecture
- **Stack**: Vite + TypeScript (strict) + HTML5 Canvas 2D
- **Modules**: 21 source files in `src/`, each under 200 lines
- **Rendering**: Dual-canvas (substrate background + pixel foreground), ImageData direct writes
- **Performance**: Float32Array substrate, Map<number, Pixel> O(1) lookup, Fisher-Yates shuffle

## Key Systems
| File | System |
|---|---|
| `simulation.ts` | Tick orchestrator — calls all systems in order |
| `substrate.ts` | RGB chemical field: emission, diffusion, decay |
| `metabolism.ts` | Harvest substrate, pay upkeep, death/nutrient cycling |
| `movement.ts` | Sensing (substrate gradient, pixel detection), movement |
| `reactions.ts` | 4 collision types: absorb, share, catalyze, repel |
| `reproduction.ts` | Asexual reproduction with mutation |
| `sexual-reproduction.ts` | Crossover between compatible genomes |
| `regulation.ts` | Variable-length regulatory genes (conditional behavior) |
| `pixel-state.ts` | Internal memory: threat, satiety, social registers |
| `seasons.ts` | Spring/summer/autumn/winter environmental cycles |
| `adhesion.ts` | Tribal clustering, cooperation bonus |

## Tuning
All numeric constants are in `constants.ts`. Key levers:
- `HARVEST_RATE` / `BASE_UPKEEP` — energy balance (too high harvest = overpop, too high upkeep = extinction)
- `substrateEmission` / `substrateDecay` — world energy availability
- `mutationIntensity` — speed of evolution (higher = faster speciation, but more lethal mutations)
- `REPRO_MIN_ENERGY` — how early pixels can reproduce

## Audio
Audio files go in `public/audio/`. The audio module (`audio.ts`) loads them on first click and gracefully degrades if missing. Generate assets with ElevenLabs MCP when available.

## Visual Assets
Generate pixel sprites, tile textures, and UI art with the global **`creative-router`** skill (fal.ai). For the pixel aesthetic use `fal-ai/flux-lora` with a FLUX pixel LoRA (e.g. `ume_modern_pixelart.safetensors`, trigger `umempart`). The skill states cost before running and saves output to `.tmp/creative/`.

## Control-panel UI
The sim's HUD/controls are a real web UI — for layout, color, typography, and interaction polish reach for the global WebDesign skills `ui-ux-pro-max` (design-system decisions) and `frontend-design` (non-generic, polished build); run `web-design-guidelines` to audit a11y/UX. (Engineering domain, but these complement it — see `../../agents/Engineering/CLAUDE.md` → Recommended Skills.)
