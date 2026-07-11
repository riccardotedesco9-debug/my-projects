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

## Step 3 — Setup

**Hike Sync → Setup…** opens a short form with three settings:

1. **Data tab** — the tab holding the products (it auto-detects the one with
   Name/SKU/Barcode headers; usually "DATA SHEET").
2. **Auto-import folder** (optional) — paste a Drive folder link. Any Hike export dropped
   there is imported automatically within a few minutes.
3. **Failure-alert email** (optional).

Saving only stores preferences — it never touches product data. If the data tab has no
stock column, Setup also appends an empty **"Stock on hand"** placeholder column (additive
and safe) so the stock insights can work now (if Hike stock is present) or later.

## Step 4 — First import (this is the safety gate)

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
- **Insights + stock overview (refresh)** — summary charts (value by category, product mix,
  stock health, price bands) in a "Hike Insights" tab, plus a live "Stock overview" tab that
  brings the key columns (name, barcode, price, stock, reorder) to the front with a red
  low-stock highlight.
- **Show column filters** — filter dropdowns on every column (e.g. depleted stock, status).
- **Delete products no longer in Hike…** — opt-in cleanup that removes rows flagged
  "not in last import"; it backs up first and makes you type DELETE to confirm.

## Optional — Automatic API sync (Hike Plus plan only)

1. Riccardo registers an app on developer.hikeup.com and adds this install's
   **Return URI** (shown by **Hike Sync → Connect Hike API…**) to it.
2. Run **Connect Hike API…**, paste the App Id/Secret, click the connect link while
   logged into the Hike store, approve.
3. **Hike Sync → Sync from Hike API now** for a first manual run, then
   **Turn ON API auto-sync** (every 15 minutes, incremental, well inside Hike's rate
   limits).

## Security note

Anyone with **edit** access to the spreadsheet can open its script and read the stored
Hike credentials. Keep the editor list to people you'd trust with the Hike account.

## If something ever looks wrong

1. Don't panic — the sync never deletes automatically; the only deletion is the opt-in
   "Delete products no longer in Hike" action, which backs up first and needs a typed DELETE.
2. Right-click any tab → **Unhide** → open the newest `_hike_backup_…` tab: that's the
   full DATA tab as it was before the last sync. Copy values back if needed.
3. Google Sheets **File → Version history** is a second, independent rollback.
4. The `_hike_sync_log` hidden tab records every run and every abort reason.
