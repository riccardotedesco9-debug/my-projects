# CLAUDE.md — My Projects (Root)

This is the parent workspace containing all of Riccardo's projects.

## Project Structure

```
My Projects/
├── Engineering/    — Personal engineering sandbox (experiments, prototypes, tools)
├── Marketing/      — Marketing workspace (campaigns, content, SEO, funnels)
├── WebDesign/      — Frontend web design workspace (websites, landing pages, UI)
├── WebScraper/     — Web scraping workspace (Firecrawl MCP, crawling, extraction)
└── CLAUDE.md       — This file (global context)
```

Each subdirectory is an independent project with its own `.claude/` config, agents, skills, and workflows. When working in a subdirectory, follow that project's `CLAUDE.md` and rules.

### Shared Directories

Projects may contain these common directories:

| Directory | Purpose | Lifecycle |
|---|---|---|
| `workflows/` | Markdown SOPs defining objectives, inputs, tools, outputs, edge cases | Persistent — evolve as you learn |
| `tools/` | Python scripts for deterministic execution (API calls, transforms, file ops) | Persistent — tested and versioned |
| `.tmp/` | Intermediate/scraped data, processing artifacts | Disposable — regenerated as needed |

Credentials and API keys live in `.env` (gitignored). Final deliverables go to cloud services (Google Drive, Sheets, etc.), not local files.

## Agent Operating Model

You operate in a **Workflows → Agent → Tools** architecture. Workflows are markdown SOPs (the instructions), you are the agent (reasoning and orchestration), and tools are deterministic scripts (execution). This separation matters: probabilistic AI handles decisions while deterministic code handles execution, keeping accuracy high across multi-step tasks.

**Operating principles:**
1. **Existing tools first** — check `tools/` and MCP integrations before building anything new
2. **Fail forward** — when errors occur: read the full trace, fix the script, retest, then update the workflow so it doesn't recur. If a fix involves paid API calls or credits, confirm before retrying.
3. **Keep workflows current** — when you discover better methods, constraints, or recurring issues, update the relevant workflow. Don't create or overwrite workflows without asking unless explicitly told to.
4. **Self-improvement loop** — identify what broke → fix the tool → verify the fix → update the workflow → move on with a stronger system

## Skill Visibility

