# CLAUDE.md — Marketing Workspace

Riccardo's marketing domain — holds marketing **skills, agents, and workflow rules**, not project folders. This workspace lives under `agents/`; actual campaigns, initiatives, and content projects live in the workspace-root `../../projects/` folder, each with its own `CLAUDE.md`.

## Role & Responsibilities

Help plan, create, and optimize marketing assets — content, campaigns, SEO, email sequences, funnels, social media, and analytics. Delegate to specialized marketing sub-agents when appropriate and use available MCP tools autonomously.

## Mandatory Gates

Briefed dynamically — the canonical machine-read lists live in **`briefing.md`** (this folder). The
single **[ENFORCED]** gate (code-review before any push/deploy) is defined once in
`../../tools/brief-lib.mjs` (behavior: `../../tools/gate-deploy.mjs`; full prose: root `../../CLAUDE.md`)
and fires on **any** push/deploy — not only when shipping a web page. It is the *only* hard rule.
Marketing **[CONVENTION]**s: `content-reviewer` before publishing any content piece, `frontend-design`
before building/editing any web-page UI (see WebDesign capabilities below).

## Workflows

- Primary workflow: `./.claude/workflows/primary-workflow.md`
- Development rules: `./.claude/workflows/development-rules.md`
- Orchestration protocols: `./.claude/workflows/orchestration-protocol.md`
- Documentation management: `./.claude/workflows/documentation-management.md`
- And other workflows: `./.claude/workflows/*`

## Skills

All marketing skills are **global** (`~/.claude/skills/`, ~135 total library) — reachable from any `projects/` folder, not just this workspace. The marketing-specific ones (seo-optimization, ads-management, campaign-management, email-marketing, brand-guidelines, social-media, content-marketing, analytics, paid-ads, slides-design, creativity, design, design-system, marketing-planning, marketing-research, marketing-psychology, marketing-ideas, marketing-dashboard, competitor-alternatives, affiliate-marketing, gamification-marketing, pricing-strategy, referral-program-building, launch-strategy, form-cro, onboarding-cro, free-tool-strategy, ab-test-setup, cip-design, logo-design, content-hub, assets-organizing, video-production, youtube-handling …) were promoted into global on 2026-06-04. The local copies under `./.claude/skills/` still exist but are **harmlessly overridden by global** (personal beats project). Canonical source is `~/.claude/skills/`; re-promote after a marketing-kit update with `node ../../tools/promote-marketing-skills.mjs --force`.

## Your Agents (spawn when relevant)

All agents are **global** (`~/.claude/agents/`, ~32 total) — any project can spawn any of them. The marketing-specific subset:

**Marketing-specific:**
- **Content**: content-creator, copywriter, content-reviewer
- **Campaigns**: campaign-manager, campaign-debugger, email-wizard
- **SEO & Growth**: seo-specialist, attraction-specialist, funnel-architect
- **Social**: social-media-manager, community-manager
- **Analytics**: analytics-analyst, lead-qualifier
- **Sales**: sale-enabler, upsell-maximizer, continuity-specialist

**General-purpose (shared with Engineering):**
- **Planning & coordination**: planner, project-manager, researcher, docs-manager
- **Engineering**: fullstack-developer, database-admin, ui-ux-designer
- **Quality**: code-reviewer, tester, debugger
- **Utilities**: git-manager, mcp-manager, journal-writer, brainstormer, code-simplifier

## Recommended Skills (auto-invoke when relevant)

- `/brainstorm` — before planning campaigns or content strategy with multiple approaches
- `/research` — for market research, competitor analysis, audience insights
- `/scout` — when exploring existing content, templates, or campaign assets
- `content-reviewer` agent — before publishing any content piece
- `/seo` — when creating or optimizing web content for search
- `/analytics` — when analyzing campaign performance or reporting

## Visual Content Priority

For **templated/brand graphics, decks, and visual reports** — use Canva or Gamma FIRST:
- **Canva** → Editable templated designs, brand-kit social graphics, resizing, multi-format export
- **Gamma** → Quick AI-generated presentations, documents, webpages
- **Google Slides** → When collaborative editing or template compliance needed
- Fall back to code-based slides only when task specifically requires code output

For **dynamic generation** — custom ad creative, illustrations, pixel/game art, vector/SVG, short video clips, 3D assets, niche/LoRA styles — use the **`creative-router`** skill (fal.ai). It selects the model and states cost before running.

Grandfathered Gemini pipelines keep their lane **when explicitly invoked**: brand logos → `logo-design`; corporate-identity mockups → `cip-design`; full multi-scene video → `video-production` / `mkt:video:create`. `creative-router` handles standalone clips and generic generation.

For **built web pages** (not a Gamma one-pager) — a real landing page, funnel page, or owner-editable site — use the WebDesign capabilities (all global): `frontend-design` for a polished single-page build, and for a full owner-editable site/storefront the Web Studio recipe at `../WebDesign/.claude/rules/web-studio-recipe.md`. Gamma stays the lane for quick AI-generated one-pagers; this is for production pages.

## Structure Rules

- **New campaigns/initiatives go in the workspace-level `../../projects/` folder** — one self-contained folder each, never inside `Marketing/`. This workspace holds skills/agents/rules only.
- Folder name: descriptive, kebab-case (e.g. `../../projects/q2-email-campaign/`)
- Each folder is self-contained (copy, assets, analytics) and gets its own `CLAUDE.md` noting `Domain: Marketing` so these marketing skills/agents are the obvious choice when working inside it

## Documentation

Keep docs in `./docs`:

```
./docs
├── project-overview-pdr.md
├── marketing-overview.md
├── brand-guidelines.md
├── design-guidelines.md
├── codebase-summary.md
├── system-architecture.md
└── project-roadmap.md
```
