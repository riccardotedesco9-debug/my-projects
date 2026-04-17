# Firecrawl Escalation Ladder

When a scrape fails or returns poor data, climb this ladder rung-by-rung. Don't skip to Browserbase on the first failure.

## Rung 1 — Default `scrape`

```
firecrawl_scrape(url, formats=["markdown"])
```
Works for 80%+ of public static/SSR pages.

**Fails when:** content is rendered client-side, behind a lazy load, or page returns mostly nav/boilerplate.

## Rung 2 — Tuned `scrape`

```
firecrawl_scrape(url, formats=["markdown"], onlyMainContent=true, waitFor=3000)
```
Strips nav/chrome, waits for JS. Try this before escalating further.

## Rung 3 — `extract` with schema

```
firecrawl_extract(urls=[...], schema={...}, prompt="...")
```
Handles JS-rendered content better than `scrape` because it's task-oriented. Best for structured data (listings, offers, specs). Accepts multiple URLs in one call — efficient for deal hunts.

## Rung 4 — Browser session (persistent)

```
firecrawl_browser_create → firecrawl_browser_execute (multi-step) → firecrawl_browser_delete
```
For sites needing clicks, scroll, form fills, or cookies. Use when a single URL can't reach the data (e.g. search-then-click patterns).

**Fails when:** site actively blocks automated browsers (Cloudflare challenge, bot detection).

## Rung 5 — `agent-browser` skill (Browserbase)

Riccardo's global skill wraps Browserbase — a cloud-hosted stealth browser.

Use when Firecrawl's browser sessions get blocked. Only climb here if you've hit a genuine anti-bot wall.

**Trade-offs:** paid, slower, auth footprint. Don't use speculatively.

## Rung 6 — Manual capture fallback

Last resort: Riccardo manually opens the page, uses the `chrome-devtools` skill to capture DOM/HTML, feeds to Claude for parsing. Slow but always works.

## When to stop

If you're three rungs deep on a single site and still struggling, question whether the site is worth the fight. For consumer scrapes, there's almost always an alternative source.

## Diagnostic tips

- **Empty/boilerplate markdown** → rung 2 or 3
- **HTTP 403 / captcha page** → rung 4, then 5
- **Partial data (list truncated)** → pagination; rung 3 with multiple URLs, or rung 4
- **Login required** → rung 5 with stored auth, or reconsider (most consumer use cases have an unauthenticated alternative)
