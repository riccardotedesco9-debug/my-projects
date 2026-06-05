# WebScraper — Briefing Source

Non-package-managed source for the dynamic domain briefing (read by `tools/brief-lib.mjs`, which
prefers this file over the workspace `CLAUDE.md`). Keeping the brief's gate/agent lists here means a
ClaudeKit regen of any managed doc can't blank what WebScraper projects get briefed. Edit THIS file to
change the WebScraper brief.

Only the two `##` sections below are parsed (Mandatory Gates, Your Agents). The single **[ENFORCED]**
gate (code-review before push/deploy) is injected automatically from `tools/brief-lib.mjs` for every
domain — do NOT repeat it here. List only WebScraper's own **[CONVENTION]** practices. Keep each gate
bullet on ONE line; the parser keeps a bullet's first line and dedupes by its first `backticked` token.

## Mandatory Gates

- [CONVENTION] check `workflows/` for a reusable recipe before a new scrape; use `docs-seeker` for current Firecrawl capabilities rather than guessing.
- [CONVENTION] `map` large sites before crawling; default output pattern = scrape → schema `extract` → Google Sheet.

## Your Agents

All agents are global (`~/.claude/agents/`). Scraping-relevant: **researcher** (source discovery +
synthesis), **debugger** (when Firecrawl/selectors fail), **planner** (multi-stage scrape pipelines),
**database-admin** (if results land in a DB). The [ENFORCED] gate above applies whenever a scrape job
ships code/automation.
