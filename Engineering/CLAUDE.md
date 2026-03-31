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

### `trigger-automations/`
Trigger.dev automation platform — TypeScript background tasks, scheduled jobs, AI agent orchestration.
- `src/trigger/` — Task files (each automation gets its own folder)
- `trigger.config.ts` — Project config (project ref from cloud.trigger.dev)
- `trigger-ref.md` — SDK v4 API reference with code patterns
- MCP tools: `mcp__trigger__*` for deploy, trigger, monitor
- Status: scaffolded, awaiting cloud.trigger.dev account setup

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
