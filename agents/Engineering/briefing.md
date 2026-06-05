# Engineering — Briefing Source

Non-package-managed source for the dynamic domain briefing (read by `tools/brief-lib.mjs`, which
prefers this file over the workspace `CLAUDE.md`). Keeping the brief's lists here means a ClaudeKit
regen of any managed doc can't blank what Engineering projects get briefed. Edit THIS file to change
the Engineering brief.

Four `##` sections are parsed: **Mandatory Gates**, **Recommended Skills**, **MCP Tools**, **Your
Agents**. The single **[ENFORCED]** gate (code-review before push/deploy) is injected automatically
from `tools/brief-lib.mjs` for every domain — do NOT repeat it here; list only Engineering's own
**[CONVENTION]** practices. Keep each bullet on ONE line; the parser keeps a bullet's first line and
dedupes by its first `backticked` / **bold** token.

## Mandatory Gates

- [CONVENTION] **`/test` before shipping** a feature — verify behavior, don't assume.
- [CONVENTION] **`/fix`** for concrete bugs / CI failures (root-cause, not blind edits).
- [CONVENTION] **`frontend-design`** before frontend/UI code (pulls in WebDesign's craft; surfaced automatically when a project is also WebDesign).

## Recommended Skills

- `/scout` — orient in unfamiliar code before changing it.
- `/brainstorm` — before any 3+-option design or architecture decision.
- `/debug` — prove the root cause before a fix (CI failures, server errors, flaky tests).
- `/test` — validate behavior and coverage before shipping.
- `docs-seeker` — pull current docs for a library/framework you haven't used recently.
- `frontend-design` — visual-craft pass when the work has a UI surface.
- `ui-ux-pro-max` — design-system decisions: color, typography, spacing, layout.

## MCP Tools

- **Context7** — up-to-date library/framework documentation lookup.
- **Chrome DevTools** — live UI debugging, performance, scripted browser flows.
- **Cloudflare** — D1 queries, Workers, KV/R2 (meetsync infra).
- **Trigger.dev** — background jobs & scheduled tasks (build in `projects/trigger-automations/`).
- **Sequential Thinking** — structured multi-step reasoning when a problem is gnarly.

## Your Agents

All agents are global (`~/.claude/agents/`) — any project can spawn any of them. Engineering-relevant:
**Plan & build** planner, researcher, fullstack-developer, frontend-developer, database-admin ·
**Quality & ship** code-reviewer (the gate), tester, debugger, code-simplifier · **Support**
docs-manager, git-manager, mcp-manager, brainstormer, journal-writer.
