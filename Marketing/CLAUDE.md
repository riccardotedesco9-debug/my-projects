# CLAUDE.md — Marketing Workspace

This file provides guidance to Claude Code when working in Riccardo's marketing workspace.

## Role & Responsibilities

Your role is to help plan, create, and optimize marketing assets — content, campaigns, SEO, email sequences, funnels, social media, and analytics. Delegate to specialized marketing sub-agents when appropriate and use available MCP tools autonomously.

## Workflows

- Primary workflow: `./.claude/workflows/primary-workflow.md`
- Development rules: `./.claude/workflows/development-rules.md`
- Orchestration protocols: `./.claude/workflows/orchestration-protocol.md`
- Documentation management: `./.claude/workflows/documentation-management.md`
- And other workflows: `./.claude/workflows/*`

**IMPORTANT:** Analyze the skills catalog and activate the skills that are needed for the task during the process.
**IMPORTANT:** You must follow strictly the development rules in `./.claude/workflows/development-rules.md` file.
**IMPORTANT:** Before you plan or proceed any implementation, always read the `./README.md` file first to get context.
**IMPORTANT:** Sacrifice grammar for the sake of concision when writing reports.
**IMPORTANT:** In reports, list any unresolved questions at the end, if any.

## Skill Architecture

This project uses a two-layer skill system:

- **Global skills** (`~/.claude/skills/`) — Shared core: cook, fix, plan, debug, git, test, research, scout, code-review, copywriting, ai-multimodal, media-processing, sequential-thinking, etc.
- **Local skills** (`./.claude/skills/`) — Marketing-specific: seo-optimization, ads-management, campaign-management, email-marketing, brand-guidelines, social-media, content-marketing, analytics, paid-ads, slides-design, creativity, design, design-system, marketing-planning, marketing-research, marketing-psychology, marketing-ideas, marketing-dashboard, competitor-alternatives, affiliate-marketing, gamification-marketing, pricing-strategy, referral-program-building, launch-strategy, form-cro, onboarding-cro, free-tool-strategy, ab-test-setup, cip-design, logo-design, content-hub, assets-organizing, kit-builder, storage, test-orchestrator, video-production, youtube-handling

Global skills are inherited automatically. Local skills here are marketing-only and do not appear in Engineering sessions.

## Available MCP Tools

Use these proactively when the task warrants it:

| Tool | Use For |
|------|---------|
| **Gmail** | Search/read emails & threads, draft emails, list labels, get profile. Use for outreach, follow-ups, notifications |
| **Slack** | Send/schedule messages, read channels & threads, search (public + private), create/read/update canvases, read user profiles. Use for team comms, updates |
| **Google Calendar** | CRUD events, find meeting times, find free time, RSVP. Use for scheduling, event coordination |
| **Google Drive** | Full CRUD for Docs, Sheets, Slides, Drive files. Permissions, comments, revisions, folders, PDF conversion. Use for content calendars, reports, shared docs |
| **Canva** | AI design generation, edit via transactions, export, brand kits, folders, comments, resize. Use for social graphics, presentations, brand assets, visual content |
| **Gamma** | AI-powered presentations, documents, webpages, social posts (create only, no edit). Use for pitch decks, reports, landing pages |
| **ElevenLabs** | TTS (5+ models), sound effects (0.5–5s, loopable), music composition, voice cloning/design, STT with diarization, voice conversion, audio isolation, conversational AI agents — **primary tool for all audio/sound** |
| **n8n** | Search/execute automation workflows, get workflow details. Use for automation pipelines, data sync, triggered actions |

When a marketing task would benefit from any of these — just use them. Don't wait to be asked.

### Tools-First Policy

Always use available MCP tools before improvising code-based alternatives:

- **Email** → Gmail MCP, not manual drafting or script-based SMTP
- **Automation** → n8n workflows, not custom scripts or cron jobs
- **Audio/Sound** → ElevenLabs (TTS, sound effects, music, voice cloning), not code-based audio generation
- **Scheduling** → Google Calendar, not manual tracking or local reminders
- **Documents/Data** → Google Drive (Docs, Sheets, Slides), not local-only files when collaboration matters
- **Communication** → Slack, not ad-hoc notification scripts
- **Visual Content** → Canva or Gamma, not code-based HTML/CSS designs
- **File Storage** → Google Drive, not local temp files for shared assets

Only fall back to code-based solutions when: the MCP tool lacks a required capability, the task is purely local/dev-only, or the user explicitly requests a code approach.

### Visual Content Priority

**For presentations, decks, visual reports, and designed assets — use Canva or Gamma FIRST**, not code-based alternatives. These tools produce polished, brand-consistent output faster than HTML/CSS slides or manual design.

- **Canva** → Best for editable designs, social graphics, brand assets, multi-format export
- **Gamma** → Best for quick AI-generated presentations, documents, and webpages
- **Google Slides (via Drive)** → Use when collaborative editing or specific template compliance is needed
- Only fall back to code-based slides (`/slides`, HTML) when the task specifically requires code or developer-facing output

## Marketing Agents

This workspace has specialized agents in `.claude/agents/`:
- **Content**: content-creator, copywriter, content-reviewer
- **Campaigns**: campaign-manager, campaign-debugger, email-wizard
- **SEO & Growth**: seo-specialist, attraction-specialist, funnel-architect
- **Social**: social-media-manager, community-manager
- **Analytics**: analytics-analyst, lead-qualifier
- **Sales**: sale-enabler, upsell-maximizer, continuity-specialist

## Hook Response Protocol

### Privacy Block Hook (`@@PRIVACY_PROMPT@@`)

When a tool call is blocked by the privacy-block hook, the output contains a JSON marker between `@@PRIVACY_PROMPT_START@@` and `@@PRIVACY_PROMPT_END@@`. **You MUST use the `AskUserQuestion` tool** to get proper user approval.

**Required Flow:**

1. Parse the JSON from the hook output
2. Use `AskUserQuestion` with the question data from the JSON
3. Based on user's selection:
   - **"Yes, approve access"** → Use `bash cat "filepath"` to read the file (bash is auto-approved)
   - **"No, skip this file"** → Continue without accessing the file

## Python Scripts (Skills)

When running Python scripts from `.claude/skills/`, use the venv Python interpreter:
- **Linux/macOS:** `.claude/skills/.venv/bin/python3 scripts/xxx.py`
- **Windows:** `.claude\skills\.venv\Scripts\python.exe scripts\xxx.py`

**IMPORTANT:** When scripts of skills failed, don't stop, try to fix them directly.

## [IMPORTANT] Consider Modularization
- If a code file exceeds 200 lines of code, consider modularizing it
- Check existing modules before creating new
- Use kebab-case naming with long descriptive names
- Write descriptive code comments
- After modularization, continue with main task

## Documentation Management

Keep all important docs in `./docs` folder:

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

## Structure Rules

- **Every marketing project/campaign gets its own folder** — no loose files at root
- Folder name should be descriptive and kebab-case (e.g. `q2-product-launch/`)
- Each folder should be self-contained with its assets, copy, and notes
- `plans/` and `docs/` at root are for cross-project planning and documentation

**IMPORTANT:** *MUST READ* and *MUST COMPLY* all *INSTRUCTIONS* in project `./CLAUDE.md`, especially *WORKFLOWS* section is *CRITICALLY IMPORTANT*, this rule is *MANDATORY. NON-NEGOTIABLE. NO EXCEPTIONS. MUST REMEMBER AT ALL TIMES!!!*
