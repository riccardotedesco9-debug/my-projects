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

## Available MCP Tools

Use these proactively when the task warrants it:

| Tool | Use For |
|------|---------|
| **Gmail** | Outreach, follow-ups, email research |
| **Slack** | Team updates, channel monitoring |
| **Google Calendar** | Scheduling, event coordination |
| **Google Drive** | Read/write Docs, Sheets, Slides, Drive files |
| **Canva** | Social graphics, presentations, brand assets |
| **Gamma** | Pitch decks, reports, landing pages |
| **ElevenLabs** | Voiceovers, audio content, transcription |
| **n8n** | Automation workflows, data pipelines |

When a marketing task would benefit from any of these — just use them. Don't wait to be asked.

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
