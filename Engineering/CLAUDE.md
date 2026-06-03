# CLAUDE.md — Engineering Sandbox

Personal engineering domain — holds engineering **skills, agents, and workflow rules**, not project folders. Actual projects live one level up in the workspace-level `../projects/` folder, each with its own `CLAUDE.md`.

## Workflows

- Primary workflow: `./.claude/rules/primary-workflow.md`
- Development rules: `./.claude/rules/development-rules.md`
- Orchestration protocols: `./.claude/rules/orchestration-protocol.md`
- Documentation management: `./.claude/rules/documentation-management.md`
- And other workflows: `./.claude/rules/*`

## Local Skills (`./.claude/skills/`)

Engineering-specific (global skills inherited automatically):
backend-development, frontend-development, databases, devops, web-frameworks, web-testing, ui-styling, threejs, shader, shopify, tanstack, react-best-practices, payment-integration, mcp-builder, google-adk-python, mintlify, mobile-development, remotion, gkg, agent-browser, better-auth

## Visual Asset Generation

To **generate** new images, sprites, textures, vector/SVG, video, or 3D assets → activate the global **`creative-router`** skill (fal.ai). It selects the model and states cost before running, saving output to `.tmp/creative/`. The `ai-multimodal` / `imagemagick` line in `development-rules.md` applies to *analyzing, describing, OCR-ing, or editing existing* media — not to generating new assets.

## Projects

### `trigger-automations/`
Trigger.dev automation platform — TypeScript background tasks, scheduled jobs, AI agent orchestration.
- `src/trigger/` — Task files (each automation gets its own folder)
- `src/trigger/meetsync/` — MeetSync WhatsApp bot tasks (7 tasks: message-router, schedule-parser, session-orchestrator, match-compute, deliver-results + supporting modules)
- `trigger.config.ts` — Project config (project ref: `proj_njxprjwjwpnxifasacvr`)
- `trigger-ref.md` — SDK v4 API reference with code patterns
- MCP tools: `mcp__trigger__*` for deploy, trigger, monitor
- Deploy: copy to `/c/tmp/trigger-deploy/` first (spaces in "My Projects" break Docker build)
- Status: production — 7 tasks deployed, MeetSync bot live

## Recommended Skills (auto-invoke when relevant)

- `/brainstorm` — before building anything with 3+ design options or architectural decisions
- `/fix` — when debugging errors or unexpected behavior
- `/scout` — when entering unfamiliar code or starting work in a new project folder
- `/debug` — for CI/CD failures, server errors, or test failures
- `/test` — after implementing features, before shipping
- `code-reviewer` agent — once before shipping, not after every change
- `/docs-seeker` — when using external libraries or frameworks you haven't used before

## Structure Rules

- **New projects go in the workspace-level `../projects/` folder** — one self-contained folder each, never inside `Engineering/`. This workspace holds skills/agents/rules only.
- Folder name: descriptive, kebab-case (e.g. `../projects/my-new-idea/`)
- Each project folder is self-contained (code, assets, notes) and gets its own `CLAUDE.md` noting `Domain: Engineering` so these engineering skills/agents are the obvious choice when working inside it
- Nested `trigger-automations/` is **deploy-coupled automation infra** (hosts the live Trigger.dev tasks for meetsync / job-hunt / billing) — it stays in `Engineering/`, not a project to migrate. (`pixel-life/` already moved to `../projects/pixel-life/`.)

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
