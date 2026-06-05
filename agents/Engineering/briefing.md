# Engineering — Briefing Source

Non-package-managed source for the dynamic domain briefing (read by `tools/brief-lib.mjs`, which
prefers this file over the workspace `CLAUDE.md`). Keeping the brief's gate/agent lists here means a
ClaudeKit regen of any managed doc can't blank what Engineering projects get briefed. Edit THIS file
to change the Engineering brief.

Only the two `##` sections below are parsed (Mandatory Gates, Your Agents). The single **[ENFORCED]**
gate (code-review before push/deploy) is injected automatically from `tools/brief-lib.mjs` for every
domain — do NOT repeat it here. List only Engineering's own **[CONVENTION]** practices. Keep each gate
bullet on ONE line; the parser keeps a bullet's first line and dedupes by its first `backticked` token.

## Mandatory Gates

- [CONVENTION] **`/test` before shipping** a feature — verify behavior, don't assume.
- [CONVENTION] **`/fix`** for concrete bugs / CI failures (root-cause, not blind edits).
- [CONVENTION] **`frontend-design`** before frontend/UI code (pulls in WebDesign's craft; surfaced automatically when a project is also WebDesign).

## Your Agents

All agents are global (`~/.claude/agents/`) — any project can spawn any of them. Engineering-relevant:
**Plan & build** planner, researcher, fullstack-developer, frontend-developer, database-admin ·
**Quality & ship** code-reviewer (the gate), tester, debugger, code-simplifier · **Support**
docs-manager, git-manager, mcp-manager, brainstormer, journal-writer.
