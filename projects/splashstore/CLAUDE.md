# CLAUDE.md — splashstore

Domain: cross-cutting — Engineering (Shopify backend, catalog/barcode pipeline) + Marketing (ad listings) work planned.

Client: **Splash Store Malta** — [splashstoremalta.com](https://splashstoremalta.com), Shopify since Jan 2022
(backing domain `hot-tub-and-pools-malta.myshopify.com`; several nav pages still on the raw myshopify domain).
Operated by **MC Imports and Trading** — direct Intex importer for Malta. ~**229 products / 246 variant SKUs**:
Intex 127, hot tubs (€1,470–6,200), pools, water chemicals (34 products, €9–110), pumps, inflatables.
Contact: info@splashstoremalta.com, +356 7905 2595 (WhatsApp). Warehouse: Triq Pietru Felici, **Qormi**.
Free Malta/Gozo delivery over €30; pickup from warehouse "once notified".

Operating model: **solo owner, no storefront** — the garage/warehouse is a **fulfilment station, not a POS till**.
Orders arrive on Shopify; owner picks stock, loads van, delivers himself; paid Revolut or cash. Everything is
currently manual — a Revolut/cash sale never decrements Shopify inventory (known gap; fix = free POS Lite custom
payment types, works offline). Garage Wi-Fi spotty/absent. Chlorine vapour corrodes electronics — devices never
live or charge in the chemical garage.

## Engagement roadmap
1. **Hardware setup research (2026-07, DONE & SETTLED)** — classic tablet + handheld lane, single pick:
   **Tab S10 FE €469 (Scan Malta) + Zebra DS2278 €199 + spare battery €52 + ZD230t printer €350 + PP labels
   (all iLabMalta) + M7350 router €69.90 + trolley €115 ≈ €1,500 day-one, ~90% from 3 Malta shops** (budget
   relaxed from the original €400–700; A11+ demoted to footnote). Ask iLab to quote the DS2278 cradle.
   Week-one gate: bench-test scan-to-cart + batch upload in the return window. Deliverables:
   `docs/tablet-scanner-setup-research.md` (§0 decision record, §10 linked Malta sourcing map, §13 red-team)
   + shared Artifact page (owner-facing) + `docs/research-raw/` evidence.
2. **Catalog capture (IN PROGRESS)** — owner scans garage stock; the barcode list feeds the portable enrichment
   engine from `projects/pet-centre-catalog/`. First batch done 2026-08-16: **41/44 GTINs identified**. See
   **Catalog capture workflow** below before touching this.
3. Then: Shopify catalog rebuild + ad listings.

## Catalog capture workflow (read this before running anything barcode-related)

**Do NOT rebuild a lookup engine.** The engine already exists and is the single implementation:
`projects/pet-centre-catalog/resolve-images.py` (architecture: its `docs/engine-briefing.md`). This project
only holds the scan-list front end. Iterate on the engine in place; never fork a parallel copy.

**Run the WHOLE pipeline, not just the lookup.** It is 10 steps and each one earns its place;
stopping after identification leaves descriptions, dimensions, normalised images and the curation
workbook on the table. Order (`python` = `~/.claude/skills/.venv/Scripts/python.exe`, from `catalog/`):

```bash
python read-scans.py                                    # 1. scans.txt -> ../.tmp/catalog.json (+ skipped, duplicates)
python ../pet-centre-catalog/resolve-images.py \
       ../.tmp/catalog.json ../.tmp/resolved.json 900 --workers 6   # 2. identity + image + grounding text
python merge-names.py                                   # 2b. resolved names -> catalog rows (scan-only bridge)
python ../pet-centre-catalog/translate-names.py        ../.tmp/catalog-named.json ../.tmp/catalog-desc.json # 2c. names -> English (storefront language)
python ../pet-centre-catalog/gen-descriptions.py \
       ../.tmp/catalog-desc.json ../.tmp/desc.json 20 ../.tmp/resolved.json   # 3. descriptions + D/W/H/weight
python ../pet-centre-catalog/normalize-images.py ../.tmp/resolved.json ../.tmp/normalized   # 4. square JPGs <=1MB
python ../pet-centre-catalog/assemble.py --rows ../.tmp/catalog-named.json \
       --desc ../.tmp/desc.json --img ../.tmp/resolved.json \
       --out ../docs/splashstore-scan-curation-<date>.xlsx \
       --preview --embed --imgdir ../.tmp/normalized                                        # 5. curation workbook
python ../pet-centre-catalog/make-preview-pdf.py ../.tmp/catalog-named.json ../.tmp/desc.json \
       ../.tmp/resolved.json ../docs/splashstore-scan-review-<date>.pdf                     # 6. visual review PDF
python ../pet-centre-catalog/export-shopify.py --rows ../.tmp/catalog-named.json \
       --desc ../.tmp/desc.json --img ../.tmp/resolved.json \
       --out ../docs/splashstore-shopify-import-<date>.csv                                  # 7. Shopify import CSV
python finalize-workbook.py                             # 8. + Shopify tab, Needs-re-scan tab, fit layout
node publish-workbook.mjs                               # 9. -> Google Sheet, photos and colours intact
python report-scans.py                                  # optional markdown summary
```

**Steps 7-8 are not optional either.** `export-shopify.py` writes the Shopify schema (see its
docstring for what is derived vs deliberately blank); `finalize-workbook.py` then folds that into the
workbook as a second tab, adds a third tab for the scanned codes that carry no product barcode, and
**sizes every row and column so nothing is clipped**. That last part matters because Drive's
xlsx→Sheets conversion does not reproduce row heights exactly: a thumbnail sized flush to its row in
Excel gets cut off in the browser, so `fit_layout` pads images and grows rows to fit wrapped text.

**`--embed --imgdir` on step 5 are not optional.** Without them `assemble.py` writes a workbook with
ZERO images and none of the visual grading, which is most of the deliverable. With them you get the
reference format: an embedded thumbnail per row (column A, frozen at B2), 17 columns pairing each
enriched field with its own source cell, per-field GREEN / YELLOW / RED / grey-N-A colouring, and a
worst-field READY / REVIEW / HOLD status. Compare against Riccardo's reference build
`projects/pet-centre-catalog/.tmp/Pet Centre - CURATION 250 v5.xlsx` — same headers, freeze pane,
column widths and fill palette.

**Step 9 uploads that .xlsx and lets Drive convert it** (`publish-workbook.mjs`). The conversion
preserves the ANCHORED images, so the Sheet shows real photos with **no image hosting, no public
links and no `=IMAGE()` formulas** — verified by round-tripping the Sheet back to xlsx and counting
30 surviving images. This is the same route the July marketplace-listings sheet used. Auth is clasp's
stored login (`getClaspAccessToken`), the only credential here with a Drive scope.

**Everything the customer sees must be in English.** Identity is confirmed wherever the GTIN is
printed, which is very often a German, French, Greek or Slovenian retailer — the confirmation is
equally valid (a barcode is the same number in every language) but the NAME arrives in that language.
`translate-names.py` (step 2c) translates the name only, keeps `name_original` for provenance, and
preserves brands, model codes (SC713, 58094_26) and measurements verbatim — a translation that drops
one of those is REJECTED, because that changes identity rather than language. It also improves
classification: English names are what the type/category/collection matchers key on, which took Type,
category and Collection from 40/41 to 41/41. A brand's own product line stays untranslated on purpose
("Cristal Poolpflege" is a range name, like "Nike Air"). Descriptions are written in English already.

**`merge-names.py` is the scan-only bridge**: steps 3-5 read `clean`/`name`, which a scan does not have
until step 2 confirms it. It writes `name_found` back onto the rows and splits out a descriptions input
containing only identified rows, so the writer is never asked to describe a product it knows nothing
about. It does not guess `brand` or `type` itself; both are derived later in `export-shopify.py` from a
brand/category word appearing LITERALLY in the confirmed name, via an explicit allowlist (never "first
word"), and mirrored back into the Curation view. No match means blank — an invented brand in a live
shop is the false confidence this whole engine exists to avoid.

**The deliverable is the converted curation Sheet** (step 9 above):
**https://docs.google.com/spreadsheets/d/1DeHSQgWjZTZ5KH44EZSUfTX--myupphK8ysnYNfnPg8/edit**
— three tabs: **Curation** (44 rows, 30 embedded photos, colour tiers, 29 READY / 1 REVIEW / 14 HOLD),
**Shopify import** (41 products x 35 columns, editable, business-decision columns tinted), and
**Needs re-scan** (the 7 scanned codes that carry no product barcode). 44 + 7 = all 51 scanned.

The Sheet's id is cached in `.tmp/workbook-sheet-id.txt` and step 9 UPDATES it in place, so the link
the owner already has keeps working. **If that file is lost, take the id from this doc rather than
letting a fresh run create a duplicate sheet** (`--new` forces a new one deliberately).

**Do not write Sheets cell-by-cell with `=IMAGE()`.** The first attempt did (`push-to-sheet.mjs`,
now deleted): it pointed `=IMAGE()` at the original retailer URLs, and every photo cell errored
because Google's image fetcher is anonymous and those hosts refuse it. The working route is the one
above — build the workbook with embedded images and let Drive convert the .xlsx. `tools/google-sheets-lib.mjs`
still holds the value-level helpers (`writeValues`, `batchUpdate`, conditional formats) if a future
job genuinely needs to write cells rather than convert a workbook.

Raw scans live in `data/` (kept — re-scanning means a trip to the garage); everything in `.tmp/` is
disposable **except `sheet-id.txt`**.

**Scanned rows carry no product name**, unlike the Hike POS export the engine was built for. The engine
was extended for this (2026-08-16) and now, for a nameless row: queries deterministic barcode directories
(`ean-search.org`, `barcodelookup.com`) instead of a bare-number web search that returns near-random
products, captures the barcode-confirmed page's own product name into `name_found` + `name_sources`, and
skips the name-image-search stage that would otherwise fire an empty query and burn every retry sweep.

**Accuracy rule is unchanged and non-negotiable:** a name is reported only when the GTIN was found
LITERALLY at the source. Watch for the failure mode that cost a re-run — a directory's "no record" page
still prints the searched code, so it passes the GTIN check; `tidy_name()` rejects those titles
("Barcode Not Found", a bare "EAN <code>"). If you add a source, add its empty-state title there too.

**Duplicate scans** are collapsed by `read-scans.py`, deliberately narrowly: GTINs merge only on their
canonical GTIN-14 (so UPC-12 `700175992406` == EAN-13 `0700175992406`, which are the same code), and
everything else merges only on an exact string match. Every collapse is logged to
`.tmp/catalog-duplicates.json` with both line numbers, and a conservation check aborts the run rather
than write a catalogue where kept + collapsed != scanned. Never loosen this into fuzzy matching.

### Known state / gotchas
- **Barcode Lookup is live but on the FREE TRIAL: 50 successful calls per MONTH.** Key is in the root
  `.env` (rotated 2026-08-16). Only HTTP-200-with-data is metered — 404 misses are free (verified). It
  bought +10 images on 24 rows for 11 calls. **Budget it deliberately: the full ~229-product catalogue
  cannot run on 50/month**, so a paid plan is required before any blanket run. Check remaining quota
  with `/v3/rate-limits` before spending; the engine preflights this and prints it.
- **A Barcode Lookup image hit used to cost you the NAME.** Its titles are transliterated/ASCII-stripped
  ("Flssig", "Kartuov Filter") and thinner than a manufacturer or shop page's; because a Tier-0 hit
  short-circuits every search stage, 5 of 10 rows lost real detail. Fixed 2026-08-16 — for a nameless
  row the engine now still scrapes the two barcode directories to harvest a better name, leaving the
  DB image and its tier untouched. If you see BL-style names winning, that fix has regressed.
- Scraping `barcodelookup.com` public pages remains useful even with the API live: the API gives the
  image, the public page and ean-search give the better name. Both paths are used.
- **The workspace-root `.env` cannot be `.`-sourced** — one value is wrapped in `<...>`, a POSIX syntax
  error that aborts sourcing midway and silently leaves later keys unset (this is why `BARCODELOOKUP_API_KEY`
  read as empty at first). Load it in Python, or export the one key you need.
- Cost: ~7 Firecrawl credits per code (~300 for 44). No Anthropic spend — `--vision` is pointless on a
  nameless row, since vision judges an image against a claimed name.
- **Not every scan is a product barcode.** 7 of 51 could never resolve: GS1 serial captures
  (`(21)…(250)…` = AI 21/250, one physical unit, no GTIN) and supplier/model codes (`XLY41601182`,
  `X0020RYMP3`). These need the EAN re-scanned off the packaging or manual entry — not more lookup effort.
- 3 valid GTINs stayed unidentified (`5061066600127`, `5292638000759`, `9008748095532`): absent from every
  free source. Manual sourcing, or retry once Barcode Lookup is live.
- **A cp1252 console lies about the data.** Names legitimately carry `™`, `ö`, `é`, Greek and Cyrillic;
  the terminal prints them as `?`. Verified by codepoint — there is no mojibake in the stored UTF-8.
  Never "fix" this by stripping non-ASCII.
- **Never point `=IMAGE()` at the original retailer URLs.** They fail in the browser: Google's image
  fetcher is anonymous and most of those 15 hosts refuse it. Use the engine's OWN normalized JPGs
  (`normalize-images.py` → `.tmp/normalized/<row>.jpg`) — square, white background, ≤1 MB, and the same
  assets a POS/Shopify import needs. `publish-workbook.mjs` embeds them via the workbook and uses the
  `drive.google.com/thumbnail?id=…` form, which Sheets does render.
  (A `#REF!` seen when reading cells back through the **API** is separate and harmless — the API itself
  cannot fetch external URLs.)
- **BLOCKED: photo upload needs a Drive scope.** The stored refresh token carries only `gmail.send` +
  `spreadsheets`, so `ensureFolder`/`uploadFile` 403 with "insufficient authentication scopes". Until
  the OAuth client is re-consented with `https://www.googleapis.com/auth/drive.file`, the push falls
  back to a per-row `=HYPERLINK(...,"open photo")` — functional, just not inline. The alternative host
  is Cloudflare R2 (the engine briefing's planned image home); R2 is NOT provisioned yet — only
  `CLOUDFLARE_ACCOUNT_ID` exists, with no bucket or R2 token.
- Image URLs are HTML-unescaped at the source (`&amp;` in a query string breaks `=IMAGE()` and some
  hosts); if a new extraction path is added, unescape there too.

### Current state (2026-08-16)
51 codes scanned → 44 lookupable → **41 identified, 30 with photos, 41 descriptions, 14 with dimensions**.
Sheet status: **30 READY / 14 HOLD** (11 identified-but-no-photo + 3 unidentified) + 7 non-barcodes listed
separately.

Measured free cascade vs + Barcode Lookup, same 44 codes:

| | free only | + Barcode Lookup |
|---|---|---|
| identified (name) | 41 | 41 |
| with product photo | 20 | **30** |
| READY | 20 | **30** |
| Firecrawl credits | 303 | **246** |

Barcode Lookup adds **images, not names**, and it makes the run *cheaper* because a Tier-0 hit
short-circuits the paid image search. Cost: 11 metered calls of the 50/month trial.

Next levers in priority order: (1) unblock inline photos (Drive scope or R2), (2) paid Barcode Lookup
plan before any blanket run, (3) re-scan the 7 non-barcode items off their packaging, (4) owner fills
brand/type in the sheet — the engine deliberately does not guess either.

## Conventions
- Research/docs in `docs/`, plans in `plans/`. Secrets: workspace-root `.env` (see root CLAUDE.md).
- Web research default: Firecrawl MCP (`firecrawl_search`/`_scrape`).
- Client-facing recommendations present options with use cases — Riccardo makes the final pick, not the AI.
