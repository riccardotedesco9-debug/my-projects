// build-sheets.js — per-sheet builders: Clients, Time Log, Settings, Report
// shell. (Dashboard + Summary live in build-dashboard.js.) Only rebuild_()
// calls these.

/**
 * Resizes a sheet's grid to `target` rows — grows a small grid, trims the empty
 * tail off a bloated one — but NEVER below the last row holding data, so a
 * logged row can never be deleted. Returns the resulting row count.
 */
function trimGrid_(sh, target) {
  var safe = Math.max(target, sh.getLastRow());
  var maxR = sh.getMaxRows();
  if (maxR < safe) sh.insertRowsAfter(maxR, safe - maxR);
  else if (maxR > safe) sh.deleteRows(safe + 1, maxR - safe);
  return safe;
}

/**
 * Trims the derived sheets (Dashboard / Summary / Report) from Google's default
 * 1000 rows down to just above their content — no long empty scroll. Data-safe
 * via trimGrid_ (never cuts below content); the Report re-grows to fit on export.
 */
function trimDerivedGrids_(ss) {
  trimGrid_(ss.getSheetByName(CFG.sheets.dashboard), 50);
  trimGrid_(ss.getSheetByName(CFG.sheets.summary), 80);
  trimGrid_(ss.getSheetByName(CFG.sheets.report), 60);
}

function buildClientsSheet_(ss) {
  var sh = ss.getSheetByName(CFG.sheets.clients);
  trimGrid_(sh, 220); // trim the empty tail (a fresh sheet ships with ~1000 rows)
  sh.getRange(1, 1, 220, 5).setFontFamily(CFG.fontFamily);
  sh.getRange(1, 1, 1, 3)
    .setValues([CFG.clients.headers])
    .setBackground(CFG.colors.navy)
    .setFontColor(CFG.colors.white)
    .setFontWeight('bold');
  sh.setFrozenRows(1);

  // Seed the two starter clients ONLY on a fresh sheet — never clobber real
  // client data during a non-destructive layout update. Scan the WHOLE name
  // column: a cleared row 2 with real clients below is a valid state, and
  // re-seeding over it would re-price that client's history to €0.
  var lastClientRow = sh.getLastRow();
  var hasClients = lastClientRow >= 2 && sh.getRange(2, 1, lastClientRow - 1, 1).getValues()
    .some(function (r) { return String(r[0] || '').trim() !== ''; });
  if (!hasClients) {
    var seed = CFG.clients.seed.map(function (n) {
      return [n, '', ''];
    });
    sh.getRange(2, 1, seed.length, 3).setValues(seed);
  }
  sh.getRange(2, CFG.clients.cols.rate, 200, 1).setNumberFormat(CFG.formats.euro);

  sh.setColumnWidth(CFG.clients.cols.name, 180);
  sh.setColumnWidth(CFG.clients.cols.rate, 110);
  sh.setColumnWidth(CFG.clients.cols.email, 240);
  sh.setColumnWidth(5, 340);
  sh.getRange(1, 5)
    .setValue('Add a client = type a new row — every dropdown follows.\nRates ship blank: fill €/h. Email enables the monthly drafts.')
    .setFontStyle('italic')
    .setFontColor(CFG.colors.gray)
    .setFontSize(9)
    .setWrap(true);

  // Same click-to-sort/filter headers as the Time Log, on the Name/Rate/Email
  // table (A:C — the E-column note is separate). Idempotent for updateLayout.
  var oldFilter = sh.getFilter();
  if (oldFilter) oldFilter.remove();
  sh.getRange(1, 1, 200, 3).createFilter();
}

