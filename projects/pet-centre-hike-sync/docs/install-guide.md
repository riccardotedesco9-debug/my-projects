# Install guide — Hike Sync on the production Pet Centre sheet

Audience: the Pet Centre owner (with Riccardo helping). Time: ~10 minutes.
Nothing in this process touches existing data: the first sync always shows a preview
and writes nothing until it is approved, and every write is preceded by a hidden backup.

## What you need

- Edit access to the Google Sheet (the one with the LABELS + DATA tabs).
- The finished, sandbox-tested script as a **single file**: `hike-sync.gs` in the project
  root (generated from `src/` by `node tools/build-bundle.mjs`).
- For the optional automatic API sync: a Hike **Plus** (or Enterprise) subscription.

## Step 1 — Put the script into the sheet

This installs onto the sheet's **existing** tabs — it never replaces the sheet, so an
existing LABELS/DATA setup and all its data stay intact.

1. Open the sheet → **Extensions → Apps Script**. Delete the empty `Code.gs` stub.
2. Create one script file and paste in the **entire contents of `hike-sync.gs`** (the
   whole bundle — all the code is in that one file). Save.
3. Open the ⚙ **Project Settings** → tick **"Show appsscript.json"**, open the
   `appsscript.json` file in the editor, and paste `src/appsscript.json` over it (it
   declares the OAuth2 library + Drive service that Lane A and .xlsx import need). Save.
4. Reload the spreadsheet tab — a **Hike Sync** menu appears.

## Step 2 — First authorization (the scary Google warning is expected)

The first time you use the menu, Google asks for permissions and shows
**"Google hasn't verified this app"**. That is normal for private scripts:

1. Click **Advanced** → **Go to (project name) (unsafe)** → **Allow**.
2. This grants the script access under *your* account only; nobody else gains access.

## Step 3 — Preflight check (verify before anything is written)

**Hike Sync → Preflight check (read-only)**. This writes nothing — it shows exactly what the
tool detected on *this* sheet, so you can confirm it before syncing (your on-site sanity check):

- **Drive service / OAuth2 library / Timezone** — confirms the manifest (Step 1.3) actually
  loaded. If Drive shows **CHECK/MISSING**, `.xlsx` imports won't work; if OAuth2 is missing,
  the API lane won't. Re-paste `appsscript.json` and re-run Preflight.
- **Data tab** — the tab it will sync. If it says several tabs "look like product data", make
  sure the right one is picked in Setup (writes only ever go to that tab).
- **Header row + columns** — confirms it found Name/SKU/Barcode and shows which columns it
  matched for price/stock/reorder (with the real header text). Fix wording/position if a
  required one says NOT FOUND.
- **Labels tab** — the tab Print-labels / scanning will use (and whose Name/Price columns
  scanning setup overwrites). Pin the right one in Setup if there are several candidates.

Green **PASS** everywhere (WARNs are usually fine) → proceed. Resolve any **CHECK** first.

## Step 4 — Setup

**Hike Sync → Setup…** opens a short form:

1. **Data tab** — the tab holding the products (auto-detects the Name/SKU/Barcode tab; usually
   "DATA SHEET"). If several tabs match, it warns you — pick the real catalog.
2. **Labels tab** — the price-label sheet (Barcode + Name/Price). Leave on *auto-detect* unless
   the wrong tab is picked. "Set up label scanning" writes to this tab.
3. **Auto-import folder** (optional) — paste a Drive folder link. Any Hike export dropped there
   is imported automatically within a few minutes.
4. **Failure-alert email** (optional).

Saving only stores preferences — it makes **no** structural change to your tabs. The only column
the tool ever adds is the **"Hike Sync Note"** status column (added by the sync itself, after you
approve the first import); your existing stock/price/reorder columns are updated in place, never
duplicated.

## Step 5 — First import (this is the safety gate)

1. In Hike: **Products → EXPORT → Export all details**, save the file to Drive.
2. **Hike Sync → Import Hike export file…** and paste the file's link.
3. A preview lists every change ("nothing written yet"). Read it, then approve.
4. Done. A timestamped backup tab of the previous values was created first (hidden),
   and the **Hike Sync Note** column shows what changed.

