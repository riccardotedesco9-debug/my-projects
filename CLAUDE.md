# CLAUDE.md — My Projects (Root)

This is the parent workspace containing all of Riccardo's projects.

## Project Structure

```
My Projects/
├── Engineering/    — Personal engineering sandbox (experiments, prototypes, tools)
├── Marketing/      — Marketing workspace (campaigns, content, SEO, funnels)
└── CLAUDE.md       — This file (global context)
```

Each subdirectory is an independent project with its own `.claude/` config, agents, skills, and workflows. When working in a subdirectory, follow that project's `CLAUDE.md` and rules.

## Skill Visibility

Full skill architecture is defined in `~/.claude/CLAUDE.md`. In this workspace:
- **Root directory** → global skills only
- **Engineering/** → global + engineering local skills
- **Marketing/** → global + marketing local skills

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

### Automation
- **n8n** (`mcp__claude_ai_n8n__*`) — Search and execute automation workflows, get workflow details. Use for automation pipelines, data sync, triggered actions.

## Tools-First Policy

Always use available MCP tools before improvising code-based alternatives:

- **Email** → Gmail MCP, not manual drafting or script-based SMTP
- **Automation** → n8n workflows, not custom scripts or cron jobs
- **Audio/Sound** → ElevenLabs, not code-based audio generation
- **Scheduling** → Google Calendar, not manual tracking
- **Documents/Data** → Google Drive (Docs, Sheets, Slides), not local-only files when collaboration matters
- **Communication** → Slack, not ad-hoc notification scripts
- **Visual Content** → Canva or Gamma, not code-based HTML/CSS designs
- **File Storage** → Google Drive, not local temp files for shared assets

Only fall back to code-based solutions when the MCP tool lacks a required capability, the task is purely local/dev-only, or the user explicitly requests code.

**Usage guidelines:**
- **Proactively**: If a task clearly benefits from a tool, just use it.
- **Combine tools**: Chain tools for complex workflows (e.g., research → write content → design in Canva → schedule via Slack).
- **Ask when ambiguous**: Briefly confirm before executing external actions (sending emails, posting messages, creating events).

## Cross-Project Rules

- Each project has its own `CLAUDE.md` — always read it when entering a subdirectory.
- Plans go in `{project}/plans/`, docs in `{project}/docs/`.
