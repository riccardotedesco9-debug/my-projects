# Catalogue Enrichment Engine — Briefing (portable)

A reusable, **accuracy-first** pipeline that takes a POS/e-commerce product export (name, barcode, type, brand)
and fills, per product: **Description, Image URL, native Depth/Width/Height/Weight, and (for edibles)
Ingredients/composition** — then hands a human a colour-coded **curation workbook** to review and finalise before
upload. Built for a pet shop's Hike POS catalogue, but the engine is generic; only a handful of domain knobs are
pet-specific (see *Adapting to a new catalogue*).

## The one rule: accuracy > coverage
"False advertising is worse than no advertising." Nothing unconfirmed is ever shown as confirmed. Each enriched
field carries its OWN trust tier:

- **GREEN = the exact product, proven by a unique identifier** — a barcode/GTIN (or brand article code) confirmed
  literally against the source (on the page, in structured data, in an image filename, or returned by a
  barcode-keyed database). A flavour/protein/name match alone is NEVER green.
- **YELLOW = plausible but unverified** — a vision-confirmed image, a name match, a brand-site or 2-source
  composition, or a generic-from-name description. A human checks it.
- **RED = missing** — needs manual sourcing. (A best-guess candidate may be surfaced but stays flagged red.)
- **N/A (grey)** — field doesn't apply (e.g. ingredients on a non-edible).

Row **Status** = the weakest field present: all green → **READY**, any yellow → **REVIEW**, any red → **HOLD**
(an N/A field never drags a row down).

## Pipeline (6 steps; Python; reads secrets from a gitignored `.env`)
1. **`read-catalog.py`** — parse the source xlsx → `.tmp/catalog.json` (one record/row: cleaned name, barcode,
   type, brand). *(Domain-specific: the column mapping.)*
2. **`resolve-images.py`** — the engine. Per product, runs the source cascade below to fix identity + image
   (+ grounding text for the description, + edible composition). Resumable, per-row checkpoint, hard credit cap,
   parallel (`--workers`), optional `--vision` quality/identity gate.
3. **`gen-descriptions.py`** — Claude writes a warm, accurate 1–2 sentence description + extracts
   Depth/Width/Height/Weight (only when explicitly stated) + the full Ingredients (composition + analytical
   constituents) for edibles. Hard no-fabrication; grounded ONLY in the real scraped text from step 2; description
   and ingredients must not duplicate each other; no em/en dashes (they read as AI-written).
4. **`normalize-images.py`** — download each chosen image, flatten transparency to white, trim the border and
   scale the product to fill the frame, square it, save JPG ≤1 MB (uniform, never cropped, Hike-acceptable).
5. **`assemble.py`** — `--preview` builds the **curation workbook** (embedded thumbnail + identity, then each
   enriched field beside its own `Tier — how` clickable source cell, per-field colour, worst-field Status).
   Default mode edits the source xlsx in place with Hike-named columns + native dims for a clean 1:1 import.
6. **`make-preview-pdf.py`** — optional review PDF.

## The source cascade (most → least reliable, per field)
Every step that confirms the unique identifier is GREEN; vision/name is YELLOW.

- **Image / identity:** Barcode Lookup (paid, key-gated) → OpenPetFoodFacts → UPCitemdb → Firecrawl barcode
  image-search + page-confirm → Firecrawl EAN web-search → og:image → Firecrawl name-search + **vision** confirm
  (`verified-visual`, yellow) → name fallback (`likely`, yellow) → best-guess (red) → blank.
- **Ingredients (edibles):** barcode-keyed DB (OpenPetFoodFacts) → composition on the barcode-confirmed page →
  barcode-confirmed supplement page (`verified:<dom>`) → brand-site flavour-match (`official`) → 2 independent
  sources agree (`cross`) → single retailer e.g. zooplus (`supplemented`) → red. *Barcode databases rarely carry
  pet-food composition — most ingredients come from the manufacturer/retailer scrape; expect a real ceiling here.*
