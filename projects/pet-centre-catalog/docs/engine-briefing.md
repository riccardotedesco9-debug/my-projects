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

## Pipeline (Python; reads secrets from a gitignored `.env`)
1. **`read-catalog.py`** — parse the source xlsx → `.tmp/catalog.json` (one record/row: cleaned name, barcode,
   type, brand). *(Domain-specific: the column mapping.)*
2. **`resolve-images.py`** — the engine. Per product, runs the source cascade below to fix identity + image
   (+ grounding text for the description, + edible composition). Resumable, per-row checkpoint, hard credit cap,
   parallel (`--workers`), optional `--vision` quality/identity gate.
2b. **`translate-names.py`** *(scan-sourced catalogues)* — renders confirmed names in English, keeping
   brands/model codes/measurements verbatim and rejecting any translation that drops one. Needed because
   a GTIN is just as validly confirmed on a foreign-language retailer page, but a storefront sells in one
   language. Also lifts downstream type/category matching, which keys on English words.
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
7. **`export-shopify.py`** *(Shopify clients)* — the catalogue in Shopify's current import schema:
   evidence-derived Vendor/Type/Product category/Collection/Tags, an Ingredients metafield for food, and
   Price/Inventory/SKU deliberately blank. Everything imports as `draft`, unpublished.

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

## Catalogues with NO product names (a barcode scan rather than a POS export)
Added 2026-08-16, first used by `projects/splashstore/` (garage stock scanned straight off the shelf).
A POS export supplies the name; a scan supplies only the code, so the engine detects a nameless row
(`not (core or bt)`) and adapts — no separate script, no fork:

- **Barcode directories are queried first** (`BARCODE_DIRECTORIES`: ean-search.org, barcodelookup.com).
  They are deterministic per-GTIN URLs, so they cost no search credit, and they print the code literally
  so the normal confirmation applies. This matters because a bare-number web search ranks near-random
  products when there is no name to score candidates against.
- **The confirmed page's own product name is captured** (`_page_name` → `note_name` → `rec["name_found"]`
  + `rec["name_sources"]`), ranked so a manufacturer/shop page beats marketplace keyword soup
  (`RESELLER`). A page that proves the GTIN but shows no usable photo still records the name — for a
  scanned row the name IS the primary unknown, so that is a partial success (`reason:
  "identified-no-image"`), not a miss.
- **The name-image-search stage is skipped** when there is no name: its query would be empty, which the
  API rejects, and the row then errored through every retry sweep instead of resolving on its barcode.
- **`tidy_name()` guards the new failure mode.** A directory's "no record" page still prints the searched
  code, so it passes the GTIN check; its title ("Barcode Not Found", a bare "EAN <code>") must never be
  mistaken for a product name — that would report a miss as an identification. It also strips directory
  chrome ("EAN <code> - …", "… | EAN-Search.org") and `_clean_text` decodes entities/tags. **Any new
  source needs its empty-state title added here.**

Measured on 44 scanned pool/spa GTINs with Barcode Lookup unavailable: **41 identified (93%)**, 20 with an
image, ~7 Firecrawl credits per code. `--vision` is pointless here — it judges an image against a claimed
name, and there isn't one.

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
| Shopify Type / Vendor / tags | `PRODUCT_TYPES`, `BRANDS`, `CATEGORY_TAGS` (`export-shopify.py`) | the new vertical's category words + brand allowlist. All are matched LITERALLY against the confirmed name, so a new vertical means new words, not new logic |
| Shopify product category | `SHOPIFY_CATEGORY` (`export-shopify.py`) | map each Type to a Shopify taxonomy id from `Shopify/product-taxonomy` `dist/en/categories.txt`. Pool/spa lives under `hg-18-*`; **food is `fb-*`**. Never invent a breadcrumb — this column drives tax |

### Switching to a FOOD catalogue specifically
The engine was built on pet food, so the food path is the well-trodden one, but three things must move
together or composition silently goes missing:
1. **`EDIBLE_TYPE`** (`resolve-images.py`, `assemble.py`) must match the new vertical's consumable
   categories — it is the switch that makes the engine chase ingredients at all.
2. **The barcode DB**: `world.openpetfoodfacts.org` is pet-food-only. Human food is
   `world.openfoodfacts.org` — identical API shape, so only the host changes in `_off_family`.
3. **Ingredients become the important column**, not an afterthought: they carry a legal obligation on a
   live listing. They already flow to the curation workbook and to the Shopify
   `Ingredients (product.metafields.custom.ingredients)` metafield. Expect a real ceiling — public
   composition data runs ~20% green / ~45% red even on pet food, so budget manual sourcing.

Everything else — identity confirmation, GTIN matching, tiering, normalization, the workbook, the
Shopify CSV writer — is vertical-agnostic and needs no change.

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
