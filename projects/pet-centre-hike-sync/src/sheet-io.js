/**
 * All spreadsheet reads/writes for the sync. Every mutating call in the project
 * funnels through here and is scoped to the data tab object (plus the script's own
 * backup tabs and additive note column). The LABELS sheet is never referenced.
 */
var SheetIO = (function () {
  var BACKUP_PREFIX = '_hike_backup_';

  function ss() { return SpreadsheetApp.getActive(); }

  function dataSheet() {
    var name = Settings.get('DATA_SHEET_NAME', Settings.DEFAULTS.DATA_SHEET_NAME);
    var sh = ss().getSheetByName(name);
    if (!sh) throw new Error('Data tab "' + name + '" not found — run Hike Sync → Setup.');
    return sh;
  }

  function readAll() {
    return dataSheet().getDataRange().getValues();
  }

  /**
   * Grow a sheet's grid so a numRows×numCols block fits before a block setValues().
   * setValues does NOT auto-expand the grid (default new sheet is 1000×26); writing
   * past the current max throws "Range exceeds grid limits". Only ever grows.
   */
  function ensureGrid_(sh, numRows, numCols) {
    if (sh.getMaxRows() < numRows) sh.insertRowsAfter(sh.getMaxRows(), numRows - sh.getMaxRows());
    if (sh.getMaxColumns() < numCols) sh.insertColumnsAfter(sh.getMaxColumns(), numCols - sh.getMaxColumns());
  }

  /** Snapshot the data tab's values into a hidden timestamped backup tab; keep the newest N. */
  function backup() {
    var keep = parseInt(Settings.get('BACKUP_KEEP', Settings.DEFAULTS.BACKUP_KEEP), 10) || 5;
    var values = readAll();
    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMdd_HHmmss');
    var name = BACKUP_PREFIX + stamp;
    var spreadsheet = ss();
    var sh = spreadsheet.getSheetByName(name);
    if (sh) spreadsheet.deleteSheet(sh); // same-second rerun; a backup tab is ours to replace
    sh = spreadsheet.insertSheet(name, spreadsheet.getSheets().length);
    if (values.length) {
      ensureGrid_(sh, values.length, values[0].length); // new sheet defaults to 1000×26
      sh.getRange(1, 1, values.length, values[0].length).setValues(values);
    }
    sh.hideSheet();

    // Prune ONLY our own backup tabs (strict name match), newest first.
    var backups = spreadsheet.getSheets().filter(function (s) {
      return new RegExp('^' + BACKUP_PREFIX + '\\d{6}_\\d{6}$').test(s.getName());
    }).sort(function (a, b) { return b.getName().localeCompare(a.getName()); });
    backups.slice(keep).forEach(function (s) { spreadsheet.deleteSheet(s); });
    return name;
  }

  /**
   * Apply a MergeEngine plan: batched per column (one read+write per changed column), then
   * one block append below the last row. No deletes, no clears of user data — and untouched
   * cells (including any user FORMULA in a mapped column) are preserved exactly.
   * Returns { appendStartRow, appendCount } (1-based, 0 when nothing appended).
   */
  function applyPlan(plan) {
    var sh = dataSheet();
    assertSafeToWrite_(sh, plan);
    // Batch updates by COLUMN: one fresh single-column read + one write per changed column,
    // instead of one write per changed row (O(updatedRows) ops, which can time out on a large
    // daily re-import). Only Hike-mapped columns ever appear in changes, so user columns are
    // never touched; the fresh read means a concurrent edit to an unchanged cell in the span
    // is preserved rather than clobbered by a stale snapshot.
    var byCol = {};
    plan.updates.forEach(function (u) {
      u.changes.forEach(function (ch) { (byCol[ch.col] || (byCol[ch.col] = [])).push([u.rowIndex, ch.newValue]); });
    });
    Object.keys(byCol).forEach(function (colStr) {
      var col = parseInt(colStr, 10), changes = byCol[colStr];
      var minRow = changes[0][0], maxRow = changes[0][0];
      changes.forEach(function (x) { if (x[0] < minRow) minRow = x[0]; if (x[0] > maxRow) maxRow = x[0]; });
      var range = sh.getRange(minRow + 1, col + 1, maxRow - minRow + 1, 1);
      // Preserve untouched cells EXACTLY — including any user formula. getValues() flattens a
      // formula to its computed value, so re-apply each untouched cell's formula (a leading-'='
      // string becomes a formula again on setValues); only the changed rows get the new value.
      var vals = range.getValues(), fs = range.getFormulas();
      for (var i = 0; i < vals.length; i++) if (fs[i][0] !== '') vals[i][0] = fs[i][0];
      changes.forEach(function (x) { vals[x[0] - minRow][0] = x[1]; });
      range.setValues(vals);
    });
    var appendStartRow = 0;
    if (plan.appends.length) {
      appendStartRow = sh.getLastRow() + 1;
      ensureGrid_(sh, appendStartRow + plan.appends.length - 1, plan.appends[0].length);
      sh.getRange(appendStartRow, 1, plan.appends.length, plan.appends[0].length).setValues(plan.appends);
    }
    SpreadsheetApp.flush();
    return { appendStartRow: appendStartRow, appendCount: plan.appends.length };
  }

  /**
   * A plan is built from a snapshot; if a person edited the tab in the meantime, its
   * row/column indexes could point at the wrong cells. Immediately before writing,
   * re-verify (a) the header row is byte-for-byte the same layout the plan mapped
   * against — so no column was inserted/removed/renamed under the writes/appends — and
   * (b) every update's target row still holds the same product. Abort cleanly on any
   * mismatch; a re-run rebuilds against the current state.
   */
  function assertSafeToWrite_(sh, plan) {
    if (plan.headerSignature !== undefined) {
      // Read the header row explicitly: getDataRange()'s trailing-empty dimensions can
      // wobble between reads within one execution, so compare only the NON-EMPTY header
      // sequence (a real column insert/remove/rename still changes it).
      var lastCol = sh.getLastColumn();
      var hdr = lastCol ? sh.getRange(plan.headerRow + 1, 1, 1, lastCol).getValues()[0] : [];
      if (MergeEngine.headerSignature(hdr) !== plan.headerSignature) {
        throw new Error('The data tab columns changed while the sync was running — nothing was written. Run the sync again.');
      }
    }
    if (plan.keyCols && plan.keyCols.sku !== undefined && plan.updates.length) {
      var values = sh.getDataRange().getValues();
      var bad = plan.updates.filter(function (u) {
        var row = values[u.rowIndex];
        var key = row === undefined ? '' : MergeEngine.rowKey(
          row[plan.keyCols.sku],
          plan.keyCols.barcode !== -1 ? row[plan.keyCols.barcode] : ''
        );
        return key !== (u.sheetKey || u.key);
      });
      if (bad.length) {
        throw new Error('The sheet changed while the sync was running (rows moved) — nothing was written. Run the sync again.');
      }
    }
  }

  /** Colour tint for a note string (used to re-derive tints when preserving existing notes). */
  function noteTint_(note) {
    if (note.indexOf('Not in last Hike import') === 0) return '#fce5cd';
    if (note.indexOf('Updated') === 0) return '#cfe2f3';
    if (note.indexOf('New') === 0) return '#d9ead3';
    return null;
  }

  /**
   * Write per-row statuses into the script's own additive note column (created once,
   * after the last used header column). A FULL import re-derives the whole column; an
   * INCREMENTAL pull preserves existing notes (so the "not in Hike" flags survive).
   */
  function writeSyncNotes(plan, appendInfo) {
    var sh = dataSheet();
    var headerRowIdx = plan.headerRow; // 0-based
    var noteHeader = Settings.get('NOTE_COLUMN_HEADER', Settings.DEFAULTS.NOTE_COLUMN_HEADER);
    var usedCols = Math.max(sh.getLastColumn(), 1);
    var headerVals = sh.getRange(headerRowIdx + 1, 1, 1, usedCols).getValues()[0];

    // Reuse our note column by name; otherwise place it immediately AFTER the last used
    // column. Never adopt a mid-sheet blank-header column — it may hold user data below.
    var noteCol = -1;
    for (var c = 0; c < headerVals.length; c++) {
      if (ValueUtils.normHeader(headerVals[c]) === ValueUtils.normHeader(noteHeader)) { noteCol = c; break; }
    }
    var created = false;
    if (noteCol === -1) {
      noteCol = usedCols; // 0-based index of the first column past the used range
      ensureGrid_(sh, headerRowIdx + 1, noteCol + 1);
      sh.getRange(headerRowIdx + 1, noteCol + 1).setValue(noteHeader);
      created = true;
    }

    var lastRow = sh.getLastRow();
    var firstDataRow = headerRowIdx + 2; // 1-based
    if (lastRow < firstDataRow) return;
    var count = lastRow - firstDataRow + 1;
    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd MMM HH:mm');

    // Incremental pull (reportMissing === false): PRESERVE existing notes so prior "Not in
    // last Hike import" flags (the purge tool depends on them) aren't wiped. Full import: start
    // blank and re-derive the whole column.
    var preserve = plan.reportMissing === false && !created;
    var existing = preserve ? sh.getRange(firstDataRow, noteCol + 1, count, 1).getValues() : null;
    var notes = [], tints = [];
    for (var i = 0; i < count; i++) {
      var e = existing ? String(existing[i][0]) : '';
      notes.push([e]); tints.push([noteTint_(e)]);
    }
    plan.updates.forEach(function (u) {
      var i = (u.rowIndex + 1) - firstDataRow;
      if (i >= 0 && i < count) { notes[i][0] = 'Updated ' + stamp; tints[i][0] = '#cfe2f3'; }
    });
    plan.missingKeys.forEach(function (m) {
      var i = (m.rowIndex + 1) - firstDataRow;
      if (i >= 0 && i < count) { notes[i][0] = 'Not in last Hike import (' + stamp + ')'; tints[i][0] = '#fce5cd'; }
    });
    if (appendInfo && appendInfo.appendCount > 0) {
      for (var a = 0; a < appendInfo.appendCount; a++) {
        var i2 = appendInfo.appendStartRow + a - firstDataRow;
        if (i2 >= 0 && i2 < count) { notes[i2][0] = 'New ' + stamp; tints[i2][0] = '#d9ead3'; }
      }
    }

    var range = sh.getRange(firstDataRow, noteCol + 1, count, 1);
    range.setValues(notes);
    range.setBackgrounds(tints);
  }

  /**
   * Trim trailing EMPTY rows so the tab isn't padded with hundreds of blank rows. Only ever
   * removes rows BELOW the last data row (they hold no content) — never touches data. Returns
   * how many rows were removed.
   */
  function trimToData() {
    var sh = dataSheet();
    var keep = Math.max(sh.getLastRow(), 1);
    var extra = sh.getMaxRows() - keep;
    if (extra > 0) sh.deleteRows(keep + 1, extra);
    return extra > 0 ? extra : 0;
  }

  /**
   * Add native column-filter dropdowns to the data tab (filter by stock / status / category /
   * anything). Replaces any existing filter. Covers the current data range; re-run after adding
   * many products to extend it. Coexists with the sync — it never blocks writes or row ops.
   */
  function enableFilters() {
    var sh = dataSheet();
    var existing = sh.getFilter();
    if (existing) existing.remove();
    var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
    var hr = MergeEngine.findHeaderRow(sh.getRange(1, 1, Math.min(5, lastRow || 1), lastCol).getValues());
    if (hr === -1) throw new Error('Header row (Name / SKU / Barcode) not found — run Setup and import first.');
    sh.getRange(hr + 1, 1, lastRow - hr, lastCol).createFilter();
  }

  /**
   * If the data tab has NO stock column, append an EMPTY "Stock on hand" column at the end —
   * additive and safe (never touches existing data, never causes an import to abort), a ready
   * placeholder for future stock tracking. No-op when a stock column already exists (stock then
   * works out of the box). Returns true only when it added the column.
   */
  function ensureStockColumn() {
    var sh = dataSheet();
    var lastCol = sh.getLastColumn(), lastRow = sh.getLastRow();
    if (lastCol < 1) return false;
    var scan = sh.getRange(1, 1, Math.min(5, lastRow || 1), lastCol).getValues();
    var hr = MergeEngine.findHeaderRow(scan);
    if (hr === -1) return false;
    var hasStock = scan[hr].some(function (h) {
      var n = ValueUtils.normHeader(h);
      return n === 'stock on hand' || n === 'on hand' || n === 'stock' || /_stock on hand$/.test(n);
    });
    if (hasStock) return false;
    var col = lastCol + 1;
    if (sh.getMaxColumns() < col) sh.insertColumnsAfter(sh.getMaxColumns(), col - sh.getMaxColumns());
    sh.getRange(hr + 1, col).setValue('Stock on hand');
    return true;
  }

  return {
    dataSheet: dataSheet,
    readAll: readAll,
    backup: backup,
    applyPlan: applyPlan,
    writeSyncNotes: writeSyncNotes,
    trimToData: trimToData,
    enableFilters: enableFilters,
    ensureStockColumn: ensureStockColumn,
    BACKUP_PREFIX: BACKUP_PREFIX
  };
})();
