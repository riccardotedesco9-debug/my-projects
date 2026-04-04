# CLAUDE.md — Marketing Workspace

Riccardo's marketing workspace. Each campaign, initiative, or content project lives in its own folder.

## Role & Responsibilities

Help plan, create, and optimize marketing assets — content, campaigns, SEO, email sequences, funnels, social media, and analytics. Delegate to specialized marketing sub-agents when appropriate and use available MCP tools autonomously.

## Workflows

- Primary workflow: `./.claude/workflows/primary-workflow.md`
- Development rules: `./.claude/workflows/development-rules.md`
- Orchestration protocols: `./.claude/workflows/orchestration-protocol.md`
- Documentation management: `./.claude/workflows/documentation-management.md`
- And other workflows: `./.claude/workflows/*`

## Local Skills (`./.claude/skills/`)

Marketing-specific (global skills inherited automatically):
seo-optimization, ads-management, campaign-management, email-marketing, brand-guidelines, social-media, content-marketing, analytics, paid-ads, slides-design, creativity, design, design-system, marketing-planning, marketing-research, marketing-psychology, marketing-ideas, marketing-dashboard, competitor-alternatives, affiliate-marketing, gamification-marketing, pricing-strategy, referral-program-building, launch-strategy, form-cro, onboarding-cro, free-tool-strategy, ab-test-setup, cip-design, logo-design, content-hub, assets-organizing, kit-builder, storage, test-orchestrator, video-production, youtube-handling

## Marketing Agents

Specialized agents in `.claude/agents/`:
- **Content**: content-creator, copywriter, content-reviewer
- **Campaigns**: campaign-manager, campaign-debugger, email-wizard
- **SEO & Growth**: seo-specialist, attraction-specialist, funnel-architect
- **Social**: social-media-manager, community-manager
- **Analytics**: analytics-analyst, lead-qualifier
- **Sales**: sale-enabler, upsell-maximizer, continuity-specialist

## Recommended Skills (auto-invoke when relevant)

- `/brainstorm` — before planning campaigns or content strategy with multiple approaches
- `/research` — for market research, competitor analysis, audience insights
- `/scout` — when exploring existing content, templates, or campaign assets
- `content-reviewer` agent — before publishing any content piece
- `/seo` — when creating or optimizing web content for search
- `/analytics` — when analyzing campaign performance or reporting

## Visual Content Priority

For presentations, decks, visual reports — use Canva or Gamma FIRST:
- **Canva** → Editable designs, social graphics, brand assets, multi-format export
- **Gamma** → Quick AI-generated presentations, documents, webpages
- **Google Slides** → When collaborative editing or template compliance needed
- Fall back to code-based slides only when task specifically requires code output

## Structure Rules

- **Every campaign/initiative gets its own folder** — no loose files at root
- Folder name: descriptive, kebab-case (e.g. `q2-email-campaign/`)
- Each folder is self-contained (copy, assets, analytics)

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
