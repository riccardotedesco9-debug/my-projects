// viewers.js — per-client live view-only spreadsheets. Each viewer pulls that
// client's sessions from the tracker via IMPORTRANGE + QUERY. Hours only —
// Rate/Amount never leave the tracker (money appears only in PDFs, when chosen).

/** Menu entry: ask which client, create/refresh the viewer, show the link. */
function createClientViewerPrompt() {
  var ctx = makeCtx_();
  var ui = SpreadsheetApp.getUi();
  var names = getClientNames_(ctx);
  var resp = ui.prompt(
    'Create client view',
    'Type the client name exactly as on the Clients sheet:\n' + names.join(' · '),
    ui.ButtonSet.OK_CANCEL
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var client = resp.getResponseText().trim();
  if (!clientExists_(ctx, client)) {
    ui.alert(MSG.unknownClient(client));
    return;
  }
  var res = createClientViewer_(ctx, client);
  ui.alert(
    'Live view for ' + client,
    (res.created ? 'Created' : 'Refreshed') + ':\n' + res.url +
      '\n\nOne-time step: open it and click "Allow access" on the anchor cell, then share the link (view-only is already set).',
    ui.ButtonSet.OK
  );
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
 * The client-facing SUMMARY page: headline hour totals, an hours-by-month
 * chart, and the session list — for ONE client, hours only. Rate/€ are never
 * imported (only Log!A2:F), so money physically cannot appear here.
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
  sh.getRange('A1:P1000').setFontFamily(CFG.fontFamily);
  sh.setColumnWidth(1, 24);
  // B..D stats + monthly table, E spacer, F..J sessions table, K edge.
  [110, 110, 110, 24, 95, 320, 70, 70, 80, 24].forEach(function (w, i) {
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
  sh.getRange('B6').setFormula('=IFERROR(ROUND(SUM($J$7:$J$1000), 2), 0)')
    .setNumberFormat('0.00 "h"').setFontSize(16).setFontWeight('bold').setFontColor(CFG.colors.navy);
  sectionHeader_(sh.getRange('C5'), 'SESSIONS');
  sh.getRange('C6').setFormula('=COUNT($F$7:$F$1000)')
    .setNumberFormat('0').setFontSize(16).setFontWeight('bold').setFontColor(CFG.colors.navy);
  sectionHeader_(sh.getRange('D5'), 'THIS MONTH');
  sh.getRange('D6').setFormula(
    '=IFERROR(ROUND(SUMIFS($J$7:$J$1000, $F$7:$F$1000, ">="&EOMONTH(TODAY(),-1)+1, ' +
    '$F$7:$F$1000, "<="&EOMONTH(TODAY(),0)), 2), 0)'
  ).setNumberFormat('0.00 "h"').setFontSize(16).setFontWeight('bold').setFontColor(CFG.colors.navy);
  sh.setRowHeight(6, 30);
  card_(sh.getRange('B5:D6'));

  // --- Sessions list (right strip; latest first) ---
  sh.getRange('F5').setValue('SESSIONS').setFontWeight('bold').setFontColor(CFG.colors.navy).setFontSize(10);
  // Fallback is '' — an empty log also lands here, so it must NOT claim an
  // access problem; the H2 anchor is the dedicated access indicator.
  sh.getRange('F6').setFormula(
    '=IFERROR(QUERY(' + imp + ", \"select Col1, Col3, Col4, Col5, Col6 " +
      'where Col2 = ""' + q + '"" order by Col1 desc, Col4 desc ' +
      "label Col1 'Date', Col3 'Task', Col4 'Start', Col5 'End', Col6 'Hours'\", 0), \"\")"
  );
  // Sessions spill starts at F6 (header) → F7 down: F date, G task, H start, I end, J hours.
  sh.getRange('F7:F1000').setNumberFormat(CFG.formats.date);
  sh.getRange('H7:I1000').setNumberFormat(CFG.formats.time);
  sh.getRange('J7:J1000').setNumberFormat(CFG.formats.hours);

  // --- Hours by month: visible table + chart (left strip) ---
  // Helper spill in hidden columns N..P (year | month# | hours, no headers);
  // the visible table renders it as real month dates so the chart reads clean.
  sh.getRange('N6').setValue('Chart data — do not edit').setFontColor(CFG.colors.gray).setFontSize(8);
  sh.getRange('N7').setFormula(
    '=IFERROR(QUERY(' + imp + ", \"select year(Col1), month(Col1)+1, sum(Col6) " +
      'where Col2 = ""' + q + '"" group by year(Col1), month(Col1) ' +
      "order by year(Col1), month(Col1) " +
      "label year(Col1) '', month(Col1)+1 '', sum(Col6) ''\", 0), \"\")"
  );
  sectionHeader_(sh.getRange('B8'), 'HOURS BY MONTH');
  sh.getRange('B9').setValue('Month').setFontWeight('bold').setFontColor(CFG.colors.gray).setFontSize(9);
  sh.getRange('C9').setValue('Hours').setFontWeight('bold').setFontColor(CFG.colors.gray).setFontSize(9);
  sh.getRange('B10').setFormula('=ARRAYFORMULA(IF($N$7:$N$30="",, DATE($N$7:$N$30, $O$7:$O$30, 1)))')
    .setNumberFormat(CFG.formats.monthShort);
  sh.getRange('B10:B33').setNumberFormat(CFG.formats.monthShort);
  sh.getRange('C10').setFormula('=ARRAYFORMULA(IF($N$7:$N$30="",, $P$7:$P$30))');
  sh.getRange('C10:C33').setNumberFormat(CFG.formats.hours);
  card_(sh.getRange('B8:C34'));
  sh.hideColumns(14, 3); // N..P — working data, not part of the page

  sh.insertChart(
    sh.newChart()
      .setChartType(Charts.ChartType.COLUMN)
      .addRange(sh.getRange('B9:C33'))
      .setNumHeaders(1)
      .setOption('title', 'Hours by month')
      .setOption('legend', { position: 'none' })
      .setOption('colors', [CFG.colors.teal])
      .setOption('backgroundColor', 'white')
      .setOption('width', 420)
      .setOption('height', 230)
      .setPosition(36, 2, 0, 0)
      .build()
  );

  // Bare IMPORTRANGE anchor: the "Allow access" prompt only appears on an
  // unwrapped call — IFERROR-wrapped formulas would hide it forever.
  sh.getRange('H2').setFormula('=' + imp.replace(CFG.sheets.log + '!A2:F', CFG.sheets.log + '!A1'));
  sh.getRange('H2').setFontColor(CFG.colors.grayLine).setFontSize(8);
  sh.getRange('G2').setValue('if #REF appears → click it, then "Allow access"')
    .setFontColor(CFG.colors.grayLine).setFontSize(8).setHorizontalAlignment('right');
}
