// viewers.js — per-client live view-only spreadsheets. Each viewer pulls that
// client's sessions from the tracker via IMPORTRANGE + QUERY. Hours + a Status
// label only (imports Log!A2:G) — Rate/Amount (H/I) never leave the tracker, so
// money physically cannot appear here (it lives only in PDFs, when chosen).

/** Menu entry: pick a client from a dropdown, create/refresh, copy the link. */
function showClientViewDialog() {
  var html = HtmlService.createHtmlOutputFromFile('client-view-dialog')
    .setWidth(420)
    .setHeight(400);
  SpreadsheetApp.getUi().showModalDialog(html, 'Live client views');
}

/** Dialog model: every client + whether its live view file already exists. */
function getClientViewModel() {
  var ctx = makeCtx_();
  return {
    clients: getClientNames_(ctx).map(function (name) {
      return {
        name: name,
        hasView: DriveApp.getFilesByName(viewerTitle_(name)).hasNext(),
      };
    }),
  };
}

/** Dialog action: create or refresh one client's live view; returns the link. */
function createClientView(name) {
  var ctx = makeCtx_();
  name = String(name || '').trim();
  if (!clientExists_(ctx, name)) return { ok: false, msg: MSG.unknownClient(name) };
  var res = createClientViewer_(ctx, name);
  return { ok: true, url: res.url, created: res.created, client: name };
}

/** A client's live-view file title — the one stable name we look it up by. */
function viewerTitle_(client) {
  return 'Hours — ' + client + ' — ' + CFG.ownerName;
}

/** Creates (or rebuilds in place) the viewer spreadsheet for one client. */
function createClientViewer_(ctx, client) {
  var title = viewerTitle_(client);
  var folder = getViewersFolder_();
  // Prefer the correctly-filed copy in Client Views/; only fall back to a
  // Drive-wide lookup when it isn't there, so a file that drifted out of the
  // folder is reused (and re-filed below) instead of duplicated — without
  // reaching for an unrelated same-titled file in the common case.
  var inFolder = folder.getFilesByName(title);
  var existing = inFolder.hasNext() ? inFolder : DriveApp.getFilesByName(title);
  var created = !existing.hasNext();
  var viewer = created
    ? SpreadsheetApp.create(title)
    : SpreadsheetApp.openById(existing.next().getId());

  buildViewerContent_(viewer, ctx.ss.getId(), client);

  // Always keep it filed under Client Views/ — new files are born in My Drive
  // root, and a refresh re-homes one that got moved out. Sharing is set once.
  var file = DriveApp.getFileById(viewer.getId());
  var filed = false;
  var parents = file.getParents();
  while (parents.hasNext()) {
    if (parents.next().getId() === folder.getId()) filed = true;
  }
  if (!filed) file.moveTo(folder);
  if (created) file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { url: viewer.getUrl(), id: viewer.getId(), created: created };
}

/**
 * The client-facing SUMMARY page — a live mini-dashboard for ONE client,
 * hours only. Layout: headline stat cards, then a charts band (hours-by-month
 * columns + where-the-time-goes pie), then the transparent numbers: monthly
 * table + top-tasks table on the left, latest-first session list on the
 * right. Rate/€ are never imported (only Log!A2:G — date…hours + Status), so
 * money physically cannot appear here.
 */
