# Marketing — Briefing Source

Non-package-managed source for the dynamic domain briefing (read by `tools/brief-lib.mjs`, which
prefers this file over the workspace `CLAUDE.md`). It exists because `agents/Marketing/CLAUDE.md` is
listed in `agents/Marketing/release-manifest.json` and a ClaudeKit update can reset it — keeping the
gate/agent lists here means the brief survives that. Edit THIS file to change what Marketing projects
get briefed; the managed `CLAUDE.md` is kit-owned, don't rely on hand-edits to it.

Only the two `##` sections below are parsed (Mandatory Gates, Your Agents). The single **[ENFORCED]**
gate (code-review before push/deploy) is injected automatically from `tools/brief-lib.mjs` for every
domain — do NOT repeat it here. List only Marketing's own **[CONVENTION]** practices, so nothing
overstates what's actually guaranteed.

Keep each gate bullet on ONE line — the brief parser only keeps a bullet's first line, and dedupes by
the first `backticked` skill token (so don't backtick the [CONVENTION] label).

## Mandatory Gates

- [CONVENTION] **`content-reviewer` before publishing** any content piece (copy, blog, campaign, email).
- [CONVENTION] **`frontend-design` before building/editing any web-page UI** (see the WebDesign toolkit; for a full owner-editable site/storefront use the Web Studio recipe at `../WebDesign/.claude/rules/web-studio-recipe.md`).

## Your Agents

All agents are global (`~/.claude/agents/`) — any project can spawn any of them. Marketing-relevant:
**Content** content-creator, copywriter, content-reviewer · **Campaigns** campaign-manager,
campaign-debugger, email-wizard · **SEO & Growth** seo-specialist, attraction-specialist,
funnel-architect · **Social** social-media-manager, community-manager · **Analytics**
analytics-analyst, lead-qualifier · **Sales** sale-enabler, upsell-maximizer, continuity-specialist ·
**Shared** planner, project-manager, researcher, docs-manager, code-reviewer, tester, git-manager,
brainstormer.
