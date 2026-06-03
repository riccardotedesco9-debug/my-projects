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

## Starting a scrape job (especially unknown use cases)

Before running, make 3 quick decisions — confirm with Riccardo in one line, then execute:

1. **Shape** — which kind of job is this?
   - *list-of-items* (listings, offers, results)
   - *single-entity* deep-dive (one product/place/company)
   - *cross-source synthesis* (reviews, sentiment, consensus)
   - *discovery-first* (find URLs via search, then scrape)
   - *change-detection* (diff a page over time)
2. **Firecrawl method** — `scrape` for single pages, `extract` with schema for tabular/structured data (better than scrape+parse), `search` when URLs unknown, `map` for URL inventory on big sites, browser sessions for multi-step flows. If unsure of current capabilities, use the `docs-seeker` skill to pull latest Firecrawl docs — don't guess.
3. **Output** — Google Sheet (comparison/tabular/ranked), markdown report (synthesis/verdict), or JSON dump (downstream use).

If a method fails, follow `docs/escalation-ladder.md` rung-by-rung — don't jump straight to Browserbase.

## Workflow

1. **Check `workflows/` first** — reusable recipes for jobs you've run before (property search, deal hunt, review aggregation). Ask Riccardo for inputs before running.
2. **Map first** for large sites — get URL inventory before crawling
3. **Use depth limits** — avoid crawling more than needed
4. **Default output pattern**: scrape → schema extract → Google Sheet (via `google-drive` MCP)

## Available Recipes (`workflows/`)

- **property-search** — multi-portal listings → ranked Sheet shortlist
- **deal-hunter** — multi-retailer price comparison with trust signals
- **review-aggregator** — cross-source review synthesis with balanced verdict

Add new recipes only when a job repeats. One-off jobs go straight into their own folder under the workspace-level `../projects/`.

## Structure Rules

- **New scraping projects go in the workspace-level `../projects/` folder** — one self-contained folder each, never inside `WebScraper/`. This workspace holds skills/agents/rules + reusable recipes only.
- Folder name: descriptive, kebab-case (e.g. `../projects/competitor-blog-audit/`)
- Each folder is self-contained (scraped content, analysis, reports) and gets its own `CLAUDE.md` noting `Domain: WebScraper` so these scraping skills/tools are the obvious choice when working inside it

## Documentation

Keep docs in `./docs/`, plans in `./plans/`.
