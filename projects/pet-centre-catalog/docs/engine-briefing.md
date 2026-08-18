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

Colours are per FIELD, never per row — an image can be green beside a yellow description, and that is
correct, not a bug. `finalize-workbook.py` now enforces the contract in code (`check_colour_rule`) and
refuses to report a clean run when it does not hold: green requires an actual value AND a factual
confirmation, red requires the field to be genuinely empty, yellow requires something to review.
When comparing fills, normalise the RGB: a locally written workbook uses `00RRGGBB` and one
round-tripped through Drive uses `FFRRGGBB`, so a full-string comparison silently matches nothing and
reports a clean bill of health on a workbook it never inspected.

Row **Status** = the weakest field present: all green → **READY**, any yellow → **REVIEW**, any red → **HOLD**
(an N/A field never drags a row down).

## Pipeline (Python; reads secrets from a gitignored `.env`)
1. **`read-catalog.py`** — parse the source xlsx → `.tmp/catalog.json` (one record/row: cleaned name, barcode,
   type, brand). *(Domain-specific: the column mapping.)*
2. **`resolve-images.py`** — the engine. Per product, runs the source cascade below to fix identity + image
   (+ grounding text for the description, + edible composition). Resumable, per-row checkpoint, hard credit cap,
   parallel (`--workers`), optional `--vision` quality/identity gate.
2b. **`merge-names.py`** *(scan-sourced catalogues only; lives in the CLIENT project)* — writes the
   resolver's `name_found` back onto the catalogue rows as `name`/`clean`. A POS export arrives with a
   name; a scan has none until step 2 confirms one, and steps 3-7 all read `clean`. Deliberately does
   not guess brand or type. **Ordering hazard:** step 2c rewrites `clean` in place on this step's own
   output file, so re-running 2b alone used to hand the English names back to their foreign originals,
   visible only as a quiet drop in type/category/collection matches. It now carries a prior run's
   translations forward, keyed on `name_original` still matching the confirmed name.
2c. **`translate-names.py`** *(scan-sourced catalogues)* — renders confirmed names in English, keeping
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
   enriched field beside its own `Tier — how: host` clickable source cell, per-field colour, worst-field
   Status). `where_from()` appends the source HOST to each label, because the tier says how strong the
   evidence is and the method says what kind, but neither said WHERE — so a photo proven by the barcode on
   one site beside a description written from a name match read as a single verdict until you clicked both
   links. It skips the suffix when the label already names that source ("Barcode Lookup (barcode)").
   Default mode edits the source xlsx in place with Hike-named columns + native dims for a clean 1:1 import.
6. **`make-preview-pdf.py`** — optional review PDF.
7. **`export-shopify.py`** *(Shopify clients)* — the catalogue in Shopify's current import schema:
   evidence-derived Vendor/Type/Product category/Collection/Tags, an Ingredients metafield for food, and
   Price/Inventory/SKU deliberately blank. Everything imports as `draft`, unpublished.
8. **`finalize-workbook.py`** *(lives in the CLIENT project; generic, every path is an argument)* — folds
   the Shopify CSV in as a second tab, adds a tab for scanned codes that carry no product barcode, sizes
   every row and column so nothing is clipped, attaches the colour-contract notes, and ASSERTS the
   contract (no green without a factual confirmation) rather than trusting it.
9. **`publish-workbook.mjs`** *(client project)* — uploads the .xlsx and lets Drive convert it, so the
   Sheet shows real embedded photos with no image hosting and no `=IMAGE()`. Updates the same Sheet id
   in place, so a link already shared keeps working.

### Which stage owns what (read before adding anything)
The stages are a hierarchy of increasing commitment, and new work belongs at the EARLIEST stage that has
the evidence for it. Getting this wrong is how a fix ends up invisible or duplicated.

