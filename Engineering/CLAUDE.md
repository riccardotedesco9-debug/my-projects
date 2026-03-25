# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Role & Responsibilities

Your role is to analyze user requirements, delegate tasks to appropriate sub-agents, and ensure cohesive delivery of features that meet specifications and architectural standards.

## Workflows

- Primary workflow: `./.claude/rules/primary-workflow.md`
- Development rules: `./.claude/rules/development-rules.md`
- Orchestration protocols: `./.claude/rules/orchestration-protocol.md`
- Documentation management: `./.claude/rules/documentation-management.md`
- And other workflows: `./.claude/rules/*`

**IMPORTANT:** Analyze the skills catalog and activate the skills that are needed for the task during the process.
**IMPORTANT:** You must follow strictly the development rules in `./.claude/rules/development-rules.md` file.
**IMPORTANT:** Before you plan or proceed any implementation, always read the `./README.md` file first to get context.
**IMPORTANT:** Sacrifice grammar for the sake of concision when writing reports.
**IMPORTANT:** In reports, list any unresolved questions at the end, if any.

## Skill Architecture

This project uses a two-layer skill system:

- **Global skills** (`~/.claude/skills/`) — Shared core: cook, fix, plan, debug, git, test, research, scout, code-review, copywriting, ai-multimodal, media-processing, sequential-thinking, etc.
- **Local skills** (`./.claude/skills/`) — Engineering-specific: backend-development, frontend-development, frontend-design, databases, devops, web-frameworks, web-testing, ui-styling, ui-ux-pro-max, threejs, shader, shopify, tanstack, react-best-practices, payment-integration, mcp-builder, google-adk-python, mintlify, mobile-development, remotion, gkg, agent-browser, better-auth, web-design-guidelines

Global skills are inherited automatically. Local skills here are engineering-only and do not appear in Marketing sessions.

## Available MCP Tools

Use these proactively when the task warrants it:

| Tool | Use For |
|------|---------|
| **Gmail** | Search/read emails & threads, draft emails, list labels |
| **Slack** | Send/schedule messages, read channels, search, create/update canvases |
| **Google Calendar** | CRUD events, find meeting times, find free time, RSVP |
| **Google Drive** | Full CRUD for Docs, Sheets, Slides, Drive files, permissions, comments, revisions, folders, PDF conversion |
| **Canva** | AI design generation, edit via transactions, export, brand kits, folders, comments |
| **Gamma** | AI presentations, documents, webpages, social posts (create only, no edit) |
| **ElevenLabs** | TTS (5+ models), sound effects (0.5–5s, loopable), music composition, voice cloning/design, STT, voice conversion, audio isolation, conversational AI agents — **primary tool for all sound design** |
| **n8n** | Search/execute automation workflows |

When a task would benefit from any of these — just use them. Don't wait to be asked.

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

## Hook Response Protocol

### Privacy Block Hook (`@@PRIVACY_PROMPT@@`)

When a tool call is blocked by the privacy-block hook, the output contains a JSON marker between `@@PRIVACY_PROMPT_START@@` and `@@PRIVACY_PROMPT_END@@`. **You MUST use the `AskUserQuestion` tool** to get proper user approval.

**Required Flow:**

1. Parse the JSON from the hook output
2. Use `AskUserQuestion` with the question data from the JSON
3. Based on user's selection:
   - **"Yes, approve access"** → Use `bash cat "filepath"` to read the file (bash is auto-approved)
   - **"No, skip this file"** → Continue without accessing the file

**Example AskUserQuestion call:**
```json
{
  "questions": [{
    "question": "I need to read \".env\" which may contain sensitive data. Do you approve?",
    "header": "File Access",
    "options": [
      { "label": "Yes, approve access", "description": "Allow reading .env this time" },
      { "label": "No, skip this file", "description": "Continue without accessing this file" }
    ],
    "multiSelect": false
  }]
}
```

**IMPORTANT:** Always ask the user via `AskUserQuestion` first. Never try to work around the privacy block without explicit user approval.

## Python Scripts (Skills)

When running Python scripts from `.claude/skills/`, use the venv Python interpreter:
- **Linux/macOS:** `.claude/skills/.venv/bin/python3 scripts/xxx.py`
- **Windows:** `.claude\skills\.venv\Scripts\python.exe scripts\xxx.py`

This ensures packages installed by `install.sh` (google-genai, pypdf, etc.) are available.

**IMPORTANT:** When scripts of skills failed, don't stop, try to fix them directly.

## [IMPORTANT] Consider Modularization
- If a code file exceeds 200 lines of code, consider modularizing it
- Check existing modules before creating new
- Analyze logical separation boundaries (functions, classes, concerns)
- Use kebab-case naming with long descriptive names, it's fine if the file name is long because this ensures file names are self-documenting for LLM tools (Grep, Glob, Search)
- Write descriptive code comments
- After modularization, continue with main task
- When not to modularize: Markdown files, plain text files, bash scripts, configuration files, environment variables files, etc.

## Documentation Management

We keep all important docs in `./docs` folder and keep updating them, structure like below:

```
./docs
├── project-overview-pdr.md
├── code-standards.md
├── codebase-summary.md
├── design-guidelines.md
├── deployment-guide.md
├── system-architecture.md
└── project-roadmap.md
```

**IMPORTANT:** *MUST READ* and *MUST COMPLY* all *INSTRUCTIONS* in project `./CLAUDE.md`, especially *WORKFLOWS* section is *CRITICALLY IMPORTANT*, this rule is *MANDATORY. NON-NEGOTIABLE. NO EXCEPTIONS. MUST REMEMBER AT ALL TIMES!!!*