// log-admin.js — Time Log housekeeping: delete selected session(s), sort by
// date. Data-integrity note: appendLogRow_ always writes at getLastRow()+1, so
// a new session NEVER overwrites existing data — even if you clear a row in the
// middle (the blank stays; the new row lands at the end and you can re-sort).

/** Deletes the currently-selected Time Log row(s), with a confirmation. */
function deleteSelectedLogRows() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getActiveSheet();
  var ui = SpreadsheetApp.getUi();
  if (sh.getName() !== CFG.sheets.log) {
    ui.alert('Delete a session', 'Open the "' + CFG.sheets.log + '" tab and select the row(s) to delete first.', ui.ButtonSet.OK);
    return;
  }
  var rng = sh.getActiveRange();
  var startRow = rng.getRow();
  var numRows = rng.getNumRows();
  // Never let the header be part of the deletion.
  if (startRow < CFG.log.firstDataRow) {
    numRows -= CFG.log.firstDataRow - startRow;
    startRow = CFG.log.firstDataRow;
  }
  if (numRows < 1) {
    ui.alert('Delete a session', 'Select the session row(s) in the table first.', ui.ButtonSet.OK);
    return;
  }
  var resp = ui.alert(
    'Delete ' + numRows + ' row(s)?',
    'This removes the selected session(s) from the Time Log. You can undo it from File → Version history if needed.',
    ui.ButtonSet.YES_NO
  );
  if (resp === ui.Button.YES) sh.deleteRows(startRow, numRows);
}

/** Sorts the Time Log data rows by date, oldest first (public entry). */
function sortLogByDate() {
  if (sortLogByDate_(makeCtx_())) notify_(makeCtx_(), 'Time Log sorted by date (oldest first).');
  else notify_(makeCtx_(), 'Nothing to sort yet.');
}

/**
 * Sorts the Time Log data rows by the Date column, ascending. Each row's
 * Date/Hours/Rate/Amount formulas reference its OWN row, so they follow the row
 * and stay correct after the sort. Returns false if there's nothing to sort.
 */
function sortLogByDate_(ctx) {
  var sh = ctx.ss.getSheetByName(CFG.sheets.log);
  var last = sh.getLastRow();
  if (last <= CFG.log.firstDataRow) return false;
  sh.getRange(CFG.log.firstDataRow, 1, last - CFG.log.firstDataRow + 1, CFG.log.lastCol)
    .sort({ column: CFG.log.cols.date, ascending: true });
  return true;
}

/**
 * Distinct recently-used task names, most-recent first (by the Date column), for
 * the sidebar autocomplete + chips (the phone Dashboard picker uses its own live
 * QUERY). Case-insensitive dedupe keeps the first-seen casing; a task with no
 * date sorts last. Reads only Date + Task (cols 1..task), so it's a cheap scan.
 */
function getRecentTasks_(ctx, limit) {
  limit = limit || 12;
  var sh = ctx.ss.getSheetByName(CFG.sheets.log);
  if (!sh) return [];
  var last = sh.getLastRow();
  if (last < CFG.log.firstDataRow) return [];
  var c = CFG.log.cols;
  var n = last - CFG.log.firstDataRow + 1;
  var vals = sh.getRange(CFG.log.firstDataRow, 1, n, c.task).getValues();
  var byKey = {};
  var order = [];
  for (var i = 0; i < vals.length; i++) {
    var task = String(vals[i][c.task - 1] || '').trim();
    if (!task) continue;
    var date = vals[i][c.date - 1];
    var t = date instanceof Date ? date.getTime() : 0;
    var key = task.toLowerCase();
    if (!(key in byKey)) {
      byKey[key] = { task: task, t: t };
      order.push(key);
    } else if (t > byKey[key].t) {
      byKey[key].t = t;
    }
  }
  order.sort(function (a, b) { return byKey[b].t - byKey[a].t; });
  return order.slice(0, limit).map(function (k) { return byKey[k].task; });
}
