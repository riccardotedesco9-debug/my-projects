# Hike Sync — Command Center

The one place to understand and operate the sync. For installing on a new sheet see
[install-guide.md](install-guide.md); for hacking on the code see [dev-guide.md](dev-guide.md).

## What it is

A container-bound Google Apps Script that keeps a sheet's **DATA SHEET** tab in step with a
Hike POS store's product catalog, so the **LABELS SHEET** (barcode → name/price lookup) always
prints current prices. **Hike is the source of truth; the sheet is a downstream mirror.**

## The command surface

Open the sheet → **Hike Sync** menu:

| Action | What it does |
|---|---|
| **Command center** | Read-only dashboard: health, recent activity, action guide, guarantees. Start here. |
| **Import Hike export file…** | Pick a Hike "Export all details" file (.csv/.xlsx) → preview → apply. Works on any Hike plan. |
| **Import newest from watch folder** | Import the latest export dropped in the configured Drive folder. |
| **Sync from Hike API now** | Pull changed products from Hike's API (needs *Connect Hike API* + a Hike **Plus** plan). |
| **Connect Hike API… / Turn ON/OFF auto-sync** | One-time API connect; schedule the pull every 15 min. |
| **Print price labels…** | Search the catalog, tick items, append their barcodes to the LABELS tab (its formulas fill name/price). |
| **Insights + stock overview (refresh)** | Build/refresh the charts ("Hike Insights" tab) and a live "Stock overview" tab (key columns + low-stock highlight). |
| **Show column filters** | Add filter dropdowns to every column (depleted stock, in-Hike status, category…). |
| **Trim empty rows** | Remove blank trailing rows from the data tab (only empty rows below the data; never touches data). |
| **Setup…** | Choose the data tab, optional watch folder, failure-alert email. |
| **Delete products no longer in Hike…** | Opt-in purge of rows flagged "not in last import" — backup + typed DELETE confirm. |
| **Run self-test (sandbox only)** | Safety gauntlet on a sandbox copy; restores the sheet after. |

Two input lanes, one safe merge engine:
- **Lane B — manual export (any plan):** you export from Hike; the script merges the file.
- **Lane A — API (Hike Plus+):** scheduled incremental pull; only changed products each run.

## Guarantees (the rules this is built to keep)

Enforced in code; the sync path is checked by the self-test:

1. **Never deletes or destroys existing data automatically.** Upsert = update-in-place +
   append at the bottom; a sync never deletes a row and never mass-blanks a user value.
   Row deletion happens only via the explicit, backed-up, typed-confirm "Delete products
   no longer in Hike" action.
2. **Hike is the source of truth, one-way.** The API is used **read-only** — the sync never
   writes back to Hike. On a conflict, Hike's value wins in the sheet.
3. **LABELS tab is written only additively.** The sync never rewrites the LABELS tab; the only
   writes there are "Print price labels" appending barcodes (backed up first, formulas preserved).
   All other writes are scoped to the data tab plus the script's own hidden `_hike_backup_…` /
   `_hike_sync_log` / `_hike_insights` tabs and its additive `Hike Sync Note` column.
4. **Backup + preview before writing.** A hidden timestamped snapshot is taken before every
   write; the first-ever sync on a sheet must be previewed and confirmed by a person.
5. **Aborts on doubt.** Unknown import columns, a missing SKU column, a would-be mass-blank, or
   a layout/row change mid-run all abort *before* anything is written.
6. **Discrepancies are surfaced, not auto-resolved.** Products missing from a full export are
   **kept and flagged** ("not in last Hike import"), never deleted — a human reconciles them in
   Hike (the source of truth).

## The communication surface (Hike ↔ sheet ↔ you)

The DATA SHEET is the shared board; the sync keeps two channels honest without ever mutating
Hike:
- **`Hike Sync Note` column** — per-row status: *New*, *Updated*, or *Not in last Hike import*
  (colour-coded), so at a glance you see what changed and what may need attention in Hike.
- **`_hike_sync_log` tab** — an append-only audit trail of every run (when, source, result,
  rows changed, message) and every abort reason. This is the record of what the sync "said."
- **Failure alerts** — optional email on any failed/aborted run (deduped per day).

Anything that would flow *back* into Hike is deliberately a **human step**: the flags and log
tell you what to change in Hike; the sync never does it for you.

## If something looks wrong (rollback)

1. Nothing is ever deleted, so no data is lost.
2. Right-click any tab → **Unhide** → open the newest `_hike_backup_…` tab: that's the data tab
   exactly as it was before the last write. Copy values back if needed.
3. **File → Version history** is an independent second rollback.
4. `_hike_sync_log` records every run and every abort reason.

## Possible future add-ons (not built — would need your go-ahead)

Ideas that stay within the rules, surfaced for later:
- A change digest emailed/Slacked after each sync ("3 prices changed, 1 new product").
- A "review queue" tab listing flagged discrepancies for you to reconcile in Hike.
- Multi-outlet support (today one outlet's columns are synced).
- Ingesting a scheduled Hike Custom Report instead of a manual export.

None of these touch the guarantees above; each would be a deliberate, separately-approved step.