function buildLogSheet_(ss) {
  var sh = ss.getSheetByName(CFG.sheets.log);
  var c = CFG.log.cols;

  // One-time schema migration (v1 8-col → v2 9-col): the old layout put Rate at
  // column G. v2 inserts a Status column at G so a client view can import A2:G
  // (the label) without ever touching money, shifting Rate→H and Amount→I.
  // insertColumnBefore preserves the shifted data AND rewrites its per-row
  // formulas; it fires only while the header still reads the old shape, so it's
  // a no-op on a fresh build and idempotent on every later updateLayout.
  if (String(sh.getRange(1, c.status).getValue()) === 'Rate') {
    sh.insertColumnBefore(c.status);
  }

  // Size the grid to the format horizon (trims a bloated 5000-row grid down, or
  // grows a fresh one up) — but never below the data. Everything below formats
  // to exactly this many rows.
  var n = trimGrid_(sh, CFG.log.formatRows);
  // Clear any prior banding so this is safe to re-run on an existing (data-
  // filled) log during a non-destructive layout update — applyRowBanding would
  // otherwise throw over existing banding.
  sh.getBandings().forEach(function (b) { b.remove(); });

  sh.getRange(1, 1, 1, CFG.log.lastCol)
    .setValues([CFG.log.headers])
    .setFontWeight('bold')
    .setFontColor(CFG.colors.white)
    .setBackground(CFG.colors.navy)
    .setHorizontalAlignment('center');
  sh.setFrozenRows(1);

  // Banded rows (header + alternating white/grayFill body).
  sh.getRange(1, 1, n, CFG.log.lastCol)
    .applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false)
    .setHeaderRowColor(CFG.colors.navy)
    .setFirstRowColor(CFG.colors.white)
    .setSecondRowColor(CFG.colors.grayFill);

  var body = n - 1;
  sh.getRange(1, 1, n, CFG.log.lastCol).setFontFamily(CFG.fontFamily);
  sh.getRange(2, c.date, body, 1).setNumberFormat(CFG.formats.date);
  sh.getRange(2, c.start, body, 2).setNumberFormat(CFG.formats.time).setHorizontalAlignment('center');
  sh.getRange(2, c.hours, body, 1).setNumberFormat(CFG.formats.hours);
  sh.getRange(2, c.rate, body, 2).setNumberFormat(CFG.formats.euro);
  // Right-align the Amount column so a "Free" (text) row lines up with the
  // right-aligned € numbers instead of hanging off to the left.
  sh.getRange(2, c.amount, body, 1).setHorizontalAlignment('right');

  // Refresh the per-row Status formula on every existing data row, so a formula
  // change (or a v1→v2 migration's blank inserted column) propagates on every
  // rebuild / Update layout. The client-blank guard keeps empty rows blank.
  var statusLast = sh.getLastRow();
  if (statusLast >= CFG.log.firstDataRow) {
    var statusFs = [];
    for (var sr = CFG.log.firstDataRow; sr <= statusLast; sr++) statusFs.push([statusFormulaText_(sr)]);
    sh.getRange(CFG.log.firstDataRow, c.status, statusFs.length, 1).setFormulas(statusFs).setHorizontalAlignment('center');
  }

  // Client dropdown fed straight from the Clients sheet (open-ended range →
  // a newly typed client appears everywhere immediately).
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(ss.getRange("'" + CFG.sheets.clients + "'!A2:A"), true)
    .setAllowInvalid(false)
    .setHelpText('Pick a client from the Clients sheet (add one there first if missing).')
    .build();
  sh.getRange(2, c.client, body, 1).setDataValidation(rule);

  // Conditional formats on the DATE cell. Google Sheets applies only the FIRST
  // matching rule per cell, so a busy day that ALSO crosses midnight would lose
  // one of its two cues. To keep BOTH, the "midnight + busy" cases are their own
  // rules that set red font AND amber background together, and come first; plain
  // busy and plain midnight follow. Busiest shade wins via order (>12 → >10 →
  // >8). Busy shading sits only on the date cell, so the Hours colour-scale
  // (below) is never covered.
  var dateRange = sh.getRange(2, c.date, body, 1);
  var statusRange = sh.getRange(2, c.status, body, 1);
  var amountRange = sh.getRange(2, c.amount, body, 1);
  var busy = function (n) { return 'SUMIF($A:$A,$A2,$F:$F)>' + n; };
  var midnight = '$E2<>"", INT($E2)>INT($D2)';
  var hoursScale = SpreadsheetApp.newConditionalFormatRule()
    .setGradientMinpoint(CFG.colors.white)
    .setGradientMaxpoint(CFG.colors.tealSoft)
    .setRanges([sh.getRange(2, c.hours, body, 1)])
    .build();
  // Running rows (Start set, End blank) get a soft-teal Status cell; free rows
  // (Amount = the literal "Free") show a green Amount. Both target their OWN
  // column, so they never collide with the date/hours cues above.
  var inProgressRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND($D2<>"", $E2="")')
    .setBackground(CFG.colors.tealSoft)
    .setRanges([statusRange])
    .build();
  var freeRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$I2="Free"')
    .setFontColor(CFG.colors.green)
    .setRanges([amountRange])
    .build();
  sh.setConditionalFormatRules([
    dateRule_(dateRange, '=AND($A2<>"", ' + midnight + ', ' + busy(12) + ')', CFG.colors.amberDeep, CFG.colors.red),
    dateRule_(dateRange, '=AND($A2<>"", ' + midnight + ', ' + busy(10) + ')', CFG.colors.amberMid, CFG.colors.red),
    dateRule_(dateRange, '=AND($A2<>"", ' + midnight + ', ' + busy(8) + ')', CFG.colors.amber, CFG.colors.red),
    dateRule_(dateRange, '=AND(' + midnight + ')', null, CFG.colors.red),
    dateRule_(dateRange, '=AND($A2<>"", ' + busy(12) + ')', CFG.colors.amberDeep, null),
    dateRule_(dateRange, '=AND($A2<>"", ' + busy(10) + ')', CFG.colors.amberMid, null),
    dateRule_(dateRange, '=AND($A2<>"", ' + busy(8) + ')', CFG.colors.amber, null),
    hoursScale,
    inProgressRule,
    freeRule,
  ]);

  var widths = { 1: 92, 2: 150, 3: 230, 4: 64, 5: 64, 6: 62, 7: 96, 8: 84, 9: 100 };
  Object.keys(widths).forEach(function (col) {
    sh.setColumnWidth(Number(col), widths[col]);
  });

  // Excel-style clickable headers: one basic filter puts a sort/filter dropdown
  // on every column header (Sort A→Z / Z→A, filter by value) — click the Date
  // header to flip oldest/newest, exactly like a spreadsheet filter. Idempotent
  // for updateLayout: createFilter throws if one already exists, so drop the
  // prior filter first. Sorting re-orders whole rows, so per-row formulas follow.
  var oldFilter = sh.getFilter();
  if (oldFilter) oldFilter.remove();
  sh.getRange(1, 1, n, CFG.log.lastCol).createFilter();
}

