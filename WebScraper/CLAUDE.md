# CLAUDE.md — WebScraper Workspace

Web scraping workspace powered by Firecrawl MCP. For large-scale crawling, structured extraction, and converting websites into clean markdown.

## Capabilities

- **Single page scrape** — clean markdown from any URL (handles JS-rendered pages)
- **Full-site crawl** — recursively crawl entire domains
- **Site mapping** — discover all URLs on a domain without fetching content
- **Structured extraction** — extract data matching a schema (prices, specs, listings)
- **Search + scrape** — web search with full content extraction

## Tools

Primary: Firecrawl MCP (`mcp__firecrawl__*`)
Fallback: WebFetch (single pages), WebSearch (discovery), chrome-devtools skill (browser automation)

## Available Global Integrations

These are inherited from the root workspace and available here:
- **Google Drive** — save scraped content to Sheets/Docs for collaboration
- **Google Sheets** — export structured extraction results directly
- **Slack** — notify when large crawls complete
- **Gmail** — share scraping reports
- **Trigger.dev** — automate recurring scrape jobs

## Relevant Global Skills

Inherited automatically (no local skills needed):
- **research** — pre-scrape research and source discovery
- **chrome-devtools** — fallback browser automation for sites Firecrawl can't handle
- **sequential-thinking** — plan multi-step scraping strategies
- **ai-multimodal** — analyze scraped images/screenshots

## Workflow

1. **Map first** for large sites — get URL inventory before crawling
2. **Use depth limits** — avoid crawling more than needed
3. **Structure output** — organize by section, category, or date
4. **Save results** to project folders within this workspace
5. **Export** to Google Sheets/Drive when data needs sharing

## Structure Rules

- **Every scraping project gets its own folder** — no loose files at root
- Folder name: descriptive, kebab-case (e.g. `competitor-blog-audit/`)
- Each folder is self-contained (scraped content, analysis, reports)

## Documentation

Keep docs in `./docs/`, plans in `./plans/`.