function buildViewerContent_(viewer, trackerId, client) {
  viewer.setSpreadsheetLocale('en_GB');
  viewer.setSpreadsheetTimeZone('Europe/Malta');

  // Reset to a single known sheet.
  var tmp = viewer.insertSheet('__rebuild__');
  viewer.getSheets().forEach(function (sh) {
    if (sh.getSheetId() !== tmp.getSheetId()) viewer.deleteSheet(sh);
  });
  var sh = viewer.insertSheet('Summary', 0);
  viewer.deleteSheet(tmp);

  sh.setHiddenGridlines(true);
  sh.getRange('A1:S500').setFontFamily(CFG.fontFamily);
  // A margin · B-D stat cards (chart zone floats here) · E gap · F-J sessions
  // · P-S hidden chart helpers.
  var widths = { 1: 24, 2: 150, 3: 92, 4: 110, 5: 24, 6: 95, 7: 230, 8: 62, 9: 62, 10: 62, 11: 96, 12: 24 };
  Object.keys(widths).forEach(function (col) { sh.setColumnWidth(Number(col), widths[col]); });

  // --- Title + subtitle (span the full width so long names never clip) ---
  sh.getRange('B2:K2').merge();
  sh.getRange('B2').setValue('HOURS SUMMARY — ' + client.toUpperCase())
    .setFontSize(16).setFontWeight('bold').setFontColor(CFG.colors.navy);
  sh.getRange('B3:K3').merge();
  sh.getRange('B3')
    .setValue('Live view · prepared by ' + CFG.ownerName + ' · updates automatically as work is logged')
    .setFontColor(CFG.colors.gray).setFontSize(9).setFontStyle('italic');

  // GViz string literals: use DOUBLE-quoted literals so apostrophe names
  // ("Paws 'n' Claws") survive; inside the sheet-formula string a literal
  // double quote is written as "". Strip any double quotes from the name.
  var q = client.replace(/"/g, '');
  var imp = 'IMPORTRANGE("' + trackerId + '", "' + CFG.sheets.log + '!A2:G")';

  // --- Sessions list (right zone F-K; the SINGLE IMPORTRANGE data source) ---
  sh.getRange('F5').setValue('SESSIONS').setFontWeight('bold').setFontColor(CFG.colors.navy).setFontSize(10);
  // Fallback is '' — an empty log also lands here, so it must NOT claim an
  // access problem; the bottom anchor is the dedicated access indicator.
  // limit 480 keeps the spill inside the 500-row grid (below); a client with
  // more than that shows their most recent 480 sessions. Col7 = the Status
  // label (In Progress / Free / Finished) — carries no money.
  sh.getRange('F6').setFormula(
    '=IFERROR(QUERY(' + imp + ", \"select Col1, Col3, Col4, Col5, Col6, Col7 " +
      'where Col2 = ""' + q + '"" order by Col1 desc, Col4 desc limit 480 ' +
      "label Col1 'Date', Col3 'Task', Col4 'Start', Col5 'End', Col6 'Hours', Col7 'Status'\", 0), \"\")"
  );
  // QUERY renders its labels on F6, data from F7 down: F date G task H start I end
  // J hours K status. In-progress rows sort to the top (latest date+start, blank
  // end/hours) and show "In Progress"; free rows show "Free" — the client sees both.
  sh.getRange('F6:K6').setFontWeight('bold').setFontColor(CFG.colors.gray).setFontSize(9)
    .setBorder(null, null, true, null, false, false, CFG.colors.grayLine, SpreadsheetApp.BorderStyle.SOLID);
  // Header alignment matches each column's values: Date/Task read as left labels;
  // Start/End/Hours/Status are the compact, centred block — so headers sit over
  // their values instead of drifting.
  sh.getRange('F6:G6').setHorizontalAlignment('left');
  sh.getRange('H6:K6').setHorizontalAlignment('center');
  sh.getRange('F7:F500').setNumberFormat(CFG.formats.date).setHorizontalAlignment('left');
  sh.getRange('H7:I500').setNumberFormat(CFG.formats.time).setHorizontalAlignment('center');
  sh.getRange('J7:J500').setNumberFormat(CFG.formats.hours).setHorizontalAlignment('center');
  sh.getRange('K7:K500').setHorizontalAlignment('center').setFontSize(9);

  // --- Highlighting, mirroring the Time Log exactly: the amber busy-day flag
  // lives on the DATE column ONLY (deeper as the day's total climbs), an
  // overnight session turns its DATE red, and the HOURS column carries the
  // white→teal (green) scale — never amber. First-match-wins, so the combined
  // midnight+busy rules come first. $F/$H/$I lock the column so each date cell
  // tests its own row's day. Amber and the green scale sit on separate columns,
  // so they never fight (and no multi-range relative-ref quirk). ---
  var dateCol = sh.getRange('F7:F500');
  var hoursCol = sh.getRange('J7:J500');
  var statusCol = sh.getRange('K7:K500');
  var busy = function (n) { return 'SUMIF($F$7:$F$500,$F7,$J$7:$J$500)>' + n; };
  var midnight = '$I7<>"", INT($I7)>INT($H7)';
  var vRule = function (formula, bg, font) {
    var b = SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(formula).setRanges([dateCol]);
    if (bg) b = b.setBackground(bg);
    if (font) b = b.setFontColor(font);
    return b.build();
  };
  sh.setConditionalFormatRules([
    vRule('=AND($F7<>"", ' + midnight + ', ' + busy(12) + ')', CFG.colors.amberDeep, CFG.colors.red),
    vRule('=AND($F7<>"", ' + midnight + ', ' + busy(10) + ')', CFG.colors.amberMid, CFG.colors.red),
    vRule('=AND($F7<>"", ' + midnight + ', ' + busy(8) + ')', CFG.colors.amber, CFG.colors.red),
    vRule('=AND(' + midnight + ')', null, CFG.colors.red),
    vRule('=AND($F7<>"", ' + busy(12) + ')', CFG.colors.amberDeep, null),
    vRule('=AND($F7<>"", ' + busy(10) + ')', CFG.colors.amberMid, null),
    vRule('=AND($F7<>"", ' + busy(8) + ')', CFG.colors.amber, null),
    SpreadsheetApp.newConditionalFormatRule()
      .setGradientMinpoint(CFG.colors.white)
      .setGradientMaxpoint(CFG.colors.tealSoft)
      .setRanges([hoursCol])
      .build(),
    // Status column: a live task reads "In Progress" (soft teal); a no-charge
    // one reads "Free" (green) — so the client sees both at a glance.
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$K7="In Progress"')
      .setBackground(CFG.colors.tealSoft)
      .setFontColor(CFG.colors.navy)
      .setRanges([statusCol])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$K7="Free"')
      .setBackground('#E8F5E9')
      .setFontColor(CFG.colors.green)
      .setRanges([statusCol])
      .build(),
  ]);

  // --- Headline stats (left zone; read the sessions spill, hours only).
  // Values are left-aligned so each number sits directly under its label. ---
  sectionHeader_(sh.getRange('B5'), 'TOTAL HOURS');
  sh.getRange('B6').setFormula('=IFERROR(ROUND(SUM($J$7:$J$500), 2), 0)')
    .setNumberFormat('0.00 "h"').setFontSize(15).setFontWeight('bold').setFontColor(CFG.colors.navy)
    .setHorizontalAlignment('left');
  sectionHeader_(sh.getRange('C5'), 'SESSIONS');
  // Count the End column, not Date — a running (in-progress) session has a Date
  // but no End yet, so it doesn't inflate the completed-session count.
  sh.getRange('C6').setFormula('=COUNT($I$7:$I$500)')
    .setNumberFormat('0').setFontSize(15).setFontWeight('bold').setFontColor(CFG.colors.navy)
    .setHorizontalAlignment('left');
  sectionHeader_(sh.getRange('D5'), 'THIS MONTH');
  sh.getRange('D6').setFormula(
    '=IFERROR(ROUND(SUMIFS($J$7:$J$500, $F$7:$F$500, ">="&EOMONTH(TODAY(),-1)+1, ' +
    '$F$7:$F$500, "<="&EOMONTH(TODAY(),0)), 2), 0)'
  ).setNumberFormat('0.00 "h"').setFontSize(15).setFontWeight('bold').setFontColor(CFG.colors.navy)
    .setHorizontalAlignment('left');
  sh.setRowHeight(6, 28);
  card_(sh.getRange('B5:D6'));

  // --- Hidden chart helpers (P-S): rollups computed LOCALLY from the sessions
  // spill (F=date, G=task, J=hours) — no second IMPORTRANGE, and no GViz
  // date-function quirks over imported columns (which silently blank out). ---
  sh.getRange('P2').setValue('Month');
  sh.getRange('Q2').setValue('Hours');
  // EOMONTH over the WHOLE column keeps Col1 a single date type (empty rows
  // harmlessly become 1899-12-31); a mixed date/blank column makes GViz QUERY
  // silently return nothing. The trailing-24-month floor drops the 1899 blanks
  // AND, for a long-running client, keeps the chart on RECENT months (bounded
  // to the P3:Q26 helper) instead of the oldest 24.
  sh.getRange('P3').setFormula(
    '=IFERROR(QUERY({ARRAYFORMULA(EOMONTH($F$7:$F$500, 0)), $J$7:$J$500}, ' +
      "\"select Col1, sum(Col2) where Col1 >= date '\"&TEXT(EOMONTH(TODAY(),-23)+1,\"yyyy-mm-dd\")&\"' " +
      "group by Col1 order by Col1 label Col1 '', sum(Col2) ''\", 0), \"\")"
  );
  sh.getRange('P3:P26').setNumberFormat(CFG.formats.monthShort);
  sh.getRange('Q3:Q26').setNumberFormat(CFG.formats.hours);
  sh.getRange('R2').setValue('Task');
  sh.getRange('S2').setValue('Hours');
  sh.getRange('R3').setFormula(
    '=IFERROR(QUERY({$G$7:$G$500, $J$7:$J$500}, ' +
      "\"select Col1, sum(Col2) where Col2 > 0 group by Col1 " +
      "order by sum(Col2) desc limit 8 label Col1 '', sum(Col2) ''\", 0), \"\")"
  );
  sh.getRange('S3:S10').setNumberFormat(CFG.formats.hours);
  // Pie legend labels "Task — X.Xh": the legend carries the hours; the % lives
  // on the slice itself (no duplication). Short labels also mean the right-side
  // legend never clips, freeing width for a bigger pie.
  sh.getRange('T3').setFormula(
    '=ARRAYFORMULA(IF($R$3:$R$10="", "", $R$3:$R$10 & " — " & TEXT($S$3:$S$10, "0.0") & "h"))'
  );
  sh.hideColumns(16, 5); // P-T — working data, off the page

  // --- Charts, stacked flush-left (cols A-E, clear of the sessions in F+).
  // Each chart is titled by a navy sheet CELL above it (Sheets' embedded-chart
  // renderer ignores a chart's own titleTextStyle colour — same reason the
  // report titles its pie with a cell), so the titles read navy, not faint grey. ---
  sh.getRange('B7').setValue('Hours by month').setFontWeight('bold').setFontColor(CFG.colors.navy).setFontSize(11);
  sh.insertChart(
    sh.newChart().setChartType(Charts.ChartType.COLUMN)
      .addRange(sh.getRange('P2:Q26')).setNumHeaders(1)
      .setOption('title', '')
      .setOption('legend', { position: 'none' })
      .setOption('colors', [CFG.colors.teal])
      .setOption('backgroundColor', 'white')
      .setOption('width', 400).setOption('height', 180)
      .setPosition(8, 1, 0, 0).build()
  );
  // Pie, matching the timesheet report's breakdown — same navy/teal/gold ramp.
  // Legend on the right carries each task's HOURS ("Task — X.Xh"); the % sits
  // on the slice. The taller 280px frame + short (un-clipped) labels give the
  // pie a big radius, so even the thinner slices have room for their on-slice %.
  sh.getRange('B18').setValue('Where the time goes').setFontWeight('bold').setFontColor(CFG.colors.navy).setFontSize(11);
  sh.insertChart(
    sh.newChart().setChartType(Charts.ChartType.PIE)
      .addRange(sh.getRange('T3:T10')) // labels: "Task — X.Xh"
      .addRange(sh.getRange('S3:S10')) // values: hours
      .setOption('title', '')
      .setOption('legend', { position: 'right', textStyle: { fontSize: 9, color: CFG.colors.navy } })
      .setOption('pieSliceText', 'percentage')
      .setOption('colors', [
        CFG.colors.teal, CFG.colors.navy, CFG.colors.gold, CFG.colors.tealSoft,
        CFG.colors.green, CFG.colors.gray, CFG.colors.amberDeep, CFG.colors.red,
      ])
      .setOption('pieSliceBorderColor', 'white')
      .setOption('backgroundColor', 'white')
      .setOption('width', 400).setOption('height', 280)
      .setPosition(19, 1, 0, 0).build()
  );

  // --- One-time setup anchor, tucked below the left zone. The bare
  // (un-IFERROR'd) IMPORTRANGE is the only cell that can raise the "Allow
  // access" prompt; the owner grants it once. Both the anchor and its hint
  // VANISH the moment access is granted: the ";;;" format hides the imported
  // value (an un-granted #REF error ignores number formats, so the prompt is
  // never hidden), and the hint is an ISERROR formula that blanks once the
  // anchor resolves. So a granted, client-facing view shows nothing here. ---
  sh.getRange('B33').setFormula('=' + imp.replace(CFG.sheets.log + '!A2:G', CFG.sheets.log + '!A1'))
    .setNumberFormat(';;;').setFontColor(CFG.colors.grayLine).setFontSize(8);
  sh.getRange('C33').setFormula(
    '=IF(ISERROR($B$33), "One-time setup — if the cell on the left shows an error, click it and choose ""Allow access"".", "")'
  ).setFontColor(CFG.colors.grayLine).setFontSize(8);

  // Trim the grid so the view isn't a long scroll of empty cells: 500 rows
  // (holds the ≤480 sessions + helpers), and columns only through the hidden
  // helpers (T = 20). New sheets start at 1000×26.
  var extraRows = sh.getMaxRows() - 500;
  if (extraRows > 0) sh.deleteRows(501, extraRows);
  var extraCols = sh.getMaxColumns() - 20;
  if (extraCols > 0) sh.deleteColumns(21, extraCols);
}
