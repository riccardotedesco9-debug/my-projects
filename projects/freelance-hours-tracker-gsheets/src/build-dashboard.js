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
  for (var col = 3; col <= 14; col++) sh.setColumnWidth(col, 96);

  sh.getRange('A1:N80').setBackground(CFG.colors.paper).setFontFamily(CFG.fontFamily);
  sh.getRange('B2').setValue('SUMMARY').setFontSize(18).setFontWeight('bold').setFontColor(CFG.colors.navy);

  // Everything aggregates a virtual range: Col1 = month bucket (EOMONTH of the
  // session date), Col2 = client, Col3 = hours, Col4 = amount. Clients grow
  // right without caps; months are windowed to the trailing 13 so a spill can
  // never collide with the fixed section below it.
  var virtual =
    '{ARRAYFORMULA(EOMONTH(' + log + '!$A$2:$A,0)), ' + log + '!$B$2:$B, ' +
    log + '!$F$2:$F, ' + log + '!$H$2:$H}';
  var whereWin =
    "where Col2 is not null and Col1 >= date '\"&TEXT(EOMONTH(TODAY(),-13),\"yyyy-mm-dd\")&\"' ";
  var q = function (sel) {
    return '=IFERROR(QUERY(' + virtual + ", \"" + sel + "\", 0), 0)";
  };

  // ---- Headline totals (last 13 months) ----
  sectionHeader_(sh.getRange('B4'), 'TOTALS — LAST 13 MONTHS');
  sh.getRange('B5').setValue('Total hours').setFontColor(CFG.colors.gray);
  sh.getRange('C5').setFormula(q('select sum(Col3) ' + whereWin + "label sum(Col3) ''"))
    .setNumberFormat('0.00 "h"').setFontWeight('bold').setFontSize(13).setFontColor(CFG.colors.navy);
  sh.getRange('B6').setValue('Total earnings').setFontColor(CFG.colors.gray);
  sh.getRange('C6').setFormula(q('select sum(Col4) ' + whereWin + "label sum(Col4) ''"))
    .setNumberFormat(CFG.formats.euro).setFontWeight('bold').setFontSize(13).setFontColor(CFG.colors.navy);
  card_(sh.getRange('B4:C7'));

  // ---- Per-client totals (last 13 months) ----
  sectionHeader_(sh.getRange('E4'), 'BY CLIENT — LAST 13 MONTHS');
  sh.getRange('E5').setFormula(
    '=IFERROR(QUERY(' + virtual + ", \"select Col2, sum(Col3), sum(Col4) " + whereWin +
      "group by Col2 order by sum(Col4) desc " +
      "label Col2 'Client', sum(Col3) 'Hours', sum(Col4) 'Earnings'\", 0), \"—\")"
  );
  sh.getRange('E5:G5').setFontWeight('bold').setFontColor(CFG.colors.gray).setFontSize(9);
  sh.getRange('F6:F14').setNumberFormat(CFG.formats.hours);
  sh.getRange('G6:G14').setNumberFormat(CFG.formats.euro);
  card_(sh.getRange('E4:G14'));

  // ---- Month × client matrices ----
  sectionHeader_(sh.getRange('B16'), 'HOURS — MONTH × CLIENT');
  sh.getRange('B17').setFormula(
    '=IFERROR(QUERY(' + virtual + ", \"select Col1, sum(Col3) " + whereWin +
      "group by Col1 pivot Col2 label Col1 'Month'\", 0), \"—\")"
  );
  sh.getRange('B17:N17').setFontWeight('bold').setFontColor(CFG.colors.gray).setFontSize(9);
  sh.getRange('B18:B31').setNumberFormat(CFG.formats.monthShort);
  sh.getRange('C18:N31').setNumberFormat('0.00;;');
  card_(sh.getRange('B16:N32'));

  sectionHeader_(sh.getRange('B34'), 'EARNINGS — MONTH × CLIENT');
  sh.getRange('B35').setFormula(
    '=IFERROR(QUERY(' + virtual + ", \"select Col1, sum(Col4) " + whereWin +
      "group by Col1 pivot Col2 label Col1 'Month'\", 0), \"—\")"
  );
  sh.getRange('B35:N35').setFontWeight('bold').setFontColor(CFG.colors.gray).setFontSize(9);
  sh.getRange('B36:B49').setNumberFormat(CFG.formats.monthShort);
  sh.getRange('C36:N49').setNumberFormat(CFG.formats.euroBlankZero);
  card_(sh.getRange('B34:N50'));

  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .setGradientMinpoint(CFG.colors.white)
      .setGradientMaxpoint(CFG.colors.tealSoft)
      .setRanges([sh.getRange('C18:N31'), sh.getRange('C36:N49')])
      .build(),
  ]);

  // ---- Chart data: P Month | Q per-month € | R cumulative € ----
  // Tucked off to the right (columns P–R), out of the visible flow, so the
  // charts below/right float over clean space instead of over raw numbers.
  for (var dc = 16; dc <= 18; dc++) sh.setColumnWidth(dc, 96);
  sh.getRange('P1').setValue('Chart data — do not edit').setFontColor(CFG.colors.gray).setFontSize(8);
  sh.getRange('P2').setFormula(
    '=IFERROR(QUERY(' + virtual + ", \"select Col1, sum(Col4) " + whereWin +
      "group by Col1 label Col1 'Month', sum(Col4) 'Earnings (€)'\", 0), \"—\")"
  );
  sh.getRange('R2').setValue('Cumulative (€)');
  // Running total of the per-month earnings (blanks = 0) so the line climbs
  // from the first month to the grand total — the "how am I doing" trajectory.
  sh.getRange('R3').setFormula('=IFERROR(SCAN(0, Q3:Q26, LAMBDA(a, v, a + N(v))), "")');
  sh.getRange('P3:P26').setNumberFormat(CFG.formats.monthShort);
  sh.getRange('Q3:R26').setNumberFormat(CFG.formats.euroBlankZero);

  // Cumulative earnings line (with point markers) — the headline visual, in the
  // open space top-right beside the totals cards.
  sh.insertChart(
    sh
      .newChart()
      .setChartType(Charts.ChartType.LINE)
      .addRange(sh.getRange('P2:P26')) // months
      .addRange(sh.getRange('R2:R26')) // cumulative €
      .setNumHeaders(1)
      .setOption('title', 'Cumulative earnings (€)')
      .setOption('legend', { position: 'none' })
      .setOption('pointSize', 5)
      .setOption('colors', [CFG.colors.teal])
      .setOption('backgroundColor', CFG.colors.white)
      .setOption('width', 500)
      .setOption('height', 250)
      .setPosition(3, 9, 0, 0)
      .build()
  );

  // Earnings-by-month bars, below the matrices (now over clean space).
  sh.insertChart(
    sh
      .newChart()
      .setChartType(Charts.ChartType.COLUMN)
      .addRange(sh.getRange('P2:Q26'))
      .setNumHeaders(1)
      .setOption('title', 'Earnings by month (€)')
      .setOption('legend', { position: 'none' })
      .setOption('colors', [CFG.colors.navy])
      .setOption('backgroundColor', CFG.colors.white)
      .setOption('width', 520)
      .setOption('height', 260)
      .setPosition(52, 2, 0, 0)
      .build()
  );
}
