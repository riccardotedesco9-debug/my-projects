# WebScraper — Briefing Source

Non-package-managed source for the dynamic domain briefing (read by `tools/brief-lib.mjs`, which
prefers this file over the workspace `CLAUDE.md`). Keeping the brief's lists here means a ClaudeKit
regen of any managed doc can't blank what WebScraper projects get briefed. Edit THIS file to change the
WebScraper brief.

Four `##` sections are parsed: **Mandatory Gates**, **Recommended Skills**, **MCP Tools**, **Your
Agents**. The single **[ENFORCED]** gate (code-review before push/deploy) is injected automatically
from `tools/brief-lib.mjs` for every domain — do NOT repeat it here; list only WebScraper's own
**[CONVENTION]** practices. Keep each bullet on ONE line; the parser keeps a bullet's first line and
dedupes by its first `backticked` / **bold** token.

## Mandatory Gates

- [CONVENTION] check `workflows/` for a reusable recipe before a new scrape; use `docs-seeker` for current Firecrawl capabilities rather than guessing.
- [CONVENTION] `map` large sites before crawling; default output pattern = scrape → schema `extract` → Google Sheet.

## Recommended Skills

- `research` — pre-scrape source discovery & synthesis.
- `docs-seeker` — pull current Firecrawl capabilities instead of guessing.
- `chrome-devtools` / `agent-browser` — fallback automation for sites Firecrawl can't handle.
- `sequential-thinking` — plan multi-step / multi-source scrape pipelines.
- `ai-multimodal` — analyze scraped images/screenshots.
- `repomix` — pack large scraped corpora / a codebase into LLM-ready context.
- Full "which skill for which job" map: `~/.claude/rules/skill-domain-routing.md`.

## MCP Tools

- **Firecrawl** — scrape / crawl / map / structured `extract` (primary engine).
- **Google Drive / Sheets** — export structured extraction results.
- **Slack** — notify when a large crawl completes.
- **Trigger.dev** — schedule recurring scrape jobs.
- Need custom art / video / music / voice? That's the **WebDesign / Marketing** domains — `creative-router` (fal) for visuals + music, **ElevenLabs** for voice/SFX; add that `Domain:` to the project too rather than pulling the tools in here.

## Your Agents

All agents are global (`~/.claude/agents/`) — spawn the specialist for the job: **researcher** for source
discovery + synthesis, **debugger** when Firecrawl/selectors fail, **planner** for multi-stage scrape
pipelines, **database-admin** when results land in a DB. The [ENFORCED] gate above applies whenever a
scrape job ships code/automation.