| If the change is about… | It belongs in | Because |
|---|---|---|
| where a fact comes from, or a new source | step 2 (`resolve-images.py`) | tiers and provenance are decided once, at resolution |
| normalising an incoming name | step 1 / 2 (`clean_name`, `tidy_name`) | so every later artifact sees the clean value |
| what English the customer reads | step 2c | after identity, before anything classifies on words |
| prose or extracted numbers | step 3 | the only stage allowed to write sentences |
| how a field is DISPLAYED or explained | step 5 (`assemble.py`) | presentation, derived from resolved data, never re-deciding it |
| a Shopify-shaped concern (category, collection, handle, SKU) | step 7 | the schema boundary, and the only place that knows the store |
| layout, extra tabs, or a contract assertion | step 8 | the last writer before the deliverable is published |

Two rules that fall out of this: **never re-decide identity in a later stage** (a display stage that
"corrects" a name is a silent data change), and **never write a cell in a way a spreadsheet can execute**
— both step 5 and step 8 call `defuse_formulas`, because both write cells and the input is scraped text.

### Proving it still works on a catalogue it was not built for
`python test-multi-vertical-stress.py` — offline, free, no keys, a few seconds. It runs steps 7 and 5
over a fixture of food, electronics, apparel, non-Latin names, colliding names, a 300-character title
and spreadsheet-injection payloads, then asserts the properties that must hold for ANY vertical: no
invented category or collection outside the configured one, unique non-empty handles and SKUs, no
newline in a CSV cell, hostile titles preserved verbatim rather than rewritten, zero live formulas in
the workbook, and unidentified rows skipped from the export but still present in the review workbook.
**Run it after touching steps 5 or 7.** It is the cheapest way to catch the failure this engine cares
about most: not a crash, but a confident wrong answer on a product nobody tested.

Two practical notes. The fixture writes under `.tmp/` in the project tree rather than the system temp,
and the injection payload is assembled at runtime instead of stored as a literal, both because
antivirus quarantines the classic spreadsheet-DDE string on sight — that surfaced as an unexplained
"permission denied" on fixture files before the cause was understood.

## The exhaustion ladder (2026-08-18): red must mean "nothing exists", never "we stopped"
A row that is not verified escalates until something is adopted or the avenues genuinely run out;
a verified row still stops instantly. What changed, and why each piece exists:
- **Article codes from the CONFIRMED name** (`working_ref_from`): the old extractor was anchored to
  the start of the ingest name, so "Bestway **58094** Pool Filter" carried an invisible code — and a
  scanned row had no ingest name at all. Codes now unlock a brand+code image search AND literal
  code-confirmation on pages (len>=5 letter-bearing codes may confirm without brand tokens).
- **Query ladder** replacing the one-shot name search: brand+code -> full name -> simplified name
  (sizes/pack counts stripped) -> the name translated to English (one Haiku call, key-gated, only
  when the earlier rungs found nothing and the name looks foreign). Each rung ~2 credits.
- **Per-stage exception isolation**: one shared try/except used to let a Stage-1 error silently skip
  Stages 2-3.
- **A low-quality DB image no longer ends the search** — kept as fallback while the ladder hunts a
  cleaner equally-verified photo.
- **eBay depth**: up to 3 barcode-in-title listings, then a brand+code keyword form that REQUIRES a
  vision pass to adopt. Still yellow-capped, still outside cross-verification.
- **Variant policy (owner decision)**: vision reports `variant` (same product line, different pack
  size/count) separately from `match`; a confident variant is adopted as `likely` with
  `img_quality="variant"` and an explicit "variant pack shown, verify size" label + hover note.
  Never green, never silent.
- **Confirmed-page salvage**: a page that literally confirms the GTIN but has no usable photo still
  contributes its text as GREEN description grounding (`desc_provenance="source"`). Gated away from
  barcode DIRECTORIES: a directory search page passes the GTIN check while its text describes other
  products entirely (measured: a perfume grounding a pool row) — salvage requires a non-reseller
  domain AND a tidy page name.
- **The attempts log**: every non-green row records [(stage, query, outcome)]. The red cell cites
  the count ("searched, none found (7 avenues tried)"), the hover note lists them. Red is provable.
