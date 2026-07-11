# Pet Centre — Hike POS → Google Sheets Product Sync

Domain: Engineering

## What this is

Replaces the manual chore of exporting products from Hike POS and pasting them into the
**DATA SHEET** tab of the Pet Centre label spreadsheet. Delivered as a container-bound
Google Apps Script with two input lanes sharing one non-destructive merge engine:

- **Lane B (universal, any Hike plan):** owner exports "Export all details" from Hike
  (Products → EXPORT), then either picks the file via the sheet menu or drops it in a
  watched Drive folder — the script merges it safely.
- **Lane A (Hike Plus/Enterprise only):** scheduled pull from the Hike REST API
  (`GET /api/v1/products/get_all`, OAuth2 auth-code via the apps-script-oauth2 library).

The **LABELS SHEET** tab (barcode → NAME/PRICE lookup formulas, used to print price
labels) is never written by this project.

## Safety invariants (non-negotiable — enforced in code, verified by self-test)

1. Writes are scoped to the DATA SHEET tab object (plus the script's own additive
   `Hike Sync Note` column, hidden `_hike_backup_*` and `_hike_sync_log` tabs).
2. Upsert = overwrite changed cells in place + append new rows. **No row deletion,
   no cell clearing of user data** — products missing from an import are only flagged.
3. Values snapshot to a hidden timestamped backup tab before every mutating run (keep 5).
4. Header-verification gate: unknown import columns or a missing SKU column abort the
   run before anything is written. A "blanking guard" aborts if an import would blank
   an unusual share of existing values (wrong export mode protection).
5. First-ever apply on any sheet must be an interactive, human-confirmed dry-run
   preview; scheduled triggers refuse to write until that has happened once.
6. Hike API is used read-only — the create/update endpoints are never called.

## Layout

- `src/` — Apps Script sources (pushed with clasp; plain JS, V8 runtime).
  `merge-engine.js` + `value-utils.js` are pure (no Apps Script services) and are
  unit-tested under Node: `node --test test/`.
- `test/` — Node unit tests for the pure core.
- `docs/install-guide.md` — install on the production Pet Centre sheet.
- `docs/dev-guide.md` — dev loop, sandbox IDs, self-test, Phase-0 checklist.

## Key references

- Dev sandbox sheet: `1wIrjqa3naKATj7K_tJ-BfmpfWhTnJ_uWDWXDn81Y0Ek`
  ("test1 SANDBOX — hike-sync dev"); structure replica of production. Self-test only
  runs on sheets whose name contains "sandbox" (or with `ALLOW_SELF_TEST=yes` property).
- Structure source: `test1` sheet `1Lv9izZiRL3WNarKN1KNAIHu41n7ADgXsp4fvjeR3SJA` — do
  not test against it.
- Hike API docs: https://docs.hikeup.com (llms.txt index). Rate limits 60/min,
  5,000/day. API access requires the Hike **Plus** plan or higher.
- Research + plan: workspace `plans/` (workflow `wf_ca3ca5ec-e7e`).

## Gotchas

- Apps Script loads files in project order and `merge-engine.js` sorts before
  `value-utils.js` — cross-file references resolve lazily at call time (see the `U()`
  helper); don't convert them to top-level references.
- Outlet-prefixed columns (`Pet Centre_Retail price`, …) are detected dynamically from
  the header row; the production outlet name must never be hardcoded.
- SKU/Barcode cells: the engine preserves each column's existing type (number vs text)
  so the LABELS lookup formulas keep matching. Leading-zero barcodes stored as numbers
  are a pre-existing quirk of the sheet, not ours to fix.
