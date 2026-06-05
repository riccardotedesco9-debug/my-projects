# CLAUDE.md — Engineering Sandbox

Personal engineering domain — holds engineering **skills, agents, and workflow rules**, not project folders. This workspace lives under `agents/`; actual engineering projects live in the workspace-root `../../projects/` folder, each with its own `CLAUDE.md`.

## Mandatory Gates

Briefed dynamically — the canonical machine-read lists live in **`briefing.md`** (this folder). The
single **[ENFORCED]** gate (code-review before any push/deploy) is defined once in
`../../tools/brief-lib.mjs` (behavior: `../../tools/gate-deploy.mjs`; full prose: root `../../CLAUDE.md`)
and is injected into every domain's brief — it is the *only* hard rule. Engineering **[CONVENTION]**s:
`/test` before shipping, `/fix` for concrete bugs (not blind edits), `frontend-design` before UI code.

## Workflows

The canonical workflow rules live **globally** at `~/.claude/rules/` (this workspace has no local `.claude/rules/` — global is the single source):

- Primary workflow: `~/.claude/rules/primary-workflow.md`
- Development rules: `~/.claude/rules/development-rules.md`
- Orchestration protocols: `~/.claude/rules/orchestration-protocol.md`
- Documentation management: `~/.claude/rules/documentation-management.md`
- And the rest: `~/.claude/rules/*`

## Skills

All skills are **global** (`~/.claude/skills/`) — inherited automatically here, no local overrides. The skill/agent architecture (what's global, why, how progressive disclosure keeps it cheap) is documented once in root `../../CLAUDE.md` → "Skill Visibility"; don't restate it here. The engineering-specific skills (backend/frontend-development, databases, devops, web-frameworks, web-testing, ui-styling, threejs, shader, shopify, tanstack, react-best-practices, payment-integration, mcp-builder, mobile-development, better-auth …) live in that global library and are reachable from any `projects/` folder.

## Visual Asset Generation

To **generate** new images, sprites, textures, vector/SVG, video, or 3D assets → activate the global **`creative-router`** skill (fal.ai). It selects the model and states cost before running, saving output to `.tmp/creative/`. The `ai-multimodal` / `imagemagick` line in `development-rules.md` applies to *analyzing, describing, OCR-ing, or editing existing* media — not to generating new assets.

## Related projects

The projects this workspace's skills build live under `../../projects/`. Notably **`trigger-automations/`** — the deployed Trigger.dev platform (background tasks + scheduled jobs; runs the meetsync / job-hunt / billing tasks, project ref `proj_njxprjwjwpnxifasacvr`) — was moved out of this workspace to `../../projects/trigger-automations/` on 2026-06-03 and has its own builder `CLAUDE.md` there. Deploy still stages to `/c/tmp/trigger-deploy/` first (spaces in "My Projects" break the Docker build).

## Your Agents (spawn when relevant)

All agents are **global** (`~/.claude/agents/`) — spawnable from any project. The engineering-relevant ones:
- **Plan & build**: planner, researcher, fullstack-developer, frontend-developer, database-admin
- **Quality & ship**: code-reviewer (gate — see above), tester, debugger, code-simplifier
- **Support**: docs-manager, git-manager, mcp-manager, brainstormer, journal-writer

## Recommended Skills (auto-invoke when relevant)

- `/brainstorm` — before building anything with 3+ design options or architectural decisions
- `/fix` — when debugging errors or unexpected behavior
- `/scout` — when entering unfamiliar code or starting work in a new project folder
- `/debug` — for CI/CD failures, server errors, or test failures
- `/test` — after implementing features, before shipping
- `code-reviewer` agent — once before shipping, not after every change
- `/docs-seeker` — when using external libraries or frameworks you haven't used before

**Visual craft (WebDesign's trio, all global — reach for them, they complement engineering's frontend skills):**
- `frontend-design` — when building UI that must look non-generic or replicate a mockup/screenshot (pairs with `frontend-development`, which covers *how* to build React well — this covers *how it looks*)
- `ui-ux-pro-max` — for design-system decisions: color palettes, typography, spacing, layout
- `web-design-guidelines` — to audit existing UI for accessibility/UX before shipping
- For a full owner-editable site/storefront build, see the Web Studio recipe: `../WebDesign/.claude/rules/web-studio-recipe.md`

## Structure Rules

- **New projects go in the workspace-level `../../projects/` folder** — one self-contained folder each, never inside `Engineering/`. This workspace holds skills/agents/rules only.
- Folder name: descriptive, kebab-case (e.g. `../../projects/my-new-idea/`)
- Each project folder is self-contained (code, assets, notes) and gets its own `CLAUDE.md` noting `Domain: Engineering` so these engineering skills/agents are the obvious choice when working inside it
- The deployed `trigger-automations/` platform now lives at `../../projects/trigger-automations/` (moved out 2026-06-03) — it's a deployed project, not Claude tooling. All engineering projects live under `../../projects/`.

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
