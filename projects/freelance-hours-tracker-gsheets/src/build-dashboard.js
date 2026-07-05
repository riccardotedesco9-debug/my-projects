// build-dashboard.js — Dashboard + Summary builders. Only rebuild_() calls
// these. Everything is dynamic (no hardcoded client counts), and both sheets
// share the paper-canvas + white-card look. The sidebar is the control
// surface; the Dashboard shows state (banner) and holds the phone checkboxes.

function buildDashboardSheet_(ss) {
  var sh = ss.getSheetByName(CFG.sheets.dashboard);
  var log = "'" + CFG.sheets.log + "'";
  sh.setHiddenGridlines(true);

  var widths = { 1: 24, 2: 120, 3: 140, 4: 140, 5: 170, 6: 110, 7: 110, 8: 24 };
  Object.keys(widths).forEach(function (col) {
    sh.setColumnWidth(Number(col), widths[col]);
  });

  // Canvas + house font (font silently falls back if unavailable).
  sh.getRange('A1:H42').setBackground(CFG.colors.paper).setFontFamily(CFG.fontFamily);

  sh.getRange('B2:G2').merge();
  sh.getRange('B2')
    .setValue('FREELANCE HOURS TRACKER')
    .setFontSize(18)
    .setFontWeight('bold')
    .setFontColor(CFG.colors.navy);
  sh.getRange('B3:G3').merge();
  sh.getRange('B3').setValue(CFG.ownerName).setFontColor(CFG.colors.gray);

  // Status banner — the on-sheet feedback for every timer transition.
  sh.getRange('B5:G5').merge();
  sh.setRowHeight(5, 38);
  sh.getRange('B5')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setFontWeight('bold')
    .setFontSize(12);
  ss.setNamedRange(CFG.named.dbStatus, sh.getRange('B5'));

  // Inputs: what the user PICKS (separate from what is being timed).
  sh.getRange('B7').setValue('Client').setFontWeight('bold');
  sh.getRange('C7:D7').merge();
  styleInputCell_(sh.getRange('C7:D7'));
  sh.getRange('C7').setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInRange(ss.getRange("'" + CFG.sheets.clients + "'!A2:A"), true)
      .setAllowInvalid(false)
      .build()
  );
  ss.setNamedRange(CFG.named.dbClient, sh.getRange('C7'));

  sh.getRange('B8').setValue('Task').setFontWeight('bold');
  sh.getRange('C8:G8').merge();
  styleInputCell_(sh.getRange('C8:G8'));
  ss.setNamedRange(CFG.named.dbTask, sh.getRange('C8'));

  // The one on-sheet control: opens the timer panel (all real interaction —
  // and its visual feedback — lives in the sidebar).
  sh.setRowHeight(10, 52);
  insertDashboardButtons_(sh);

  // Phone controls — the Sheets mobile app runs no buttons/menus/sidebars, so
  // these two checkboxes are the phone's Start/Stop. Rendered as colored button
  // bars: the checkbox is the tap target the app can fire; the bar makes it
  // read as a button on desktop.
  sectionHeader_(sh.getRange('B12'), 'PHONE CONTROLS');
  sh.setRowHeight(13, 30);
  sh.setRowHeight(14, 30);
  phoneButton_(sh, ss, 13, CFG.named.chkStart, CFG.colors.green, '▶  START');
  phoneButton_(sh, ss, 14, CFG.named.chkStop, CFG.colors.red, '■  STOP & LOG');
  sh.getRange('B15:E15').merge();
  sh.getRange('B15')
    .setValue('Tap a box from the Google Sheets phone app — uses the Client & Task above.')
    .setFontColor(CFG.colors.gray)
    .setFontStyle('italic')
    .setFontSize(8);

  // At-a-glance card — live formulas, zero staleness, no triggers.
  sectionHeader_(sh.getRange('B17'), 'AT A GLANCE');
  sh.getRange(18, 2, 4, 1).setValues([['Today'], ['This week'], ['This month'], ['Earned this month']]);
  sh.getRange('C18')
    .setFormula('=ROUND(SUMIF(' + log + '!$A:$A, TODAY(), ' + log + '!$F:$F), 2)');
  sh.getRange('C19').setFormula(
    '=ROUND(SUMIFS(' + log + '!$F:$F, ' + log + '!$A:$A, ">="&TODAY()-WEEKDAY(TODAY(),2)+1, ' +
      log + '!$A:$A, "<="&TODAY()), 2)'
  );
  sh.getRange('C20').setFormula(
    '=ROUND(SUMIFS(' + log + '!$F:$F, ' + log + '!$A:$A, ">="&EOMONTH(TODAY(),-1)+1, ' +
      log + '!$A:$A, "<="&EOMONTH(TODAY(),0)), 2)'
  );
  sh.getRange('C21').setFormula(
    '=ROUND(SUMIFS(' + log + '!$H:$H, ' + log + '!$A:$A, ">="&EOMONTH(TODAY(),-1)+1, ' +
      log + '!$A:$A, "<="&EOMONTH(TODAY(),0)), 2)'
  );
  sh.getRange('C18:C20').setNumberFormat('0.00 "h"');
  sh.getRange('C21').setNumberFormat(CFG.formats.euro);
  ss.setNamedRange(CFG.named.dbToday, sh.getRange('C18'));
  ss.setNamedRange(CFG.named.dbMonth, sh.getRange('C20'));
  card_(sh.getRange('B17:C22'));

  // This month by client — dynamic spill, sorted by hours.
  sectionHeader_(sh.getRange('E17'), 'THIS MONTH BY CLIENT');
  sh.getRange('E18').setFormula(
    '=IFERROR(QUERY(' + log + "!$A$2:$H, \"select B, sum(F), sum(H) " +
      "where B is not null and A >= date '\"&TEXT(EOMONTH(TODAY(),-1)+1,\"yyyy-mm-dd\")&\"' " +
      "and A <= date '\"&TEXT(EOMONTH(TODAY(),0),\"yyyy-mm-dd\")&\"' " +
      "group by B order by sum(F) desc label B 'Client', sum(F) 'Hours', sum(H) '€'\", 0), \"—\")"
  );
  sh.getRange('E18:G18').setFontColor(CFG.colors.gray).setFontSize(9);
  sh.getRange('F19:F28').setNumberFormat(CFG.formats.hours);
  sh.getRange('G19:G28').setNumberFormat(CFG.formats.euroBlankZero);
  card_(sh.getRange('E17:G28'));
}

