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
  sh.setColumnWidth(2, 120);
  for (var col = 3; col <= 19; col++) sh.setColumnWidth(col, 96); // C–S: KPIs + full-width matrices (room to grow clients)

  sh.getRange('A1:S80').setBackground(CFG.colors.paper).setFontFamily(CFG.fontFamily);
  sh.getRange('B2').setValue('SUMMARY').setFontSize(18).setFontWeight('bold').setFontColor(CFG.colors.navy);

  // Everything aggregates a virtual range: Col1 = month bucket (EOMONTH of the
  // session date), Col2 = client, Col3 = hours, Col4 = amount. Clients grow
  // right without caps; months are windowed so a spill can never collide with
  // the fixed section below it.
  var virtual =
    '{ARRAYFORMULA(EOMONTH(' + log + '!$A$2:$A,0)), ' + log + '!$B$2:$B, ' +
    log + '!$F$2:$F, ' + log + '!$H$2:$H}';

  // Window selector (prominent, right of the title): a months dropdown in F2
  // drives the KPIs, the by-client card and BOTH charts — change it and every
  // live QUERY re-windows itself (no trigger; the formulas reference $F$2). The
  // two month×client matrices stay on a fixed 13-month grid (their width is
  // bounded by the layout, so they can't safely grow to 24). A layout update
  // recreates this sheet, so the pick resets to the 12-month default.
  sh.getRange('E2').setValue('Show last').setFontColor(CFG.colors.gray).setFontSize(10)
    .setHorizontalAlignment('right').setVerticalAlignment('middle');
  var ctrl = sh.getRange('F2');
  ctrl.setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList([3, 6, 12, 24], true).setAllowInvalid(false).build()
  );
  if ([3, 6, 12, 24].indexOf(Number(ctrl.getValue())) < 0) ctrl.setValue(12);
  // Let the native dropdown "chip" render on its own — a manual border/fill
  // fights the chip styling (looks boxed-in / offset and muddles the click
  // target). Plain number format only (a "0 months" text format makes the
  // list-validation read the cell as invalid); the unit label lives in G2.
  ctrl.setNumberFormat('0').setFontWeight('bold').setFontColor(CFG.colors.navy)
    .setFontSize(11).setVerticalAlignment('middle');
  sh.getRange('G2').setValue('months').setFontColor(CFG.colors.gray).setFontSize(10).setVerticalAlignment('middle');

  // Client filter: the checkbox list (built in the by-client band below) writes
  // a regex of the UN-ticked clients into X1; every windowed QUERY excludes them
  // (not-matches). All ticked (the default) → "__none__" → nothing excluded →
  // all clients. Excluding (rather than including) means clients beyond the
  // visible rows still show by default and are never silently dropped.
  sh.getRange('X1').setFormula(
    '=LET(unsel, TEXTJOIN("|", TRUE, ARRAYFORMULA(IF($F$22:$F$32=FALSE, $G$22:$G$32, ""))), IF(unsel="", "__none__", unsel))'
  );
  sh.getRange('X1').setFontColor(CFG.colors.gray).setFontSize(8);
  var clientFilter = "not (Col2 matches '\"&$X$1&\"') and ";
  var whereWin =
    "where Col2 is not null and " + clientFilter + "Col1 >= date '\"&TEXT(EOMONTH(TODAY(),-$F$2),\"yyyy-mm-dd\")&\"' ";
  var whereWin13 =
    "where Col2 is not null and " + clientFilter + "Col1 >= date '\"&TEXT(EOMONTH(TODAY(),-13),\"yyyy-mm-dd\")&\"' ";
  var q = function (sel) {
    return '=IFERROR(QUERY(' + virtual + ", \"" + sel + "\", 0), 0)";
  };

  // ---- KPI strip (windowed by F2): two big numbers side by side. The value
  // cells are MERGED because numbers (unlike text) don't overflow into the next
  // cell — a wide total like €5,058.50 clips to one column otherwise. ----
  sh.getRange('B4').setValue('TOTAL HOURS').setFontColor(CFG.colors.gray).setFontSize(9).setFontWeight('bold');
  sh.getRange('B5:C5').merge();
  sh.getRange('B5').setFormula(q('select sum(Col3) ' + whereWin + "label sum(Col3) ''"))
    .setNumberFormat('0.00 "h"').setFontWeight('bold').setFontSize(18).setFontColor(CFG.colors.navy)
    .setHorizontalAlignment('left');
  sh.getRange('E4').setValue('TOTAL EARNINGS').setFontColor(CFG.colors.gray).setFontSize(9).setFontWeight('bold');
  sh.getRange('E5:F5').merge();
  sh.getRange('E5').setFormula(q('select sum(Col4) ' + whereWin + "label sum(Col4) ''"))
    .setNumberFormat(CFG.formats.euro).setFontWeight('bold').setFontSize(18).setFontColor(CFG.colors.navy)
    .setHorizontalAlignment('left');
  card_(sh.getRange('B4:C6'));
  card_(sh.getRange('E4:F6'));

  // ---- Chart data: T Month | U per-month € | V cumulative €. Parked far right
  // (T–V) so the side-by-side matrices below can spill their client columns
  // without ever colliding with it. ----
  for (var dc = 20; dc <= 22; dc++) sh.setColumnWidth(dc, 96);
  sh.getRange('T1').setValue('Chart data — do not edit').setFontColor(CFG.colors.gray).setFontSize(8);
  sh.getRange('T2').setFormula(
    '=IFERROR(QUERY(' + virtual + ", \"select Col1, sum(Col4) " + whereWin +
      "group by Col1 label Col1 'Month', sum(Col4) 'Earnings (€)'\", 0), \"—\")"
  );
  sh.getRange('V2').setValue('Cumulative (€)');
  // Running total of the per-month earnings (blanks = 0) so the line climbs from
  // the first month to the grand total — the "how am I doing" trajectory.
  sh.getRange('V3').setFormula('=IFERROR(SCAN(0, U3:U26, LAMBDA(a, v, a + N(v))), "")');
  sh.getRange('T3:T26').setNumberFormat(CFG.formats.monthShort);
  sh.getRange('U3:V26').setNumberFormat(CFG.formats.euroBlankZero);

  // ---- Charts, side by side: cumulative line (left) + by-month bars (right) ----
  sh.insertChart(
    sh.newChart().setChartType(Charts.ChartType.LINE)
      .addRange(sh.getRange('T2:T26')) // months
      .addRange(sh.getRange('V2:V26')) // cumulative €
      .setNumHeaders(1)
      .setOption('title', 'Cumulative earnings (€)')
      .setOption('legend', { position: 'none' })
      .setOption('pointSize', 5)
      .setOption('colors', [CFG.colors.teal])
      .setOption('backgroundColor', CFG.colors.white)
      .setOption('width', 560).setOption('height', 240)
      .setPosition(8, 2, 0, 0).build()
  );
  sh.insertChart(
    sh.newChart().setChartType(Charts.ChartType.COLUMN)
      .addRange(sh.getRange('T2:U26'))
      .setNumHeaders(1)
      .setOption('title', 'Earnings by month (€)')
      .setOption('legend', { position: 'none' })
      .setOption('colors', [CFG.colors.navy])
      .setOption('backgroundColor', CFG.colors.white)
      .setOption('width', 560).setOption('height', 240)
      .setPosition(8, 8, 0, 0).build()
  );

  // ---- Bottom band: by-client, then the two month×client matrices, STACKED
  // full-width so they scale with the client count. Each pivot spills rightward
  // from column B; the chart data is parked far out at T–V, leaving the matrices
  // room to grow to ~17 client columns before anything can collide. ----
  sectionHeader_(sh.getRange('B21'), 'BY CLIENT');
  sh.getRange('B22').setFormula(
    '=IFERROR(QUERY(' + virtual + ", \"select Col2, sum(Col3), sum(Col4) " + whereWin +
      "group by Col2 order by sum(Col4) desc " +
      "label Col2 'Client', sum(Col3) 'Hours', sum(Col4) 'Earnings'\", 0), \"—\")"
  );
  sh.getRange('B22:D22').setFontWeight('bold').setFontColor(CFG.colors.gray).setFontSize(9);
  sh.getRange('C23:C31').setNumberFormat(CFG.formats.hours);
  sh.getRange('D23:D31').setNumberFormat(CFG.formats.euro);
  card_(sh.getRange('B21:D32'));

  // Client filter checklist beside the by-client summary — UNTICK a client to
  // drop it from the ENTIRE summary (KPIs, charts, matrices, this table). Names
  // come from the Clients sheet (fixed order); ticks feed the X1 regex above.
  // Pre-ticked, so any client you add is shown by default.
  sectionHeader_(sh.getRange('F21'), 'SHOW CLIENTS');
  sh.getRange('G22').setFormula("=ARRAYFORMULA('" + CFG.sheets.clients + "'!A2:A12)");
  var boxes = sh.getRange('F22:F32');
  boxes.insertCheckboxes();
  boxes.setValue(true);
  card_(sh.getRange('F21:G32'));

  sectionHeader_(sh.getRange('B34'), 'HOURS — MONTH × CLIENT (last 13)');
  sh.getRange('B35').setFormula(
    '=IFERROR(QUERY(' + virtual + ", \"select Col1, sum(Col3) " + whereWin13 +
      "group by Col1 pivot Col2 label Col1 'Month'\", 0), \"—\")"
  );
  sh.getRange('B35:S35').setFontWeight('bold').setFontColor(CFG.colors.gray).setFontSize(9);
  sh.getRange('B36:B49').setNumberFormat(CFG.formats.monthShort);
  sh.getRange('C36:S49').setNumberFormat('0.00;;');
  card_(sh.getRange('B34:N50'));

  sectionHeader_(sh.getRange('B52'), 'EARNINGS — MONTH × CLIENT (last 13)');
  sh.getRange('B53').setFormula(
    '=IFERROR(QUERY(' + virtual + ", \"select Col1, sum(Col4) " + whereWin13 +
      "group by Col1 pivot Col2 label Col1 'Month'\", 0), \"—\")"
  );
  sh.getRange('B53:S53').setFontWeight('bold').setFontColor(CFG.colors.gray).setFontSize(9);
  sh.getRange('B54:B67').setNumberFormat(CFG.formats.monthShort);
  sh.getRange('C54:S67').setNumberFormat(CFG.formats.euroBlankZero);
  card_(sh.getRange('B52:N68'));

  // Green (white→teal) scale on EVERY numeric block, each as its own rule so it
  // scales relative to its own values — one shared rule would wash the small
  // hours numbers out against the large € figures. By-client Hours + Earnings,
  // the hours matrix, and the earnings matrix each get their own.
  var greenScale = function (a1) {
    return SpreadsheetApp.newConditionalFormatRule()
      .setGradientMinpoint(CFG.colors.white)
      .setGradientMaxpoint(CFG.colors.tealSoft)
      .setRanges([sh.getRange(a1)])
      .build();
  };
  sh.setConditionalFormatRules([
    greenScale('C23:C31'), // by-client hours
    greenScale('D23:D31'), // by-client earnings
    greenScale('C36:S49'), // hours matrix
    greenScale('C54:S67'), // earnings matrix
  ]);
}