- **Deterministic measurements** (`gen-descriptions.py measure_fallback`): regexes fill what the
  model left null, under review-hardened rules — a page mass counts ONLY with a weight-word anchor
  ("Net weight/Gewicht/Inhalt... X kg"; a bare "20kg" in page chrome is usually a sidebar's other
  product), litres are never kilograms, a name's capacity rating ("for dogs up to 15 kg") is not a
  weight, dimensions come from the NAME only (page chrome fabricated a 0.1 cm width) with a >=1 cm
  floor, and the ambiguous "A x B x C" form is refused. `dims_src` records netwt/page/name/model per
  field; the workbook colours netwt+name green, page/model yellow.
- **No white cells** (`finalize-workbook.colour_derived`): Name, Brand, Type, Tags and the four
  measurements now carry their evidence tier; a derived or model-only value can no longer look
  identical to a confirmed one. Row Status still counts Image/Description/Ingredients only.
Known caution: a junk name harvested from a GTIN-bearing junk page can steer the ladder and vision
toward junk (observed once: a loyalty-card page). The literal-GTIN gate keeps it out of GREEN; the
curation review is the backstop for yellow. Merging fresh runs into a curated deliverable must
never downgrade a tier and never overwrite curated names.

## The catalogue profile: vertical knobs in ONE file (2026-08-18)
`CATALOG_PROFILE=<path>.json` supplies: `signal_tokens` (scoring boost), `off_domains` (penalty),
`comp_retailers` (composition-scoped paid searches), `edible_regex`, `off_hosts`, `persona`
(description writer), `query_hint`. **With no profile the engine is vertical-NEUTRAL**: no signal
scoring, no off-domain penalty, no retailer-scoped searches, a generic edible regex, both
Open(Pet)FoodFacts hosts tried. `profiles/pet-centre.json` reproduces the historic pet behaviour —
**pet catalogue runs MUST set it** or scoring/personas silently change. assemble.py reads the same
profile for its edible test (the old duplicated regex could drift). The stress test asserts
neutrality and the single-source edible definition.

## Guarding the IMAGE against non-products
A URL and a size gate cannot tell you what a picture shows, and two failure modes get through them:

- **Marketplace placeholders.** A dead or image-less eBay listing serves eBay's own wordmark at a
  normal size and content-type. Nothing in the filename says "logo". `looks_like_placeholder()`
  (`resolve-images.py`) catches these for free: a dHash blocklist (structure, so it survives rescaling
  and re-encoding — add a hash when a new one appears) plus a "sparse banner" rule, wide frame with
  almost no ink. Measured on a real 30-image batch it rejected the placeholder and nothing else. A hit
  is rejected outright, not flagged — a logo is never a worse photo of the product, it is not the
  product — so the row falls through to the next candidate or to blank.