/**
 * One phone-control row as a colored button bar: a checkbox toggle in column B
 * (the only element the Sheets mobile app can fire) beside a full-width colored
 * label face across C:E, the whole bar wrapped in a matching border.
 */
function phoneButton_(sh, ss, row, namedRange, color, label) {
  var box = sh.getRange(row, 2);
  box.insertCheckboxes();
  box.setBackground(CFG.colors.white).setHorizontalAlignment('center').setVerticalAlignment('middle');
  ss.setNamedRange(namedRange, box);

  sh.getRange(row, 3, 1, 3).merge();
  sh.getRange(row, 3)
    .setValue(label)
    .setBackground(color)
    .setFontColor(CFG.colors.white)
    .setFontWeight('bold')
    .setFontSize(12)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');

  sh.getRange(row, 2, 1, 4).setBorder(
    true, true, true, true, false, false, color, SpreadsheetApp.BorderStyle.SOLID_MEDIUM
  );
}

/** Small gray section label — quiet hierarchy, not shouty headers. */
function sectionHeader_(range, text) {
  range.setValue(text).setFontWeight('bold').setFontColor(CFG.colors.gray).setFontSize(9);
}

/** White card on the paper canvas. Applied AFTER content so fills win. */
function card_(range) {
  range
    .setBackground(CFG.colors.white)
    .setBorder(true, true, true, true, false, false, CFG.colors.grayLine, SpreadsheetApp.BorderStyle.SOLID);
}

function styleInputCell_(range) {
  range
    .setBackground(CFG.colors.white)
    .setBorder(true, true, true, true, false, false, CFG.colors.grayLine, SpreadsheetApp.BorderStyle.SOLID);
}