/** A date-cell conditional rule with an optional background and/or font color. */
function dateRule_(range, formula, bg, font) {
  var b = SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(formula).setRanges([range]);
  if (bg) b = b.setBackground(bg);
  if (font) b = b.setFontColor(font);
  return b.build();
}

function buildSettingsSheet_(ss) {
  var sh = ss.getSheetByName(CFG.sheets.settings);
  sh.getRange('B2')
    .setValue('INTERNAL — running timers now live as Time Log rows (Start set, End blank). No scalar timer state is stored here.')
    .setFontStyle('italic')
    .setFontColor(CFG.colors.gray)
    .setFontSize(9);

  sh.getRange('B9').setValue('Schema').setFontColor(CFG.colors.gray);
  sh.getRange('C9').setValue(CFG.schemaVersion);
  sh.setColumnWidth(2, 90);
  sh.setColumnWidth(3, 320);
  sh.hideSheet();
}

/**
 * Report shell: static chrome only. The body is regenerated by every export
 * (report.js) — this sheet is a disposable rendering surface, never data.
 * The whole sheet is what the PDF export renders, so it carries NO screen
 * hints; content starts at row 3.
 */
function buildReportShell_(ss) {
  var sh = ss.getSheetByName(CFG.sheets.report);
  sh.setHiddenGridlines(true);
  sh.getRange(1, 1, 400, 9).setFontFamily(CFG.fontFamily);

  var widths = { 1: 24, 2: 95, 3: 150, 4: 250, 5: 70, 6: 70, 7: 70, 8: 90, 9: 105 };
  Object.keys(widths).forEach(function (col) {
    sh.setColumnWidth(Number(col), widths[col]);
  });
}
