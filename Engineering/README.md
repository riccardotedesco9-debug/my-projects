# Engineering — Project Sandbox

Personal testing ground for project ideas. Each project lives in its own folder.

## Projects

### `danny-therapist/`
Danny DeVito AI therapist + pixel life game.
- `danny-therapist.py` — Claude + ElevenLabs voice chatbot, Danny DeVito persona
- `game/` — HTML5 canvas pixel top-down adventure game (5 scenes: Asbury Park → Paddy's Pub)
- `voice-samples/` — ElevenLabs voice training audio
- Status: functional, game complete end-to-end

### `cicero-dorito/`
Cicero from Skyrim roleplaying as a Dorito in a pasta universe while Godzilla attacks.
- `index.html` — Entry point, HTML5 Canvas 960x540
- `src/` — 12 vanilla JS modules (IIFE pattern, no dependencies)
- Features: Dorito-Cicero with jester hat, pasta city (ravioli buildings, spaghetti roads, marinara rivers), Godzilla boss that breathes marinara, pasta citizen NPCs (spaghetti men, ravioli women, farfalle kids, meatball elders), seasoning attacks, cheese dip power-ups, madness meter, insane Cicero quotes, procedural audio, screen shake, particle effects
- Win condition: season Godzilla until he turns into a giant Dorito
- Status: functional, complete

### `aristocrat-box/`
Corporate god simulator — pixel-art top-down sandbox.
- `index.html` — Entry point, HTML5 Canvas 960x540
- `src/` — 26 vanilla JS modules (IIFE pattern, no dependencies)
- Features: 6 biomes, 13 employee roles, A* pathfinding, 7-stage game dev pipeline, economy, morale, tech debt, 15 god powers, 8 random events, minimap, save/load, chiptune audio
- Status: functional, all 7 phases complete

## Structure Rules

- **Every new project gets its own folder** — no loose files at the root
- Folder name should be descriptive and kebab-case (e.g. `my-new-idea/`)
- Each project folder should have its own context (code, assets, notes) self-contained within it
- `plans/` and `docs/` at root are for cross-project planning and documentation

## Adding a New Project

1. Create a new folder: `Engineering/your-project-name/`
2. Start building inside it — keep everything contained there
3. Update this README with a short entry under Projects
