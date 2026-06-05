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

- **Start any UI with `frontend-design`** — the visual-craft pass that keeps output from looking generic — then reach for `ui-ux-pro-max` to lock color/type/layout/design-system decisions. Audit with `web-design-guidelines` (a11y/UX) before you ship; `ui-styling` for shadcn/Tailwind.
- Build: `frontend-development` · `web-frameworks` · `shopify` (storefronts) · `threejs` / `shader` (3D/WebGL & canvas effects) · `remotion` (programmatic video) · `show-off` (self-contained HTML showcase / demo pages).
- **Generate, don't placeholder:** `creative-router` makes custom art/sprites via fal.ai (beats emoji); `ai-multimodal` analyzes reference images; `banner-design` for banners.
- Prove it in a real browser: `chrome-devtools` (screenshot→compare→fix loop) · ship with `deploy` · `security-scan` (Web Studio builds).
- Full "which skill for which job" map: `~/.claude/rules/skill-domain-routing.md`.

## MCP Tools

- Experience layer (sound / custom art / video): reach for the managed tool first — **ElevenLabs** for sound, **creative-router** for art — hand-rolled code (oscillators, emoji-as-art) is the fallback, not the default.
- **ElevenLabs** — real SFX & music for interactive / game UI (`text_to_sound_effects`, `compose_music`); the sound tool, not Web Audio oscillators.
- **fal.ai** (via `creative-router`) — generate custom raster/vector/video/3D assets instead of placeholders when no template fits.
- **Chrome DevTools** — screenshots, visual diff, Core Web Vitals.
- **Canva** — templated brand graphics, resizes, multi-format export.
- **Gamma** — quick AI-generated one-pagers / decks.
- **Google Drive** — save completed designs, share with clients.

## Your Agents

All agents are global (`~/.claude/agents/`) — spawn them, don't go solo on a big build. Hand the build to
**ui-ux-designer** / **frontend-developer** / **fullstack-developer**; route quality through
**code-reviewer** (the gate) + **tester**; lean on **planner** / **researcher** / **docs-manager** for support.
