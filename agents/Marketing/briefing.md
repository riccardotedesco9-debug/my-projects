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

- Strategy & research: `marketing-planning` · `marketing-research` · `marketing-psychology` · `marketing-ideas` · `/brainstorm`.
- Content & copy: `copywriting` · `content-marketing` (blog/editorial); review with the `content-reviewer` agent before publishing.
- SEO: `seo` · `competitor-alternatives`.
- Channels: `email` · `social` · `paid-ads` · `campaign`.
- Funnel & CRO: `funnel` · `form-cro` · `onboarding-cro` · `pricing-strategy` · `ab-test-setup` · `launch-strategy` · `referral-program-building` · `affiliate-marketing`.
- Brand & visual: `brand-guidelines` · `logo-design` · `cip-design` · `banner-design` · `slides-design` · `creative-router` · `media-processing` (ffmpeg — edit/effect owner-supplied real footage: cut, grade, captions, 24→60fps smoothing; preferred over AI video for client work).
- Analytics: `analytics`. Full map: `~/.claude/rules/skill-domain-routing.md` (+ the local `mkt:*` commands).

## MCP Tools

- **Canva** — templated brand graphics, social, resizes.
- **Gamma** — quick AI-generated decks, docs, one-pager landing pages.
- **fal.ai** (via `creative-router`) — custom ad creative, illustrations, AI video (use NATIVE audio, not ElevenLabs on top), video editing on real footage (object removal, restyle, upscale), AND **music** (license-clean `stable-audio-3`, vocals `minimax-music`/`lyria3`, video-to-music `sonilo`); creative-router live-picks the best current model.
- **ElevenLabs** — standalone **voiceover + SFX** (music now → fal/`creative-router`); NOT for AI-video sound (use the renderer's native audio, else it desyncs/tacky).
- **Gmail** / **Slack** — outreach, follow-ups, team comms.
- **Google Drive** — content calendars, shared reports.

## Your Agents

All agents are global (`~/.claude/agents/`) — spawn the specialist, don't generalize the work. Hand
content to **content-creator** / **copywriter** / **content-reviewer**; campaigns to **campaign-manager**
/ **campaign-debugger** / **email-wizard**; growth to **seo-specialist** / **attraction-specialist** /
**funnel-architect**; social to **social-media-manager** / **community-manager**; analytics to
**analytics-analyst** / **lead-qualifier**; sales to **sale-enabler** / **upsell-maximizer** /
**continuity-specialist**; and **planner** / **project-manager** / **researcher** / **docs-manager** /
**code-reviewer** / **tester** / **git-manager** / **brainstormer** for shared support.
