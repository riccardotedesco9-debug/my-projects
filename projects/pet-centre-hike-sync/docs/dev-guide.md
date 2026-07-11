# Dev guide — pet-centre-hike-sync

## Sheets

| Sheet | ID | Use |
|---|---|---|
| `test1` | `1Lv9izZiRL3WNarKN1KNAIHu41n7ADgXsp4fvjeR3SJA` | Structure reference — do NOT test on it |
| `test1 SANDBOX — hike-sync dev (safe to break)` | `1wIrjqa3naKATj7K_tJ-BfmpfWhTnJ_uWDWXDn81Y0Ek` | All destructive testing |

## Dev loop

1. Pure logic (`value-utils.js`, `merge-engine.js`, `hike-field-map.js`) is tested
   locally: `node --test test/` — run on every change.
2. Push to the sandbox's bound script with clasp (one-time: open the sandbox →
   Extensions → Apps Script → copy the Script ID → `npx @google/clasp login`,
   create `.clasp.json` here: `{"scriptId":"<ID>","rootDir":"src"}` → `npx @google/clasp push`).
   Alternative without clasp: paste the `src/` files into the script editor manually.
3. In the sandbox sheet: **Hike Sync → Run self-test (sandbox only)** — it exercises
   the whole engine against the live sheet (update/append/never-delete/abort paths +
   the LABELS lookup integrity check) and restores the sheet afterwards.
   The self-test refuses to run on any sheet whose name lacks "sandbox".

## Phase-0 empirical checklist (needs a real Hike account, ~10 min)

**Resolved via live API probe on the test store (2026-07-10, `tools/hike-api-probe.mjs`):**
- API access works on the dev store (53 products) — OAuth auth-code flow + Bearer calls confirmed.
- Pagination is plain offset: `next` returns `Skip_count = page_size × pages`; pages distinct, no overlap/gap — `fetchProducts` (follows the `next` link) is correct.
- Outlet fields map correctly (`price_inc_tax`→Retail, `price_ex_tax`→Price-Ex-Tax, `on_hand_inventory`→Stock on hand, `tax_name`→Tax, etc.); `bran_name` typo is real; empty `[]`/null fields correctly leave cells alone.
- `primary_image` IS an internal GUID (not a URL); real URLs live in `additional_images[].image_url` / `*_thumbnail`. Image URL now maps from the primary image's full URL → largest thumbnail (`hike-field-map.js` `pickImageUrl`).

Still unverified against reality — confirm each on the dev Hike store before the
production install, and fix the code/docs where they disagree:

- [ ] What "Export all details" actually downloads today: .csv or .xlsx, and its exact
      header list vs the sheet's DATA tab headers (public KB docs lag the current format).
- [ ] Number format in the export: does Hike write prices/quantities with a decimal
      COMMA ('12,50') or DOT ('12.50'), and are there thousands separators? `parseNumeric`
      treats only `<digits>,<1-2 digits>` as a decimal comma and strips other commas as
      thousands groups — confirm this matches the real file (value-utils.js).
- [ ] Are any export columns dates? `equivalent` has a Date-vs-string guard, but the
      string format is unverified — if a date column exists, confirm it doesn't churn.
- [ ] API `primary_image`: is it a full URL or an internal identifier? The API lane only
      writes it to Image URL when it starts with http(s) (hike-field-map.js) — confirm
      against a real product, and map the real URL field if it lives elsewhere.
- [ ] Whether partial export modes ("Export price"/"Export stock") headers still match
      the sheet's column names (partial imports are supported by the engine if so).
- [ ] LABELS formulas survive a full-range `setValues` overwrite + append on the DATA
      tab (covered by self-test test 7 — run it once and record the result here).
- [ ] Hike trial/Essential account: does the OAuth authorize step work at all, or is
      API access refused before Plus? (Decides whether Lane A is testable pre-upgrade.)
- [ ] `Sync_From` timezone semantics (assumed UTC ISO — watermark is stored as ISO Z).
- [ ] Pagination `next`-link Skip_count semantics (the docs' own example is ambiguous;
      `fetchProducts` trusts the returned Skip_count).
- [ ] API variant-option field names (export columns "Variant option name/value one…"
      are currently left untouched by the API lane).
- [ ] `{Outlet}_Stock` vs `_Stock on hand`: mapped to `available_inventory` vs
      `on_hand_inventory` — verify against a store with reserved stock.

## Design rules (read before changing code)

- The merge plan is data; all spreadsheet writes live in `sheet-io.js` and are scoped
  to the data tab + the script's own artifacts. Keep it that way.
- No `deleteRow`, no `clearContent` on user data anywhere in `src/` (the self-test
  harness's restore path is the only sanctioned `clearContent`, on rows it appended).
- Apps Script loads files in project order — cross-file references must stay lazy
  (see the `U()` helpers). Under Node, the same files are `require()`d directly.
- `appsscript.json` pins the OAuth2 library (v43) and the Drive advanced service —
  a manual paste-install must include the manifest, or Lane A and .xlsx imports break.