Full skill architecture is defined in `~/.claude/CLAUDE.md`. In this workspace:
- **Root directory** → global skills only
- **Engineering/** → global + engineering local skills
- **Marketing/** → global + marketing local skills
- **WebDesign/** → global + web design local skills (frontend-design, ui-ux-pro-max, web-design-guidelines)
- **WebScraper/** → global skills + Firecrawl MCP

## Available MCP Integrations (Global)

These tools are available across ALL projects. Use them autonomously when the task warrants it — do not wait for the user to ask.

### Communication & Productivity
- **Gmail** (`mcp__claude_ai_Gmail__*`) — Search/read messages & threads, draft emails, list labels, get profile. Use for outreach, follow-ups, notifications.
- **Slack** (`mcp__claude_ai_Slack__*`) — Send/schedule messages, read channels & threads, search (public + private), create/read/update canvases, read user profiles. Use for team comms, updates, documentation.
- **Google Calendar** (`mcp__claude_ai_Google_Calendar__*`) — List/create/update/delete events, find meeting times across attendees, find free time, RSVP to invitations. Use for scheduling, meeting coordination.

### Documents & Storage
- **Google Drive** (`mcp__google-drive__*`) — Full CRUD for Google Docs, Sheets, Slides, and Drive files. Create/edit/format documents, spreadsheets (formulas, validation, conditional formatting, named ranges), and presentations (shapes, text boxes, speaker notes, backgrounds). Manage permissions, comments, revisions, folders, shortcuts. Upload/download files, convert PDFs to Docs. Also has calendar event access. Use for content calendars, reports, shared documents, data management.

### Content & Design
- **Canva** (`mcp__claude_ai_Canva__*`) — Generate designs (AI-powered), create from candidates, edit via transactions (start → perform operations → commit), export in multiple formats, manage folders/assets, comment on designs, resize, search designs/folders, manage brand kits, import from URL. Use for visual content, social graphics, presentations.
- **Gamma** (`mcp__claude_ai_Gamma__*`) — Generate AI-powered presentations, documents, webpages, and social posts. Browse themes and folders. Note: can only create new content, cannot edit existing Gammas. Use for pitch decks, reports, landing pages.

### Voice, Audio & Sound Design
- **ElevenLabs** (`mcp__elevenlabs__*`) — Comprehensive audio platform:
  - **TTS**: Text-to-speech with 5+ models (multilingual, flash, turbo), voice selection, stability/style controls, speed adjustment, multiple output formats (MP3, PCM, WAV, Opus)
  - **Sound Effects**: Text-to-sound-effects generation (0.5–5 sec, loopable) — ideal for game SFX
  - **Music**: AI music composition from prompts or structured composition plans with sections, styles, and lyrics
  - **Voice Design**: Generate new voices from text descriptions, clone voices from audio samples, search public voice library (thousands of voices)
  - **Speech-to-Text**: Transcription with speaker diarization
  - **Voice Conversion**: Speech-to-speech voice transformation
  - **Audio Isolation**: Extract/clean vocals from audio files
  - **Conversational AI**: Create voice agents with custom prompts, knowledge bases, and phone call capabilities
  - **Playback**: Play audio files directly
  - Use as **primary tool for all sound design** — covers SFX, music, voices, and audio processing

### Web Scraping
- **Firecrawl** (`mcp__firecrawl__*`) — Full-site crawling, single-page scraping, site mapping, structured data extraction. Handles JS rendering, converts to clean markdown. Available in `WebScraper/` workspace. Use for competitor analysis, content audits, documentation ingestion, bulk data extraction.

### Automation
- **Trigger.dev** (`mcp__trigger__*`) — Deploy, trigger, and monitor TypeScript automation tasks. Use for background jobs, scheduled tasks, AI agent orchestration, data pipelines. Project lives in `Engineering/trigger-automations/`.

## Tools-First Policy

**Resolution order:** MCP integrations → existing `tools/` scripts → existing `workflows/` SOPs → new code (last resort).

Always use available MCP tools before improvising code-based alternatives:

- **Email** → Gmail MCP, not manual drafting or script-based SMTP
- **Automation** → Trigger.dev tasks, not custom scripts or cron jobs
- **Audio/Sound** → ElevenLabs, not code-based audio generation
- **Scheduling** → Google Calendar, not manual tracking
- **Documents/Data** → Google Drive (Docs, Sheets, Slides), not local-only files when collaboration matters
- **Communication** → Slack, not ad-hoc notification scripts
- **Visual Content** → Canva or Gamma, not code-based HTML/CSS designs
- **File Storage** → Google Drive, not local temp files for shared assets
- **Web Scraping** → Firecrawl MCP (in WebScraper/), not manual fetch loops or custom scrapers
- **Deterministic tasks** → `tools/` scripts, not inline AI reasoning for API calls, transforms, or file ops

Only fall back to new code when: MCP tool lacks a required capability, no existing script covers the task, the task is purely local/dev-only, or the user explicitly requests code.

**Usage guidelines:**
- **Proactively**: If a task clearly benefits from a tool, just use it.
- **Combine tools**: Chain tools for complex workflows (e.g., research → write content → design in Canva → schedule via Slack).
- **Ask when ambiguous**: Briefly confirm before executing external actions (sending emails, posting messages, creating events).
- **Deliverables to cloud**: Final outputs go to cloud services where the user can access them directly. Local files (`.tmp/`) are just for processing.

## Cross-Project Rules

- **No loose project files at root** — all work belongs inside `Engineering/`, `Marketing/`, `WebDesign/`, or `WebScraper/`. Only shared config (CLAUDE.md, .gitignore) lives at root level.
- Each project has its own `CLAUDE.md` — always read it when entering a subdirectory.
- Plans go in `{project}/plans/`, docs in `{project}/docs/`.