function buildSummarySheet_(ss) {
  var sh = ss.getSheetByName(CFG.sheets.summary);
  var log = "'" + CFG.sheets.log + "'";
  sh.setHiddenGridlines(true);
  sh.setColumnWidth(1, 24);
  sh.setColumnWidth(2, 110);
  for (var col = 3; col <= 14; col++) sh.setColumnWidth(col, 92);

  sh.getRange('A1:N75').setBackground(CFG.colors.paper).setFontFamily(CFG.fontFamily);
  sh.getRange('B2').setValue('SUMMARY').setFontSize(18).setFontWeight('bold').setFontColor(CFG.colors.navy);

  // Month × client matrices as QUERY pivots over a virtual range:
  // Col1 = month bucket (EOMONTH of the session date), Col2 = client,
  // Col3 = hours, Col4 = amount. Clients grow right without caps; months are
  // windowed to the trailing 13 so the spill can never collide with the
  // fixed-position section below it (a collision #REFs and IFERROR would
  // silently mask the whole matrix as '—').
  var virtual =
    '{ARRAYFORMULA(EOMONTH(' + log + '!$A$2:$A,0)), ' + log + '!$B$2:$B, ' +
    log + '!$F$2:$F, ' + log + '!$H$2:$H}';
  var window13 = "and Col1 >= date '\"&TEXT(EOMONTH(TODAY(),-13),\"yyyy-mm-dd\")&\"' ";

  sectionHeader_(sh.getRange('B4'), 'HOURS — MONTH × CLIENT (LAST 13 MONTHS)');
  sh.getRange('B5').setFormula(
    '=IFERROR(QUERY(' + virtual + ", \"select Col1, sum(Col3) where Col2 is not null " + window13 +
      "group by Col1 pivot Col2 label Col1 'Month'\", 0), \"—\")"
  );
  sh.getRange('B5:N5').setFontWeight('bold').setFontColor(CFG.colors.gray).setFontSize(9);
  sh.getRange('B6:B22').setNumberFormat(CFG.formats.monthShort);
  sh.getRange('C6:N22').setNumberFormat('0.00;;');
  card_(sh.getRange('B4:N22'));

  sectionHeader_(sh.getRange('B24'), 'EARNINGS — MONTH × CLIENT (LAST 13 MONTHS)');
  sh.getRange('B25').setFormula(
    '=IFERROR(QUERY(' + virtual + ", \"select Col1, sum(Col4) where Col2 is not null " + window13 +
      "group by Col1 pivot Col2 label Col1 'Month'\", 0), \"—\")"
  );
  sh.getRange('B25:N25').setFontWeight('bold').setFontColor(CFG.colors.gray).setFontSize(9);
  sh.getRange('B26:B42').setNumberFormat(CFG.formats.monthShort);
  sh.getRange('C26:N42').setNumberFormat(CFG.formats.euroBlankZero);
  card_(sh.getRange('B24:N42'));

  // Heat shading (white → soft teal) over both matrices.
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .setGradientMinpoint(CFG.colors.white)
      .setGradientMaxpoint(CFG.colors.tealSoft)
      .setRanges([sh.getRange('C6:N22'), sh.getRange('C26:N42')])
      .build(),
  ]);

  // Chart series: earnings total per month (kept out of the matrices so the
  // chart range stays fixed).
  sh.getRange('B45').setValue('Chart data').setFontColor(CFG.colors.gray).setFontSize(9);
  sh.getRange('B46').setFormula(
    '=IFERROR(QUERY(' + virtual + ", \"select Col1, sum(Col4) where Col2 is not null " + window13 +
      "group by Col1 label Col1 'Month', sum(Col4) 'Earnings (€)'\", 0), \"—\")"
  );
  sh.getRange('B47:B70').setNumberFormat(CFG.formats.monthShort);
  sh.getRange('C47:C70').setNumberFormat(CFG.formats.euroBlankZero);

  var chart = sh
    .newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(sh.getRange('B46:C70'))
    .setNumHeaders(1)
    .setOption('title', 'Earnings by month (€)')
    .setOption('legend', { position: 'none' })
    .setOption('colors', [CFG.colors.teal])
    .setOption('backgroundColor', CFG.colors.white)
    .setPosition(45, 5, 0, 0)
    .build();
  sh.insertChart(chart);
}
