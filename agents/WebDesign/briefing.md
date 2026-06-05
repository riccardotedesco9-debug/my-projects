# WebDesign — Briefing Source

Non-package-managed source for the dynamic domain briefing (read by `tools/brief-lib.mjs`, which
prefers this file over the workspace `CLAUDE.md`). Keeping the brief's gate/agent lists here means a
ClaudeKit regen of any managed doc can't blank what WebDesign projects get briefed. Edit THIS file to
change the WebDesign brief.

Only the two `##` sections below are parsed (Mandatory Gates, Your Agents). The single **[ENFORCED]**
gate (code-review before push/deploy) is injected automatically from `tools/brief-lib.mjs` for every
domain — do NOT repeat it here. List only WebDesign's own **[CONVENTION]** practices. Keep each gate
bullet on ONE line; the parser keeps a bullet's first line and dedupes by its first `backticked` token.

## Mandatory Gates

- [CONVENTION] **`frontend-design` before writing ANY frontend code** — expected every session; not mechanically enforced (a hard hook on routine CSS edits is too brittle), but surfaced here whenever a WebDesign project file is touched.
- [CONVENTION] **`web-design-guidelines`** to audit UI accessibility/UX before shipping. (Web Studio builds: also run `/ck:security` + `security-scan` on the front-end before deploy — see `.claude/rules/web-studio-recipe.md`.)

## Your Agents

All agents are global (`~/.claude/agents/`). Web-relevant: **ui-ux-designer**, **frontend-developer**,
**fullstack-developer** (build); **code-reviewer**, **tester** (gate/quality); **planner**,
**researcher**, **docs-manager** (support).