- **Description:** grounded on the barcode-confirmed page (green) → supplemented/name-matched page (yellow) →
  generic-from-name (yellow) → empty (red, ~never).
- **Dimensions:** stated in the product NAME → on the confirmed page → blank. *(Commercial-DB dimensions are
  unreliable shipping weights — deliberately ignored.)*

## Sources & cost levers
- **Free, no key:** OpenPetFoodFacts (`world.openpetfoodfacts.org/api/v2/product/<ean>.json`) — barcode-keyed
  image + (sometimes) ingredients + label photo + net weight; UPCitemdb free tier (image). All fail-open.
- **Firecrawl** (`FIRECRAWL_API_KEY`) — image/web search + page scrape. The workhorse. NB: a search costs 2
  credits but the API reports 0, so the in-script counter floors searches at 2 to stay honest.
- **Anthropic** (`ANTHROPIC_API_KEY`) — Sonnet vision (image quality/identity) + the description writer.
- **Barcode Lookup** (`BARCODELOOKUP_API_KEY`, paid) — optional PRIMARY image/identity source; best coverage incl.
  non-food. Metered per successful (HTTP-200) call; monthly quota resets; the engine preflights `/v3/rate-limits`,
  counts calls, backs off on 429, and disables itself fail-open on quota/auth failure. **No ingredients; its
  dimensions are ignored.**
- The whole barcode-DB layer is key-gated: with no Barcode Lookup key the free DBs + Firecrawl carry the cascade.

## Adapting to a NEW catalogue (different company / products)
The engine, tiers, cascade, vision gate and workbook are **generic — reuse as-is**. Only these knobs are
domain-specific; change them and re-point `read-catalog.py` at the new export:

| Knob | Where | What to change |
|---|---|---|
| Column mapping | `read-catalog.py` | map the new export's columns → name/barcode/type/brand |
| What counts as "edible"/needs-ingredients | `EDIBLE_TYPE` regex (`resolve-images.py`, `assemble.py`) | the consumable categories for the new vertical (or whatever field needs a composition) |
| Category relevance | `PET_SIG` / `OFF_DOMAIN` (`resolve-images.py`) | in-category vs wrong-category keywords/domains for the new vertical |
| Brands' official sites | `OFFICIAL_DOMAINS` (`resolve-images.py`) | the new brands → their domains (used to rank + tag `verified-official`) |
| Big retailers for composition/specs | `PET_RETAILERS` (`resolve-images.py`) | the new vertical's major retailers (the supplement targets these) |
| Barcode databases | `barcode_db_lookup` (`resolve-images.py`) | OpenPetFoodFacts is pet-food-specific — swap in the vertical's equivalent open DB if one exists; Barcode Lookup / UPCitemdb are generic and stay |

Everything else (identity confirmation, GTIN matching, the per-field tier logic, the description writer's
no-fabrication rules, normalization, the workbook) is vertical-agnostic.

## Outputs & what's NOT included
- **Outputs:** a Hike-import workbook (Hike-named columns + dims) + a curation workbook (per-field tiers,
  clickable sources, Status) + normalized square JPGs in `.tmp/normalized*/`.
- **Not included (separate phase):** hosting the normalized images on a stable URL (e.g. Cloudflare R2) and the
  POS/Hike API upload. The workbook gives Image URLs + local JPGs for manual upload meanwhile.
- **Image licensing:** product photos from manufacturer/retailer/DB sources are third-party imagery (open-licensed
  for OpenPetFoodFacts; subscriber-licensed for Barcode Lookup). Using them in the shop's own catalogue of
  products it sells is standard retail practice — note it consciously when reusing elsewhere.

## Secrets
Read from the gitignored workspace-root `.env` (`set -a; . ../../.env; set +a`, or a PowerShell loader): needs
`FIRECRAWL_API_KEY`, `ANTHROPIC_API_KEY`, optionally `BARCODELOOKUP_API_KEY`. Canonical in 1Password
(`AI-Stack`); regenerate `.env` with `node ../../tools/op-to-env.mjs`. Never commit keys.
