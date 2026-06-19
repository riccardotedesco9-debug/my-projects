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
`set -a; . ../../.env; set +a` then run the script (needs `FIRECRAWL_API_KEY`, `ANTHROPIC_API_KEY`).
Regenerate `.env` from 1Password with `node ../../tools/op-to-env.mjs` if a key rotates. (`op run
--env-file="../../.env.tpl" -- <cmd>` still works as a backup but its approval popup is unreliable here.)

1. `read-catalog.py` — parse the source xlsx → `.tmp/catalog.json` (one record/row; cleaned name, barcode, type, brand).
2. `resolve-images.py` — **the engine.** Per product: barcode (EAN) web-search → scrape candidates → confirm
   the EAN (or brand article code) literally on-page. Identity tiers `verified-official` > `verified-cross` >
   `verified` (all barcode/code-confirmed = green) > `verified-visual` (vision-only) / `likely` (name match) =
   yellow > blank. Image-quality gate (live, ≥250px short side, ≤3:1). For an **edible** whose confirmed page
   lacks a composition, it *supplements*: searches the brand's official site first **and reuses the domain that
   already confirmed the product**, re-confirming the barcode there before adopting ingredients (stores
   `ingredients_url` for provenance). Every green rests on a unique-identifier match — interconnected so identity,
   image, description and ingredients all trace back to the same confirmed product. Resumable, per-row
   checkpoint, hard `CREDIT_CAP`. Uses `FIRECRAWL_API_KEY` (+ `ANTHROPIC_API_KEY` for the `--vision` check).
   NB: the printed credit total under-counts Firecrawl search calls (~1.7× real — see Status).
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

## Status (June 2026)

Engine + scripts built, reviewed, and validated on a 250-product stratified sample. Output restructured for
Hike: a full Hike-import workbook **+** a verification-first **curation workbook** — image-first, **per-field**
tier colour (each of Description / Ingredients / Image carries its own `Tier — how` source cell, clickable),
a worst-of-fields **Status** (all green = READY · any yellow = REVIEW · any red = HOLD), structured
Depth/Width/Height/Weight, and an **EDIBLE** classifier (food + treats/chews/bones/dental → must carry an
ingredient list; green only on a barcode/article-code match). `normalize-images.py` trims the white border and
scales the product to fill the frame (~86% long-side, capped upscale) then squares to JPG ≤1 MB.
**Full 9,817 run not yet authorised** — awaiting go. Working data in `.tmp/` (disposable, regenerated).
Est. full run **~$250** (Anthropic ~$155: Sonnet vision + descriptions · Firecrawl ~100–120k credits ≈ one
Standard month $83). NOTE: the in-script credit counter under-logs Firecrawl **search** calls (they cost 2
credits but report 0), so real spend is ~1.7× the printed number — size the Firecrawl plan accordingly. Image
hosting (Cloudflare R2) + the Hike API upload happen at the upload stage, after curation.

## Don'ts
- Never upload the internal catalogue to an external CDN/service without explicit OK (it's private business data).
- Secrets live in the gitignored workspace-root `.env` (canonical in 1Password) — never commit them, never paste a key into chat or logs.
- Never present a `likely`/`blank` image as confirmed.
