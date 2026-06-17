# CLAUDE.md — pet-centre-catalog

Domain: Engineering — lives in `projects/` (uses global + Engineering skills/agents).
> Pet Centre family: `pet-centre-marketing` (strategy/research) · `pet-centre-website` (the storefront build) · **`pet-centre-catalog`** (this — Hike POS catalogue enrichment).

Enriches Riccardo's full **Hike POS** product catalogue (`C:\Users\Riccardo\Downloads\Product List Desc.xlsx`,
~9,817 products) by filling the two empty columns so the file can be re-imported into Hike:
**Description** (col B) and **Image URL** (col F), plus a curation-only **Image Confidence** column (G).

**Overriding rule: accuracy > coverage.** "False advertising is worse than no advertising." Nothing
unconfirmed is ever presented as confirmed — anything uncertain is flagged (yellow) or left blank (red).

## Pipeline (Python; run via the skills venv + `op run` for secrets)

`~/.claude/skills/.venv/Scripts/python.exe`, secrets injected with
`op run --env-file="../../.env.tpl" -- <cmd>` (needs the 1Password desktop approval popup).

1. `read-catalog.py` — parse the source xlsx → `.tmp/catalog.json` (one record/row; cleaned name, barcode, type, brand).
2. `resolve-images.py` — **the engine.** Barcode (EAN) search → scrape candidate pages → confirm the
   EAN (or brand+article-code) literally on-page. Tiers: `verified-official` > `verified-cross` > `verified` > `likely` (name-match, unconfirmed) > blank. Image-quality gate (live + min 250px short side, ≤3:1) keeps junk crops/thumbnails out of the likely tier; verified stays identity-first. Resumable, per-row checkpoint, hard `CREDIT_CAP`. Uses `FIRECRAWL_API_KEY`.
3. `gen-descriptions.py` — Claude Haiku, batched, resumable. Hard no-fabrication rule; verified rows are
   *grounded* in the real scraped page text (free by-product of step 2). Uses `ANTHROPIC_API_KEY`.
4. `assemble.py` — writes the enriched xlsx (col B/F/G, colour-coded: verified=white, likely=yellow, blank=red).
   `--preview [--embed]` builds a compact review workbook with inline thumbnails.
5. `make-preview-pdf.py` — review PDF: thumbnail + name/brand/type + confidence + description + URL per row.

## Status (June 2026)

Engine + scripts built and validated. **48-product stratified test catalogue: 26 verified / 15 likely /
7 blank, 0 dead images.** Latest review PDF in `Downloads` (+ Desktop copy). **Full 9,817 run not yet
authorised** — awaiting go and/or a barcode-keyed official supplier source (would become a Tier-0 feed).
Working data in `.tmp/` (disposable, regenerated). Est. full run ~$45–58, resumable, capped.

## Don'ts
- Never upload the internal catalogue to an external CDN/service without explicit OK (it's private business data).
- Never write secrets to disk — only `op run`.
- Never present a `likely`/`blank` image as confirmed.
