# WebDesign — Briefing Source

Non-package-managed source for the dynamic domain briefing (read by `tools/brief-lib.mjs`, which
prefers this file over the workspace `CLAUDE.md`). Keeping the brief's lists here means a ClaudeKit
regen of any managed doc can't blank what WebDesign projects get briefed. Edit THIS file to change the
WebDesign brief.

Four `##` sections are parsed: **Mandatory Gates**, **Recommended Skills**, **MCP Tools**, **Your
Agents**. The single **[ENFORCED]** gate (code-review before push/deploy) is injected automatically
from `tools/brief-lib.mjs` for every domain — do NOT repeat it here; list only WebDesign's own
**[CONVENTION]** practices. Keep each bullet on ONE line; the parser keeps a bullet's first line and
dedupes by its first `backticked` / **bold** token.

## Mandatory Gates

- [CONVENTION] **`frontend-design` before writing ANY frontend code** — expected every session; not mechanically enforced (a hard hook on routine CSS edits is too brittle), but surfaced here whenever a WebDesign project file is touched.
- [CONVENTION] **`web-design-guidelines`** to audit UI accessibility/UX before shipping. (Web Studio builds: also run `/ck:security` + `security-scan` on the front-end before deploy — see `.claude/rules/web-studio-recipe.md`.)

## Recommended Skills

- `frontend-design` — the visual-craft pass before any UI build (avoid AI-slop, replicate mockups).
- `ui-ux-pro-max` — color systems, typography, spacing, layout, design-system decisions.
- `web-design-guidelines` — accessibility/UX audit before shipping.
- `chrome-devtools` — screenshot → compare-to-reference → fix loop.
- `ai-multimodal` — analyze reference images/screenshots in detail.
- `creative-router` — generate custom hero images, icons, illustrations, SVG (fal.ai).

## MCP Tools

- **Chrome DevTools** — screenshots, visual diff, Core Web Vitals.
- **fal.ai** (via `creative-router`) — custom raster/vector/video/3D assets when no template fits.
- **Canva** — templated brand graphics, resizes, multi-format export.
- **Gamma** — quick AI-generated one-pagers / decks.
- **Google Drive** — save completed designs, share with clients.

## Your Agents

All agents are global (`~/.claude/agents/`). Web-relevant: **ui-ux-designer**, **frontend-developer**,
**fullstack-developer** (build); **code-reviewer**, **tester** (gate/quality); **planner**,
**researcher**, **docs-manager** (support).
