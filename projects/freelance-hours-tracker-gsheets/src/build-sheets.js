// build-sheets.js — per-sheet builders: Clients, Time Log, Settings, Report
// shell. (Dashboard + Summary live in build-dashboard.js.) Only rebuild_()
// calls these.

function buildClientsSheet_(ss) {
  var sh = ss.getSheetByName(CFG.sheets.clients);
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
}

function buildLogSheet_(ss) {
  var sh = ss.getSheetByName(CFG.sheets.log);
  var c = CFG.log.cols;
  var n = CFG.log.formatRows;

  // A fresh sheet ships with 1,000 rows — every n-row range below would
  // throw "outside the dimensions of the sheet" without this grow step.
  if (sh.getMaxRows() < n) sh.insertRowsAfter(sh.getMaxRows(), n - sh.getMaxRows());
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
  var busy = function (n) { return 'SUMIF($A:$A,$A2,$F:$F)>' + n; };
  var midnight = '$E2<>"", INT($E2)>INT($D2)';
  var hoursScale = SpreadsheetApp.newConditionalFormatRule()
    .setGradientMinpoint(CFG.colors.white)
    .setGradientMaxpoint(CFG.colors.tealSoft)
    .setRanges([sh.getRange(2, c.hours, body, 1)])
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
  ]);

  var widths = { 1: 95, 2: 150, 3: 260, 4: 70, 5: 70, 6: 70, 7: 95, 8: 105 };
  Object.keys(widths).forEach(function (col) {
    sh.setColumnWidth(Number(col), widths[col]);
  });
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
    .setValue('INTERNAL — timer state mirror (display only; the authoritative state lives in Script Properties)')
    .setFontStyle('italic')
    .setFontColor(CFG.colors.gray)
    .setFontSize(9);

  var labels = [['Status'], ['Started at'], ['Client'], ['Task']];
  sh.getRange(4, 2, labels.length, 1).setValues(labels).setFontColor(CFG.colors.gray);
  sh.getRange('C4').setValue('IDLE');
  sh.getRange('C5').setNumberFormat(CFG.formats.generated);
  ss.setNamedRange(CFG.named.stStatus, sh.getRange('C4'));
  ss.setNamedRange(CFG.named.stStartedAt, sh.getRange('C5'));
  ss.setNamedRange(CFG.named.stClient, sh.getRange('C6'));
  ss.setNamedRange(CFG.named.stTask, sh.getRange('C7'));

  sh.getRange('B9').setValue('Schema').setFontColor(CFG.colors.gray);
  sh.getRange('C9').setValue(CFG.schemaVersion);
  sh.setColumnWidth(2, 90);
  sh.setColumnWidth(3, 220);
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
