# CLAUDE.md — Engineering Sandbox

Personal engineering domain — holds engineering **skills, agents, and workflow rules**, not project folders. This workspace lives under `agents/`; actual engineering projects live in the workspace-root `../../projects/` folder, each with its own `CLAUDE.md`.

## Workflows

- Primary workflow: `./.claude/rules/primary-workflow.md`
- Development rules: `./.claude/rules/development-rules.md`
- Orchestration protocols: `./.claude/rules/orchestration-protocol.md`
- Documentation management: `./.claude/rules/documentation-management.md`
- And other workflows: `./.claude/rules/*`

## Skills

All skills are **global** (`~/.claude/skills/`, ~135 total) — inherited automatically here, no local overrides. The engineering-specific ones (backend-development, frontend-development, databases, devops, web-frameworks, web-testing, ui-styling, threejs, shader, shopify, tanstack, react-best-practices, payment-integration, mcp-builder, google-adk-python, mintlify, mobile-development, remotion, gkg, agent-browser, better-auth) live in the global library alongside everything else, so they're equally reachable from any `projects/` folder. The local `./.claude/skills/` dir holds no skill overrides (engineering's local kit was removed 2026-06-04).

## Visual Asset Generation

To **generate** new images, sprites, textures, vector/SVG, video, or 3D assets → activate the global **`creative-router`** skill (fal.ai). It selects the model and states cost before running, saving output to `.tmp/creative/`. The `ai-multimodal` / `imagemagick` line in `development-rules.md` applies to *analyzing, describing, OCR-ing, or editing existing* media — not to generating new assets.

## Related projects

The projects this workspace's skills build live under `../../projects/`. Notably **`trigger-automations/`** — the deployed Trigger.dev platform (background tasks + scheduled jobs; runs the meetsync / job-hunt / billing tasks, project ref `proj_njxprjwjwpnxifasacvr`) — was moved out of this workspace to `../../projects/trigger-automations/` on 2026-06-03 and has its own builder `CLAUDE.md` there. Deploy still stages to `/c/tmp/trigger-deploy/` first (spaces in "My Projects" break the Docker build).

## Recommended Skills (auto-invoke when relevant)

- `/brainstorm` — before building anything with 3+ design options or architectural decisions
- `/fix` — when debugging errors or unexpected behavior
- `/scout` — when entering unfamiliar code or starting work in a new project folder
- `/debug` — for CI/CD failures, server errors, or test failures
- `/test` — after implementing features, before shipping
- `code-reviewer` agent — once before shipping, not after every change
- `/docs-seeker` — when using external libraries or frameworks you haven't used before

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
