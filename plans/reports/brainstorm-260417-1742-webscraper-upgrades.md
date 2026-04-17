# WebScraper Upgrades — Brainstorm Summary

**Date:** 2026-04-17
**Mode:** /brainstorm
**Seed question:** "How to make WebScraper meaningfully more powerful"

---

## Problem restated (after discovery)

User actually wants: **a dynamic, flexible, general-purpose consumer scraper for ad hoc jobs** — property hunts, deal comparison, listings, etc. Not recurring monitoring, not SEO intel, not structured data pipelines. Usage is ad hoc. Infra appetite is LOW (only when a concrete job demands it). No known Firecrawl failure modes yet — never hit a wall.

This is very different from a "scraping platform" problem. It's a **"make ad hoc scraping sessions produce good outputs fast"** problem.

---

## What NOT to do (contrarian takes)

1. **Don't add Browserbase MCP yet.** No confirmed failure mode. Installing it preemptively = speculative infra, duplicated auth, more surface area. Wait until Firecrawl actually blocks on something.
2. **Don't wire Trigger.dev scheduled crawls.** Ad hoc usage = no recurring workload. Scheduled jobs are a solution for a problem Riccardo doesn't have.
3. **Don't build D1/R2 persistence.** No data accumulation, no querying requirement. Raw output → Sheet or summary report is enough.
4. **Don't add SerpAPI / DataForSEO.** Only valuable for SEO/competitive-intel workflows. Consumer scraping (properties, deals) gets more leverage from direct-site scrapes + LLM synthesis.
5. **Don't add residential proxies.** Classic "solving a future problem." Trigger only if blocks happen repeatedly.
6. **Don't treat WebScraper as a product.** Risk: over-engineering a workspace that's used rarely. Instead, treat it as a **thin recipe-and-pattern layer on top of Firecrawl**.

## Second contrarian take

**WebScraper might not need to exist as a workspace at all.** Project-specific scrape jobs (property search, deal hunting) could live in their own root-level project folder (like `weekly-pulse/` pattern) and call Firecrawl directly. WebScraper as a workspace currently adds org overhead without leverage. **Not recommended to delete — but worth asking whether dedicated project folders would serve better for the concrete jobs.**

---

## What actually makes it more powerful (for THIS use case)

### Tier 1 — Genuine high-leverage (no infra)

**1. Scraping Recipe Library (`WebScraper/workflows/`)**
Reusable markdown playbooks for common consumer patterns. Each recipe = prompt template + extraction schema + output format. Examples:
- `property-search.md` — inputs (location, price, beds) → scrape Rightmove/Zillow-equivalents → Sheet with links, prices, photos, score
- `deal-hunter.md` — inputs (product) → scrape Amazon/eBay/retailer sites → best-price table with seller ratings
- `event-listing.md` — inputs (city, date range) → event aggregators → structured calendar
- `flight-hotel-compare.md` — multi-site + schema extraction
- `review-aggregator.md` — pull reviews from 3-5 sources → sentiment summary

**Why high-leverage:** The bottleneck for ad hoc dynamic scraping is NOT capability — Firecrawl already scrapes well. It's knowing HOW to structure the request and output. A recipe library compounds over time; each new job either reuses an existing recipe or adds one.

**2. "Scrape → Structure → Sheet" default pattern**
Raw markdown from Firecrawl is bad for consumer use cases (hard to compare deals across sites). Pattern to codify as a workflow:
- Firecrawl `extract` with a task-specific schema
- Dump into a fresh Google Sheet via `google-drive` MCP
- Optional: LLM summary pass at the bottom

**Why high-leverage:** One reusable pattern eliminates the most tedious part of every ad hoc job.

**3. Escalation ladder doc (`WebScraper/docs/escalation-ladder.md`)**
Short cheat sheet: when Firecrawl's default fails, what's next?
1. Firecrawl `scrape` with `onlyMainContent` / formats tweaks
2. Firecrawl `extract` with explicit schema (handles JS better)
3. Firecrawl browser session (persistent, multi-step)
4. `agent-browser` skill → Browserbase (only if truly needed)
5. Manual: capture with chrome-devtools, feed to Firecrawl

**Why high-leverage:** Saves 20+ min per job where user tries to debug a failing scrape without a mental model.

### Tier 2 — Medium-leverage (light tooling)

**4. Shared `tools/` scripts for the 2-3 most common output formats**
- `scrape-to-sheet.py` — single-function convenience wrapper: URL list + schema → Sheet
- `deal-compare.py` — takes scraped rows across sites, normalizes, ranks
- Keep these ONLY when recipes get repetitive; not speculative.

**5. Add `agent-browser` skill as a documented escalation**
Don't install Browserbase yet. Just document that if Firecrawl fails, escalate via `agent-browser`. Riccardo already has the skill globally; no setup needed until first real need.

### Tier 3 — Only when a concrete recurring job appears

Everything else (Trigger.dev jobs, D1/R2, diff alerts, proxies, SerpAPI) waits for a real workload. If a specific monitoring job emerges ("watch Zillow for 2-bed flats under £300k, Slack me when new match"), build THAT, not generic infra.

---

## Comparison to my original gut answer

| My earlier gut answer | Reality check |
|---|---|
| Add Browserbase MCP | Premature — no failure hit yet |
| Add SerpAPI | Wrong use case — not doing SEO |
| Persist to R2 + D1 | No data-volume need for ad hoc |
| Trigger.dev scheduled crawls | No recurring jobs exist |
| Residential proxies | Speculative |

**Gut answer was optimized for a scraping platform, not for Riccardo's actual ad hoc consumer workflow.** That's exactly why brainstorming before answering mattered.

---

## Recommended next step (lowest effort, highest leverage)

Seed `WebScraper/workflows/` with 3 recipes based on real jobs Riccardo has already done or wants to do:
1. `property-search.md`
2. `deal-hunter.md`
3. `review-aggregator.md` (or whatever fits the next real need)

Plus one short doc: `WebScraper/docs/escalation-ladder.md`.

That's it. No MCP installs, no code, no infra. Grow the library as real jobs arrive.

---

## Success metric

"Did the next ad hoc scrape job take noticeably less setup time than the last one?" If yes, the recipe layer is earning its keep.

---

## Unresolved questions

- Which 3 recipes would actually match the next real job Riccardo has in mind?
- Does the `weekly-pulse/` pattern (root-level project folder) fit better than WebScraper for long-lived scrape-driven projects (e.g. an ongoing property hunt)?
