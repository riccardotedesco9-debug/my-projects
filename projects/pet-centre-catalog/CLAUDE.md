# CLAUDE.md — pet-centre-catalog

Domain: Engineering — lives in `projects/` (uses global + Engineering skills/agents).
> Pet Centre family: `pet-centre-marketing` (strategy/research) · `pet-centre-website` (the storefront build) · **`pet-centre-catalog`** (this — Hike POS catalogue enrichment).

Enriches Riccardo's full **Hike POS** product catalogue (`C:\Users\Riccardo\Downloads\Product List Desc.xlsx`,
~9,817 products) so it can be re-imported into Hike: fills **Description** and **Image URL**, extracts native
**Depth / Width / Height / Weight**, and (for edibles) the full **Ingredients** / composition. The human-facing
deliverable is a **curation workbook** where every enriched field is tier-tagged so a person can review and
finalise it fast before upload.

**Overriding rule: accuracy > coverage.** "False advertising is worse than no advertising." Nothing
unconfirmed is ever presented as confirmed. The tier system is the spine of the whole project:
**GREEN = the exact product, proven by a unique identifier** (barcode/GTIN or brand article code confirmed
literally on the page) — a flavour/protein/name match alone is never enough. **YELLOW = plausible but
unverified** (vision-only image, name match, brand-site or 2-source composition) → a human checks it.
**RED = missing** → manual sourcing. Applied per field (Description, Ingredients, Image), not just per row.

## Pipeline (Python; run via the skills venv + a gitignored `.env` for secrets)

`~/.claude/skills/.venv/Scripts/python.exe`. Keys come from the workspace-root **`.env`** (no popup):
`set -a; . ../../.env; set +a` then run the script (needs `FIRECRAWL_API_KEY`, `ANTHROPIC_API_KEY`; optional
`BARCODELOOKUP_API_KEY` for the paid primary image source). Regenerate `.env` from 1Password with
`node ../../tools/op-to-env.mjs` if a key rotates. **Portable engine briefing (architecture + how to re-point at
another company's catalogue): `docs/engine-briefing.md`.**

1. `read-catalog.py` — parse the source xlsx → `.tmp/catalog.json` (one record/row; cleaned name, barcode, type, brand).
2. `resolve-images.py` — **the engine.** Per product a most-reliable-first **source cascade** fixes identity +
   image: (Tier-0) the barcode-keyed databases — **Barcode Lookup** (paid, key-gated; best coverage incl. the
   non-food half) → **OpenPetFoodFacts** (free; also yields ingredients + the label photo + net weight) →
   **UPCitemdb** (free) — then Firecrawl barcode image/web search → scrape + confirm the EAN/article code
   literally (page text, structured data, or image filename) → name-search + `--vision` confirm. Identity tiers
   `verified-official` > `verified-cross` > `verified` (all barcode/code-confirmed = green) > `verified-visual`
   (vision-only) / `likely` (name) = yellow > blank. Image-quality gate (live, ≥250px short side, ≤3:1); a DB
   image short-circuits the paid Firecrawl image search. For an **edible** lacking a composition it *supplements*:
   the brand's official site + the domain that already confirmed it + the big pet retailers (zooplus etc.),
   re-confirming the barcode before adopting (stores `ingredients_url`; the label photo + composition trace to
   their real source even when a different DB supplied the image). Every green rests on a unique-identifier match.
   Resumable, per-row checkpoint, hard `CREDIT_CAP`, parallel `--workers`. Uses `FIRECRAWL_API_KEY` +
   `ANTHROPIC_API_KEY` (`--vision`) + optional `BARCODELOOKUP_API_KEY` (preflights its `/v3/rate-limits` quota,
   counts calls, 429-backoff, disables itself fail-open on quota/auth). The credit counter now books each
   Firecrawl search at its real 2-credit cost (the old ~1.7× undercount is fixed).
3. `gen-descriptions.py` — Claude Sonnet, batched, resumable. Hard no-fabrication; grounded in the real scraped
   page text from step 2. Emits `{description, depth, width, height, weight, ingredients}` — dims only when
   explicitly stated; ingredients (full composition + analytical constituents) only for edibles whose source
   gives them. Description and ingredients must not duplicate each other, and the prose avoids em/en dashes and
   needless hyphens (they read as AI-written) — enforced by prompt + a deterministic scrub. Uses `ANTHROPIC_API_KEY`.
4. `normalize-images.py` — per resolved image: download, flatten transparency to white, **trim the white border
   and scale the product to fill ~86% of the frame** (capped upscale so low-res sources don't turn to mush),
   square it, save JPG ≤1 MB. Fixes WEBP rejections, crop risk, and tiny/zoomed-out packshots.
5. `assemble.py` — two outputs. `--preview` builds the **curation workbook**: embedded thumbnail + identity, then
   Description / Ingredients / Image each beside its own `Tier — how` source cell (clickable, e.g. "Verified —
   barcode", "Likely — brand site: x.com", "Blank — missing"), per-field colour, and a worst-of-fields
   **Status** (all green = READY · any yellow = REVIEW · any red = HOLD). Default (full) mode edits the source
   xlsx in place with Hike-named columns + native dims for a clean 1:1 import.
6. `make-preview-pdf.py` — review PDF: thumbnail + name/brand/type + confidence + description + URL per row.

## Status (June 2026) — final max-reliability build

Engine + scripts built, reviewed (clean), and validated on stratified + mixed samples. Output: a Hike-import
workbook **+** a verification-first **curation workbook** (per-field `Tier — how` clickable sources, worst-field
Status, structured Depth/Width/Height/Weight, EDIBLE classifier, and an ingredients label-photo link).
Barcode-keyed **Barcode Lookup** is the primary image/identity source — measured **~75% coverage incl. the
non-food half** (toys/accessories, which free DBs and Firecrawl image weakly); it returns **no ingredients** and
its dimensions are unreliable shipping weights, so dims stay from the name/page.

**Two run tiers** (one-time; cancel subscriptions after):
- **Free-database model** — Firecrawl + free DBs only: ~77% images / ~80% descriptions / ~49% READY.
- **Max-reliability model** — + Barcode Lookup on every product: ~88% images (non-food covered) / ~58% READY.

Descriptions and ingredients are **identical across tiers**; **ingredients have a public-data ceiling**
(~20% green / ~45% red of edibles) that no spend lifts — ~20–25% of products need manual ingredient sourcing
regardless. **Full 9,817 run not yet launched** — gated on the owner activating the paid plans (a Firecrawl plan
covering ~100k credits; a Barcode Lookup plan covering the blanket run's successful lookups). Working data in
`.tmp/` (disposable). Scope ends at the workbook + normalized JPGs; image hosting (Cloudflare R2) + the Hike API
upload are a separate later phase. See `docs/engine-briefing.md` for the full architecture + reuse guide.

## Don'ts
- Never upload the internal catalogue to an external CDN/service without explicit OK (it's private business data).
- Secrets live in the gitignored workspace-root `.env` (canonical in 1Password) — never commit them, never paste a key into chat or logs.
- Never present a `likely`/`blank` image as confirmed.
