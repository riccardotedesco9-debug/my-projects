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

## Available MCP Integrations (Global)

These tools are available across ALL projects. Use them autonomously when the task warrants it — do not wait for the user to ask.

### Communication & Productivity
- **Gmail** (`mcp__claude_ai_Gmail__*`) — Search, read, draft emails. Use for outreach, follow-ups, notifications.
- **Slack** (`mcp__claude_ai_Slack__*`) — Read/send messages, search channels, create canvases. Use for team comms, updates.
- **Google Calendar** (`mcp__claude_ai_Google_Calendar__*`) — List/create/update events, find free time. Use for scheduling, meeting coordination.
- **Google Drive** (`mcp__google_drive__*`) — Read/write Google Docs, Sheets, Slides, and Drive files. Use for content calendars, reports, shared documents.

### Content & Design
- **Canva** (`mcp__claude_ai_Canva__*`) — Create/edit designs, export assets, manage brand kits. Use for visual content, social graphics, presentations.
- **Gamma** (`mcp__claude_ai_Gamma__*`) — Generate presentations, documents, webpages. Use for pitch decks, reports, landing pages.

### Voice & Audio
- **ElevenLabs** (`mcp__elevenlabs__*`) — Text-to-speech, voice cloning, speech-to-text, sound effects, music composition. Use for voiceovers, audio content, transcription.

### Automation
- **n8n** (`mcp__claude_ai_n8n__*`) — Execute/search workflows. Use for automation pipelines, data sync, triggered actions.

## When to Use These Tools

- **Proactively**: If a task clearly benefits from a tool (e.g., drafting an email → use Gmail, creating a visual → use Canva), go ahead and use it.
- **Research first**: When unsure what's available, use `mcp-management` skill or `ToolSearch` to discover capabilities.
- **Combine tools**: Chain tools for complex workflows (e.g., research → write content → design in Canva → schedule via Slack).
- **Ask when ambiguous**: If a task could go multiple directions, briefly confirm with the user before executing external actions (sending emails, posting messages, creating calendar events).

## Cross-Project Rules

- Each project has its own `CLAUDE.md` — always read it when entering a subdirectory.
- Plans go in `{project}/plans/`, docs in `{project}/docs/`.
- Follow YAGNI / KISS / DRY across all projects.
- Use conventional commits, no AI references in messages.
