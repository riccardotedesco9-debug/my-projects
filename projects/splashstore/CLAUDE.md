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
2. **Catalog capture (next)** — owner scans all garage stock; the barcode list feeds the portable AI enrichment
   engine from `projects/pet-centre-catalog/` (see its `docs/engine-briefing.md` for re-pointing instructions).
3. Then: Shopify catalog rebuild + ad listings.

## Conventions
- Research/docs in `docs/`, plans in `plans/`. Secrets: workspace-root `.env` (see root CLAUDE.md).
- Web research default: Firecrawl MCP (`firecrawl_search`/`_scrape`).
- Client-facing recommendations present options with use cases — Riccardo makes the final pick, not the AI.