- **Wrong or cropped products.** No cheap rule sees these. `audit-images.py` vision-checks the images a
  run ALREADY resolved (no Firecrawl, no barcode-DB calls, no re-resolution): ~$0.006/image, so ~$0.20
  for 30 and ~$1.50 for a 229-product catalogue. It FLAGS (`img_quality`, `img_audit`) and never swaps
  or deletes, because deciding a photo is wrong is a judgement and judgements go to a human.
  **Expect false positives** — on the first real batch it flagged 3 of 30 and only 1 was genuinely
  wrong (an Aiper robot illustrated with a different brand's manual vacuum); the other two were the
  correct product, flagged over a pack-count difference and a brand nuance. Treat it as a shortlist to
  eyeball, not a verdict.

**Re-resolving a row invalidates its normalized thumbnail.** `normalize-images.py` is resumable and
skips `<row>.jpg` if it exists, so after fixing an image you must delete that file or the workbook
keeps embedding the old picture.

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
- **Open Icecat** (`ICECAT_USERNAME`, free) — barcode-keyed, manufacturer-approved data sheets, so it sits
  in the GREEN cascade beside Barcode Lookup. **Live since 2026-08-16 and measured, not assumed.**
  - Register on the **Channel Partner** tab (retailers/resellers *consuming* data). Brand Partner is the
    opposite: manufacturers publishing their own content in. https://icecat.biz/en/registration
  - **No credential beyond the shopname** — verified byte-identical 200s with and without auth headers,
    so nothing is stored, nothing expires. The Access Tokens page issues `api-token` / `content-token`,
    which are **HEADERS** (a token passed as a query parameter is silently ignored) and exist for Full
    Icecat and private assets; this code stays on public gallery entries and needs neither.
  - Request form, per the [JSON manual](https://iceclog.com/manual-for-icecat-json-product-requests/):
    `?shopname=<user>&lang=en&GTIN=<ean>&content=essentialinfo,gallery`. An earlier build used
    `UserName` / `Language` / `Content`, which the API does not accept — every call 403'd.
  - `StatusCode 16` = GTIN absent. `StatusCode 9` = the product IS there but behind paid **Full Icecat**,
    whose `app_key` is issued to Full subscribers on request. Both fail open.
  - A record is accepted only when the GTIN list it returns contains the code requested, keeping
    "green = found literally" true. Names come back as brand + model code + title.
  - **Measured coverage, 44 pool-goods GTINs: 3 open, 5 full-only, 36 absent — and all 8 covered rows
    already had a name and a photo, while the rows still missing something got zero hits.** Skewed hard
    to IT and consumer electronics. Keep it wired (free, fails open), but never plan around it, and do
    not buy Full Icecat for a non-electronics catalogue on the strength of it.
  - Queried on EVERY row (since 2026-08-18), even when Barcode Lookup already returned an image: the
    IMAGE short-circuit still stands, but the QUERY is evidence — a second GTIN-keyed database holding
    a record for the same code upgrades the tier to `verified-cross` via `db_tier()`, provided the two
    records' names actually agree (a shared token). Two DBs contradicting each other stay at plain
    `verified`: contradiction is a reason to look harder, not to trust more.
- **eBay Browse** (`EBAY_CLIENT_ID` + `EBAY_CLIENT_SECRET`, free) — barcode search across a global,
  all-category marketplace, which is exactly the long tail the free databases miss.
  **Do NOT use the documented `gtin=` filter — it is dead.** Measured 2026-08-18: it returns total:0
  on every marketplace (GB/DE/IT/ES/FR/US) even for a product eBay demonstrably sells. The barcode is
  sent as a plain `q=` keyword instead, and a result is accepted only when the code appears LITERALLY
  in the listing title. eBay never joins cross-verification: its GTIN is seller-asserted.
  **Capped at YELLOW on purpose**: eBay's GTIN field is filled in by the SELLER, not the brand owner, so
  a hit is a marketplace claim, not a manufacturer one. It runs only after every green avenue has failed
  and yields `likely`, or `verified-visual` when the vision gate confirms the photo.
  Register: https://developer.ebay.com/ · docs: https://developer.ebay.com/develop/api/buy/browse_api
  Both are fail-open no-ops until their keys exist — verified, so adding them cannot disturb a run.

### GS1 — authoritative, but MANUAL ONLY (do not spend time automating it)
The GS1 registry is the only source that can say who actually LICENSED a barcode, globally, for any
category. It would turn `Vendor` from an allowlist inference into a fact. It cannot be automated:
`gepir.gs1.org/api/gepir/v4/...`, the v3 REST path and the public Verified by GS1 result page all return
**403 to any programmatic client** (re-tested 2026-08-16). There is no self-serve developer portal, no
key form. Access is a human request to the national Member Organisation — for Malta,
**GS1 Malta, https://gs1mt.org, info@gs1mt.org** — and is often restricted to companies that license
their own prefix, which a reseller does not. The GS1 US Data Hub and GS1 UK GTIN Check APIs exist but are
scoped to their own markets and members, so neither helps from Malta.
Use it MANUALLY: the free web lookup (~30 searches, https://www.gs1us.org/tools/gs1-company-database-gepir,
queries the global registry despite the US domain) is the right tool for settling one disputed barcode,
e.g. a conflict over a model number between two sources. Do not scrape it.
What IS free and offline: the first 3 digits of an EAN-13 are the GS1 prefix and decode to the ISSUING
COUNTRY from a published static table. That is a cross-check (a German-branded product on a 69x Chinese
prefix is worth a second look), not a brand verifier — it never names the company.

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
