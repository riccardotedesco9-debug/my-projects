// viewers.js — per-client live view-only spreadsheets. Each viewer pulls that
// client's sessions from the tracker via IMPORTRANGE + QUERY. Hours only —
// Rate/Amount never leave the tracker (money appears only in PDFs, when chosen).

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
  var folder = getViewersFolder_();
  return {
    clients: getClientNames_(ctx).map(function (name) {
      return {
        name: name,
        hasView: folder.getFilesByName('Hours — ' + name + ' — ' + CFG.ownerName).hasNext(),
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

/** Creates (or rebuilds in place) the viewer spreadsheet for one client. */
function createClientViewer_(ctx, client) {
  var title = 'Hours — ' + client + ' — ' + CFG.ownerName;
  var folder = getViewersFolder_();
  var existing = folder.getFilesByName(title);
  var created = !existing.hasNext();
  var viewer = created
    ? SpreadsheetApp.create(title)
    : SpreadsheetApp.openById(existing.next().getId());

  buildViewerContent_(viewer, ctx.ss.getId(), client);

  var file = DriveApp.getFileById(viewer.getId());
  if (created) {
    file.moveTo(folder);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  }
  return { url: viewer.getUrl(), id: viewer.getId(), created: created };
}

/**
 * The client-facing SUMMARY page — a live mini-dashboard for ONE client,
 * hours only. Layout: headline stat cards, then a charts band (hours-by-month
 * columns + where-the-time-goes pie), then the transparent numbers: monthly
 * table + top-tasks table on the left, latest-first session list on the
 * right. Rate/€ are never imported (only Log!A2:F), so money physically
 * cannot appear here.
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
  sh.getRange('A1:S1000').setFontFamily(CFG.fontFamily);
  sh.setColumnWidth(1, 24);
  // B..D stats + tables strip, E spacer, F..J sessions table, K edge.
  [150, 90, 110, 24, 95, 320, 70, 70, 80, 24].forEach(function (w, i) {
    sh.setColumnWidth(i + 2, w);
  });

  sh.getRange('B2:D2').merge();
  sh.getRange('B2').setValue('HOURS SUMMARY — ' + client.toUpperCase())
    .setFontSize(16).setFontWeight('bold').setFontColor(CFG.colors.navy);
  sh.getRange('B3:F3').merge();
  sh.getRange('B3')
    .setValue('Live view · prepared by ' + CFG.ownerName + ' · updates automatically as work is logged')
    .setFontColor(CFG.colors.gray).setFontSize(9).setFontStyle('italic');

  // GViz string literals: use DOUBLE-quoted literals so apostrophe names
  // ("Paws 'n' Claws") survive; inside the sheet-formula string a literal
  // double quote is written as "". Strip any double quotes from the name.
  var q = client.replace(/"/g, '');
  var imp = 'IMPORTRANGE("' + trackerId + '", "' + CFG.sheets.log + '!A2:F")';

  // --- Headline stats (computed from the sessions spill below) ---
  sectionHeader_(sh.getRange('B5'), 'TOTAL HOURS');
  sh.getRange('B6').setFormula('=IFERROR(ROUND(SUM($J$23:$J$1000), 2), 0)')
    .setNumberFormat('0.00 "h"').setFontSize(16).setFontWeight('bold').setFontColor(CFG.colors.navy);
  sectionHeader_(sh.getRange('C5'), 'SESSIONS');
  sh.getRange('C6').setFormula('=COUNT($F$23:$F$1000)')
    .setNumberFormat('0').setFontSize(16).setFontWeight('bold').setFontColor(CFG.colors.navy);
  sectionHeader_(sh.getRange('D5'), 'THIS MONTH');
  sh.getRange('D6').setFormula(
    '=IFERROR(ROUND(SUMIFS($J$23:$J$1000, $F$23:$F$1000, ">="&EOMONTH(TODAY(),-1)+1, ' +
    '$F$23:$F$1000, "<="&EOMONTH(TODAY(),0)), 2), 0)'
  ).setNumberFormat('0.00 "h"').setFontSize(16).setFontWeight('bold').setFontColor(CFG.colors.navy);
  sh.setRowHeight(6, 30);
  card_(sh.getRange('B5:D6'));

  // --- Hidden chart/table data (N..S): trailing-24-month totals + top tasks ---
  sh.getRange('N6').setValue('Chart data — do not edit').setFontColor(CFG.colors.gray).setFontSize(8);
  sh.getRange('N7').setFormula(
    '=IFERROR(QUERY(' + imp + ", \"select year(Col1), month(Col1)+1, sum(Col6) " +
      'where Col2 = ""' + q + '"" ' +
      "and Col1 >= date '\"&TEXT(EOMONTH(TODAY(),-24)+1,\"yyyy-mm-dd\")&\"' " +
      "group by year(Col1), month(Col1) order by year(Col1), month(Col1) " +
      "label year(Col1) '', month(Col1)+1 '', sum(Col6) ''\", 0), \"\")"
  );
  sh.getRange('R7').setFormula(
    '=IFERROR(QUERY(' + imp + ", \"select Col3, sum(Col6) " +
      'where Col2 = ""' + q + '"" group by Col3 ' +
      "order by sum(Col6) desc limit 8 " +
      "label Col3 '', sum(Col6) ''\", 0), \"\")"
  );
  sh.hideColumns(14, 6); // N..S — working data, not part of the page

  // --- Charts band (rows 8-19 stay empty cells; the charts float there) ---
  sh.insertChart(
    sh.newChart()
      .setChartType(Charts.ChartType.COLUMN)
      .addRange(sh.getRange('B22:C46'))
      .setNumHeaders(1)
      .setOption('title', 'Hours by month')
      .setOption('legend', { position: 'none' })
      .setOption('colors', [CFG.colors.teal])
      .setOption('backgroundColor', 'white')
      .setOption('width', 420)
      .setOption('height', 230)
      .setPosition(8, 2, 0, 0)
      .build()
  );
  sh.insertChart(
    sh.newChart()
      .setChartType(Charts.ChartType.PIE)
      .addRange(sh.getRange('B50:C58'))
      .setNumHeaders(1)
      .setOption('title', 'Where the time goes')
      .setOption('legend', { position: 'right', textStyle: { fontSize: 10 } })
      .setOption('pieSliceText', 'percentage')
      .setOption('colors', [
        CFG.colors.teal, CFG.colors.navy, CFG.colors.gold, CFG.colors.tealSoft,
        CFG.colors.green, CFG.colors.gray, CFG.colors.amberDeep, CFG.colors.red,
      ])
      .setOption('pieSliceBorderColor', 'white')
      .setOption('backgroundColor', 'white')
      .setOption('width', 420)
      .setOption('height', 230)
      .setPosition(8, 7, 0, 0)
      .build()
  );

  // --- The numbers behind the charts (left strip) ---
  sectionHeader_(sh.getRange('B21'), 'HOURS BY MONTH');
  sh.getRange('B22').setValue('Month').setFontWeight('bold').setFontColor(CFG.colors.gray).setFontSize(9);
  sh.getRange('C22').setValue('Hours').setFontWeight('bold').setFontColor(CFG.colors.gray).setFontSize(9);
  sh.getRange('B23').setFormula('=ARRAYFORMULA(IF($N$7:$N$30="",, DATE($N$7:$N$30, $O$7:$O$30, 1)))');
  sh.getRange('B23:B46').setNumberFormat(CFG.formats.monthShort);
  sh.getRange('C23').setFormula('=ARRAYFORMULA(IF($N$7:$N$30="",, $P$7:$P$30))');
  sh.getRange('C23:C46').setNumberFormat(CFG.formats.hours);
  card_(sh.getRange('B21:C47'));
  sectionHeader_(sh.getRange('B49'), 'WHERE THE TIME GOES');
  sh.getRange('B50').setValue('Task').setFontWeight('bold').setFontColor(CFG.colors.gray).setFontSize(9);
  sh.getRange('C50').setValue('Hours').setFontWeight('bold').setFontColor(CFG.colors.gray).setFontSize(9);
  sh.getRange('B51').setFormula('=ARRAYFORMULA(IF($R$7:$R$14="",, $R$7:$R$14))');
  sh.getRange('C51').setFormula('=ARRAYFORMULA(IF($R$7:$R$14="",, $S$7:$S$14))');
  sh.getRange('C51:C58').setNumberFormat(CFG.formats.hours);
  card_(sh.getRange('B49:C59'));

  // --- Sessions list (right strip; latest first) ---
  sh.getRange('F21').setValue('SESSIONS').setFontWeight('bold').setFontColor(CFG.colors.navy).setFontSize(10);
  // Fallback is '' — an empty log also lands here, so it must NOT claim an
  // access problem; the H2 anchor is the dedicated access indicator.
  sh.getRange('F22').setFormula(
    '=IFERROR(QUERY(' + imp + ", \"select Col1, Col3, Col4, Col5, Col6 " +
      'where Col2 = ""' + q + '"" order by Col1 desc, Col4 desc ' +
      "label Col1 'Date', Col3 'Task', Col4 'Start', Col5 'End', Col6 'Hours'\", 0), \"\")"
  );
  // Sessions spill starts at F22 (header) → F23 down: F date, G task, H start, I end, J hours.
  sh.getRange('F23:F1000').setNumberFormat(CFG.formats.date);
  sh.getRange('H23:I1000').setNumberFormat(CFG.formats.time);
  sh.getRange('J23:J1000').setNumberFormat(CFG.formats.hours);

  // Bare IMPORTRANGE anchor: the "Allow access" prompt only appears on an
  // unwrapped call — IFERROR-wrapped formulas would hide it forever.
  sh.getRange('H2').setFormula('=' + imp.replace(CFG.sheets.log + '!A2:F', CFG.sheets.log + '!A1'));
  sh.getRange('H2').setFontColor(CFG.colors.grayLine).setFontSize(8);
  sh.getRange('G2').setValue('if #REF appears → click it, then "Allow access"')
    .setFontColor(CFG.colors.grayLine).setFontSize(8).setHorizontalAlignment('right');
}
