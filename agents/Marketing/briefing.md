# Marketing — Briefing Source

Non-package-managed source for the dynamic domain briefing (read by `tools/brief-lib.mjs`, which
prefers this file over the workspace `CLAUDE.md`). It exists because `agents/Marketing/CLAUDE.md` is
listed in `agents/Marketing/release-manifest.json` and a ClaudeKit update can reset it — keeping the
lists here means the brief survives that. Edit THIS file to change what Marketing projects get briefed;
the managed `CLAUDE.md` is kit-owned.

Four `##` sections are parsed: **Mandatory Gates**, **Recommended Skills**, **MCP Tools**, **Your
Agents**. The single **[ENFORCED]** gate (code-review before push/deploy) is injected automatically
from `tools/brief-lib.mjs` for every domain — do NOT repeat it here; list only Marketing's own
**[CONVENTION]** practices. Keep each bullet on ONE line; the parser keeps a bullet's first line and
dedupes by its first `backticked` / **bold** token (don't backtick the [CONVENTION] label).

## Mandatory Gates

- [CONVENTION] **`content-reviewer` before publishing** any content piece (copy, blog, campaign, email).
- [CONVENTION] **`frontend-design` before building/editing any web-page UI** (see the WebDesign toolkit; for a full owner-editable site/storefront use the Web Studio recipe at `../WebDesign/.claude/rules/web-studio-recipe.md`).

## Recommended Skills

- `/research` — market trends, competitor analysis, audience insight (before planning).
- `/brainstorm` — campaign & content strategy with multiple angles.
- `copywriting` — conversion copy, headlines, landing pages, email.
- `campaign` / `email` / `social` — channel-specific production.
- `/seo` — search optimization for any web content.
- `/analytics` — campaign performance & reporting.

## MCP Tools

- **Canva** — templated brand graphics, social, resizes.
- **Gamma** — quick AI-generated decks, docs, one-pager landing pages.
- **fal.ai** (via `creative-router`) — custom ad creative, illustrations, video clips.
- **ElevenLabs** — voiceover, music, sound effects.
- **Gmail** / **Slack** — outreach, follow-ups, team comms.
- **Google Drive** — content calendars, shared reports.

## Your Agents

All agents are global (`~/.claude/agents/`) — any project can spawn any of them. Marketing-relevant:
**Content** content-creator, copywriter, content-reviewer · **Campaigns** campaign-manager,
campaign-debugger, email-wizard · **SEO & Growth** seo-specialist, attraction-specialist,
funnel-architect · **Social** social-media-manager, community-manager · **Analytics**
analytics-analyst, lead-qualifier · **Sales** sale-enabler, upsell-maximizer, continuity-specialist ·
**Shared** planner, project-manager, researcher, docs-manager, code-reviewer, tester, git-manager,
brainstormer.
