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

function buildViewerContent_(viewer, trackerId, client) {
  viewer.setSpreadsheetLocale('en_GB');
  viewer.setSpreadsheetTimeZone('Europe/Malta');

  // Reset to a single known sheet.
  var tmp = viewer.insertSheet('__rebuild__');
  viewer.getSheets().forEach(function (sh) {
    if (sh.getSheetId() !== tmp.getSheetId()) viewer.deleteSheet(sh);
  });
  var sh = viewer.insertSheet('Hours', 0);
  viewer.deleteSheet(tmp);

  sh.setHiddenGridlines(true);
  sh.setColumnWidth(1, 24);
  // B..D month totals (Year|Month|Hours), E spacer, F..J sessions table.
  [70, 70, 80, 24, 110, 320, 70, 70, 80].forEach(function (w, i) {
    sh.setColumnWidth(i + 2, w);
  });

  sh.getRange('B2').setValue('LOGGED HOURS — ' + client.toUpperCase())
    .setFontSize(16).setFontWeight('bold').setFontColor(CFG.colors.navy);
  sh.getRange('B3')
    .setValue('Live read-only view · hours self-reported by ' + CFG.ownerName + ' · updates as work is logged')
    .setFontColor(CFG.colors.gray).setFontSize(9).setFontStyle('italic');

  // GViz string literals: use DOUBLE-quoted literals so apostrophe names
  // ("Paws 'n' Claws") survive; inside the sheet-formula string a literal
  // double quote is written as "". Strip any double quotes from the name.
  var q = client.replace(/"/g, '');
  var imp = 'IMPORTRANGE("' + trackerId + '", "' + CFG.sheets.log + '!A2:F")';

  sh.getRange('B5').setValue('MONTH TOTALS').setFontWeight('bold').setFontColor(CFG.colors.navy).setFontSize(10);
  // Fallback is '' — an empty log also lands here, so it must NOT claim an
  // access problem; the H2 anchor is the dedicated access indicator.
  sh.getRange('B6').setFormula(
    '=IFERROR(QUERY(' + imp + ", \"select year(Col1), month(Col1)+1, sum(Col6) " +
      'where Col2 = ""' + q + '"" group by year(Col1), month(Col1) ' +
      "order by year(Col1) desc, month(Col1) desc " +
      "label year(Col1) 'Year', month(Col1)+1 'Month', sum(Col6) 'Hours'\", 0), \"\")"
  );
  sh.getRange('D7:D30').setNumberFormat(CFG.formats.hours);

  sh.getRange('F5').setValue('SESSIONS').setFontWeight('bold').setFontColor(CFG.colors.navy).setFontSize(10);
  sh.getRange('F6').setFormula(
    '=IFERROR(QUERY(' + imp + ", \"select Col1, Col3, Col4, Col5, Col6 " +
      'where Col2 = ""' + q + '"" order by Col1 desc, Col4 desc ' +
      "label Col1 'Date', Col3 'Task', Col4 'Start', Col5 'End', Col6 'Hours'\", 0), \"\")"
  );
  // Sessions spill starts at F6 (header) → F7 down: F date, G task, H start, I end, J hours.
  sh.getRange('F7:F1000').setNumberFormat(CFG.formats.date);
  sh.getRange('H7:I1000').setNumberFormat(CFG.formats.time);
  sh.getRange('J7:J1000').setNumberFormat(CFG.formats.hours);

  // Bare IMPORTRANGE anchor: the "Allow access" prompt only appears on an
  // unwrapped call — IFERROR-wrapped formulas would hide it forever.
  sh.getRange('H2').setFormula('=' + imp.replace(CFG.sheets.log + '!A2:F', CFG.sheets.log + '!A1'));
  sh.getRange('H2').setFontColor(CFG.colors.grayLine).setFontSize(8);
  sh.getRange('G2').setValue('if #REF appears → click it, then "Allow access"')
    .setFontColor(CFG.colors.grayLine).setFontSize(8).setHorizontalAlignment('right');
}
