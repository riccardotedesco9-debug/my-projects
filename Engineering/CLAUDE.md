# CLAUDE.md — Engineering Sandbox

Personal testing ground for project ideas. Each project lives in its own folder.

## Workflows

- Primary workflow: `./.claude/rules/primary-workflow.md`
- Development rules: `./.claude/rules/development-rules.md`
- Orchestration protocols: `./.claude/rules/orchestration-protocol.md`
- Documentation management: `./.claude/rules/documentation-management.md`
- And other workflows: `./.claude/rules/*`

## Local Skills (`./.claude/skills/`)

Engineering-specific (global skills inherited automatically):
backend-development, frontend-development, databases, devops, web-frameworks, web-testing, ui-styling, threejs, shader, shopify, tanstack, react-best-practices, payment-integration, mcp-builder, google-adk-python, mintlify, mobile-development, remotion, gkg, agent-browser, better-auth

## Projects

### `cicero-dorito/`
Cicero from Skyrim roleplaying as a Dorito in a pasta universe while Godzilla attacks.
- `index.html` — Entry point, HTML5 Canvas 960x540
- `src/` — 12 vanilla JS modules (IIFE pattern, no dependencies)
- Features: Dorito-Cicero with jester hat, pasta city, Godzilla boss, pasta NPCs, seasoning attacks, cheese dip power-ups, madness meter, procedural audio
- Status: functional, complete

### `aristocrat-box/`
Corporate god simulator — pixel-art top-down sandbox.
- `index.html` — Entry point, HTML5 Canvas 960x540
- `src/` — 26 vanilla JS modules (IIFE pattern, no dependencies)
- Features: 6 biomes, 13 employee roles, A* pathfinding, 7-stage game dev pipeline, economy, morale, tech debt, 15 god powers, 8 random events, minimap, save/load, chiptune audio
- Status: functional, all 7 phases complete

## Structure Rules

- **Every new project gets its own folder** — no loose files at the root
- Folder name: descriptive, kebab-case (e.g. `my-new-idea/`)
- Each project folder is self-contained (code, assets, notes)

## Documentation

Keep docs in `./docs`:

```
./docs
├── project-overview-pdr.md
├── code-standards.md
├── codebase-summary.md
├── design-guidelines.md
├── deployment-guide.md
├── system-architecture.md
└── project-roadmap.md
```