Products that disappear from Hike are **never deleted** from the sheet — they're kept
and flagged "Not in last Hike import" in the note column.

## The rest of the menu (optional, any time)

Open **Hike Sync → Command center** for a live dashboard and a guide to every action. In short:
- **Print price labels…** — search products, tick the ones you want; their barcodes are
  appended to the LABELS tab (backed up first) and its formulas fill in name/price.
- **Set up label scanning** — one-time: replaces the LABELS tab's Name/Price columns with one
  auto-fill formula each (backup saved first), so scanning — or typing — a barcode into the
  barcode column fills name + price on that row by itself. No dragging; empty rows stay blank.
  Run once after install (and again only if the labels tab's columns are restructured).
- **Refresh visuals** — summary charts (value by category, product mix, stock
  health, price bands) in a "Hike Insights" tab (pies on top, bars below, colour legend at the
  bottom). Also re-applies the live stock colour-grading on the DATA SHEET's **Stock on hand**
  column — green (healthy, above reorder level) blending through yellow (reorder now), orange
  (running low) and red (almost out) to dark red (out of stock); products with no reorder level
  set stay uncoloured — and forces the Stock/Reorder-level count columns to a plain integer
  format. Inventory lives on the DATA SHEET itself — header row + Name column are frozen, and
  the Stock on hand header carries a hover note explaining the colours.
  *Note: the tool owns the formatting rules on the Stock / Stock on hand columns — any custom
  colour rule you add to those two columns is replaced on the next refresh. Rules on every
  other column are never touched.*
- **Show column filters** — filter dropdowns on every column (e.g. depleted stock, status).
- **Fit columns to content** — auto-size the DATA SHEET columns (very wide ones are capped).
- **Delete products no longer in Hike…** — opt-in cleanup that removes rows flagged
  "not in last import"; it backs up first and makes you type DELETE to confirm.

## Optional — Automatic API sync (Hike Plus plan only)

Do a **file import first** (Step 5) — it seeds the incremental watermark, so the first API run
pulls only recent changes instead of the whole catalog (which can exceed Google's 6-minute limit
on a big store). Then:

1. Register an app on developer.hikeup.com and add this install's **Return URI** to it — the
   exact URI is shown by **Hike Sync → Connect Hike API…** (it's unique to this install).
2. Run **Connect Hike API…**, paste the App Id/Secret, click the connect link while logged into
   the Hike store, approve.
3. **Hike Sync → Sync from Hike API now** for a first manual run, then **Turn ON API auto-sync**
   (every 15 minutes, incremental, well inside Hike's rate limits).

## Security note

Anyone with **edit** access to the spreadsheet can open its script and read the stored
Hike credentials. Keep the editor list to people you'd trust with the Hike account.

## Troubleshooting (on-site, no dev tools needed)

| Symptom | Cause / fix |
|---|---|
| `.xlsx` import does nothing / errors | Drive advanced service missing — re-paste `appsscript.json` (Step 1.3), re-run **Preflight**. (`.csv` imports don't need it.) |
| "Connect Hike API" errors / won't authorize | OAuth2 library missing (re-paste manifest), or the Return URI isn't registered in the Partner Dashboard, or the plan isn't Hike Plus. |
| Wrong tab is being synced / labelled | Pick the correct **Data tab** / **Labels tab** in **Setup**; re-run **Preflight** to confirm. |
| Preflight says "header not found" | Move the Name/SKU/Barcode header into the top 10 rows of the data tab, or pick the right tab in Setup. |
| A chart tab or overview tab seems to have vanished | Restore from **File → Version history**, and make sure you're on the current build (older builds could over-eagerly clean tabs). |
| Scanned barcode shows no name/price | Run **Set up label scanning** on the correct labels tab (Preflight names it); it installs the auto-fill formula. |

## If something ever looks wrong

1. Don't panic — the sync never deletes automatically; the only deletion is the opt-in
   "Delete products no longer in Hike" action, which backs up first and needs a typed DELETE.
2. Right-click any tab → **Unhide** → open the newest `_hike_backup_…` tab: that's the
   full DATA tab as it was before the last sync. Copy values back if needed.
3. Google Sheets **File → Version history** is a second, independent rollback.
4. The `_hike_sync_log` hidden tab records every run and every abort reason.
