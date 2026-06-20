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

- **The moment there's a UI, reach for `frontend-design` + `ui-ux-pro-max`** — they're what keep a frontend from looking generic; don't hand-roll the visual layer.
- Build: `backend-development` · `frontend-development` · `databases` · `web-frameworks` · `better-auth` · `payment-integration` (stack-specific: `tanstack`, `shopify`, `mobile-development`, `react-best-practices`).
- Ship & ops: `deploy` · `devops` · `security-scan` / `ck-security`.
- Work & quality: open unfamiliar code with `/scout`, weigh options with `/brainstorm`, root-cause with `/ck:debug`, verify with `/test`, fix concretely with `/fix`; pull current library docs via `docs-seeker` instead of guessing.
- Full "which skill for which job" map: `~/.claude/rules/skill-domain-routing.md`.

## MCP Tools

- **Context7** — up-to-date library/framework documentation lookup.
- **Chrome DevTools** — live UI debugging, performance, scripted browser flows.
- **Cloudflare** — D1 queries, Workers, KV/R2 (meetsync infra).
- **Trigger.dev** — background jobs & scheduled tasks (build in `projects/trigger-automations/`).
- **Sequential Thinking** — structured multi-step reasoning when a problem is gnarly.
- Need custom art / video / music / voice? That's the **WebDesign / Marketing** domains — `creative-router` (fal) for visuals + music, **ElevenLabs** for voice/SFX; add that `Domain:` to the project too rather than pulling the tools in here.

## Your Agents

All agents are global (`~/.claude/agents/`) — spawn them, don't carry a big build solo. Hand planning &
construction to **planner** / **researcher** / **fullstack-developer** / **frontend-developer** /
**database-admin**; route quality & shipping through **code-reviewer** (the gate) / **tester** /
**debugger** / **code-simplifier**; lean on **docs-manager** / **git-manager** / **mcp-manager** /
**brainstormer** / **journal-writer** for support.
