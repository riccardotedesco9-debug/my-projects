---
status: pending
created: 2026-04-17
---

# Plan — WebScraper Empowerment for Unknown Use Cases

## Context

The 3 recipes seeded earlier (property-search, deal-hunter, review-aggregator) cover a tiny slice of Riccardo's actual ad hoc scraping needs. Most future use cases are unknown. Question: how to empower WebScraper for jobs that don't exist yet?

Refined brainstorm conclusion: the gap isn't **principles** (Claude has those from training), it's **concrete tool-selection knowledge** at decision time. Three decisions determine whether an ad hoc scrape succeeds:
1. Which Firecrawl method to use
2. What *shape* the job is
3. What output shape fits

Empower those three decisions = empower every future use case. Recipes are a consequence, not the mechanism.

## What this plan does

Replace the recipe-centric workspace with a **decision-support + examples** workspace:
- 3 new docs that give Claude concrete tool-selection knowledge
- Demote the 3 recipes to examples (concrete illustrations, not canonical jobs)
- Update `CLAUDE.md` so Claude loads decision-support at session start
- Make recipe promotion a user-triggered action, not automatic

## Scope (small)

5 file operations. No code. No infra.

## Phases

### Phase 1 — Create decision-support docs (3 new files)

**1a. `WebScraper/docs/firecrawl-playbook.md`** — Firecrawl method selection guide
Covers: `scrape`, `extract`, `search`, `crawl`, `map`, browser sessions. For each: when to use, when NOT to use, concrete trigger phrases, tuning knobs. Short — decision tree style.

**1b. `WebScraper/docs/scrape-patterns.md`** — the 5 job shapes
Shapes:
- List-of-items (search + extract, array schema)
- Single-entity deep-dive (scrape + extract, object schema)
- Cross-source synthesis (search + multi-scrape + LLM synthesis)
- Discovery-first (search → map → targeted extract)
- Change-detection (hash + re-scrape + diff)

Each shape: identifier ("if the ask sounds like X, it's this shape"), Firecrawl method, starter schema template, common pitfalls.

**1c. `WebScraper/docs/output-patterns.md`** — 3 output shapes
- Google Sheet (comparison, tabular, ranked)
- Markdown report (synthesis, verdict-style)
- JSON dump (downstream pipeline)

When to pick each + formatting conventions.

### Phase 2 — Demote the 3 seeded recipes

Move from `workflows/` to `workflows/examples/`:
- `property-search.md`
- `deal-hunter.md`
- `review-aggregator.md`

They remain useful as concrete illustrations of the patterns.

### Phase 3 — Update `WebScraper/CLAUDE.md`

- Point to the 3 decision-support docs as the primary orientation for any scrape job
- Explain the job flow: identify shape → pick Firecrawl method → pick output shape → run (using an example recipe if one matches)
- Explicitly frame `workflows/examples/` as illustrations, and `workflows/` as "jobs you've run 2+ times and want reusable"
- Add brief note: "to promote an example to a recipe, say 'make this a recipe'"

### Phase 4 — Verification

Next ad hoc scrape job:
1. Does Claude reference the 3 docs in its reasoning?
2. Does it pick the right shape and Firecrawl method?
3. Does the job complete faster / cleaner than pre-plan?

If yes → working. If no → docs are too abstract; revisit with concrete fixes.

## Files

**Create:**
- `WebScraper/docs/firecrawl-playbook.md`
- `WebScraper/docs/scrape-patterns.md`
- `WebScraper/docs/output-patterns.md`

**Move:**
- `WebScraper/workflows/{property-search,deal-hunter,review-aggregator}.md` → `WebScraper/workflows/examples/`

**Edit:**
- `WebScraper/CLAUDE.md` — rewire Workflow + Recipes sections

## What this is NOT

- Not adding any MCP servers, Trigger.dev jobs, D1/R2 persistence, or Browserbase
- Not a code change
- Not an auto-growing recipe system (explicit user-triggered promotion only)

## Success criteria

- Three decision-support docs exist and are referenced from `CLAUDE.md`.
- Examples folder has the 3 demoted recipes.
- Next unknown-shape scrape job: Claude can orient itself without asking "what format do you want" — it identifies shape + method from the docs.

## Unresolved questions

- Output doc: Google Sheet as default vs offering 3 options every time? (Default to Sheet for tabular jobs, markdown for synthesis; ask only when ambiguous.)
- Pattern-to-shape identification: who does it — Claude from user's phrasing, or explicit user declaration? (Default: Claude infers, confirms with user in one line before running.)
- Should `scrape-patterns.md` include ALL 5 shapes upfront or start with the 2-3 most likely to be used? (Start with all 5; they're cheap to document once.)
