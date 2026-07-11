/**
 * Manual, opt-in reconciliation: delete DATA SHEET rows flagged "not in the last Hike
 * import" (i.e. products that no longer exist in Hike, the source of truth). This is the
 * ONLY place the project deletes rows, and it is never automatic — a person picks it from
 * the menu, sees the count + a sample, and must type DELETE. A backup is taken first, and
 * only flagged rows are removed; anything still in Hike is untouched.
 */
var PurgeMissing = (function () {
  // writeSyncNotes stamps missing rows with a note that starts with this text.
  var MISSING_PREFIX = 'Not in last Hike import';

  /** Locate the flagged rows (1-based) on the data tab, with a few sample names. */
  function findMissing_(sh) {
    var values = sh.getDataRange().getValues();
    var hr = MergeEngine.findHeaderRow(values);
    if (hr === -1) throw new Error('Could not find the header row — nothing was deleted.');
    var noteHeader = ValueUtils.normHeader(Settings.get('NOTE_COLUMN_HEADER', Settings.DEFAULTS.NOTE_COLUMN_HEADER));
    var noteCol = -1, nameCol = -1;
    values[hr].forEach(function (h, i) {
      var n = ValueUtils.normHeader(h);
      if (n === noteHeader && noteCol === -1) noteCol = i;
      if (n === 'name' && nameCol === -1) nameCol = i;
    });
    var rows = [], samples = [];
    if (noteCol === -1) return { rows: rows, samples: samples };
    for (var r = hr + 1; r < values.length; r++) {
      if (String(values[r][noteCol]).indexOf(MISSING_PREFIX) === 0) {
        rows.push(r + 1); // 1-based
        if (samples.length < 10) samples.push(nameCol !== -1 ? String(values[r][nameCol]) : 'row ' + (r + 1));
      }
    }
    return { rows: rows, samples: samples };
  }

  /** Delete a list of 1-based rows efficiently: contiguous runs, highest-first. */
  function deleteRows_(sh, rows) {
    var runs = [];
    rows.slice().sort(function (a, b) { return a - b; }).forEach(function (r) {
      var last = runs[runs.length - 1];
      if (last && r === last.start + last.count) last.count++;
      else runs.push({ start: r, count: 1 });
    });
    runs.sort(function (a, b) { return b.start - a.start; }).forEach(function (run) {
      sh.deleteRows(run.start, run.count);
    });
  }

  function run() {
    var ui = SpreadsheetApp.getUi();
    var sh = SheetIO.dataSheet();
    var found = findMissing_(sh);
    if (!found.rows.length) {
      ui.alert('Nothing to delete',
        'No products are flagged "' + MISSING_PREFIX + '".\n\nRun a full Hike import first — any product missing from ' +
        'it gets flagged, and this option removes exactly those (products no longer in Hike).', ui.ButtonSet.OK);
      return;
    }
    var sample = '   • ' + found.samples.join('\n   • ') + (found.rows.length > found.samples.length ? '\n   • …' : '');
    var resp = ui.prompt('Delete products no longer in Hike',
      found.rows.length + ' product(s) are flagged "' + MISSING_PREFIX + '" — they were NOT in your last full Hike import.\n\n' +
      sample + '\n\nA backup is taken first. To restore afterwards use the hidden _hike_backup_ tab or File → Version history.\n\n' +
      'Type DELETE (capitals) to remove these rows — anything else cancels.',
      ui.ButtonSet.OK_CANCEL);
    if (resp.getSelectedButton() !== ui.Button.OK) return;
    if (ValueUtils.normString(resp.getResponseText()).toUpperCase() !== 'DELETE') {
      ui.alert('Cancelled — "DELETE" was not typed, so nothing was deleted.');
      return;
    }

    var lock = LockService.getDocumentLock();
    if (!lock.tryLock(30000)) { ui.alert('Another operation is running — try again in a minute.'); return; }
    try {
      SheetIO.backup();
      var fresh = findMissing_(sh); // re-check against the current sheet (guard mid-dialog edits)
      deleteRows_(sh, fresh.rows);
      SpreadsheetApp.flush();
      SyncLog.logRun({ source: 'purge-missing', ok: true, message: 'Deleted ' + fresh.rows.length + ' product(s) no longer in Hike.' });
      ui.alert('Done',
        'Deleted ' + fresh.rows.length + ' product(s) no longer in Hike.\n\nA backup of the previous values was saved ' +
        '(hidden _hike_backup_ tab).', ui.ButtonSet.OK);
    } finally {
      lock.releaseLock();
    }
  }

  return { run: run };
})();
