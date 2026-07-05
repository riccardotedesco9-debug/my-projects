// report.js — regenerates the Report sheet for one client (or All Clients)
// and one month. The sheet is a disposable rendering surface: values only,
// rebuilt from the Time Log on every call, never treated as stored data.

/**
 * Rebuilds the report and returns its geometry + totals:
 * {rowCount, totalHours, totalAmount, lastRow, lastCol}.
 * Layout (columns): B Date | C Client | D Task | E Start | F End | G Hours
 * [| H Rate | I Amount]. Body starts at row 3 (rows 1-2 are screen chrome).
 */
function buildReportCtx_(ctx, clientOrAll, year, month, includeMoney, opts) {
  opts = opts || {};
  var sh = ctx.ss.getSheetByName(CFG.sheets.report);
  var tz = ctx.ss.getSpreadsheetTimeZone();
  var monthStart = new Date(year, month - 1, 1);
  var nextMonthStart = new Date(year, month, 1);
  var lastCol = includeMoney ? 9 : 7;
  var rows = collectReportRows_(ctx, clientOrAll, monthStart, nextMonthStart);

  var body = sh.getRange(3, 1, Math.max(sh.getMaxRows() - 2, 1), 9);
  body.clear();
  // clear() does NOT unmerge: without this, toggling includeMoney between
  // exports throws when the new 'Generated:' merge overlaps the stale one.
  body.breakApart();
  // The pie chart is regenerated per export too.
  sh.getCharts().forEach(function (ch) {
    sh.removeChart(ch);
  });

  sh.getRange('B3').setValue('TIMESHEET').setFontSize(22).setFontWeight('bold').setFontColor(CFG.colors.navy);

  sh.getRange('B5').setValue('Freelancer').setFontWeight('bold');
  sh.getRange('C5').setValue(CFG.ownerName);
  sh.getRange('B6').setValue('Period').setFontWeight('bold');
  // Real date + explicit format — a "July 2026" STRING would coerce badly.
  sh.getRange('C6').setValue(monthStart).setNumberFormat(CFG.formats.month);
  sh.getRange('B7').setValue('Client').setFontWeight('bold');
  sh.getRange('C7').setValue(clientOrAll);
  sh.getRange('B8').setValue('ID No.').setFontWeight('bold');
  sh.getRange('C8').setValue(CFG.ownerId).setFontColor(CFG.colors.gray);
  sh.getRange(5, lastCol - 2, 1, 3).merge();
  sh.getRange(5, lastCol - 2)
    .setValue('Generated: ' + Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy HH:mm'))
    .setFontStyle('italic')
    .setFontColor(CFG.colors.gray)
    .setFontSize(9)
    .setHorizontalAlignment('right');

  var headers = ['Date', 'Client', 'Task', 'Start', 'End', 'Hours'];
  if (includeMoney) headers = headers.concat(['Rate', 'Amount']);
  sh.getRange(9, 2, 1, headers.length)
    .setValues([headers])
    .setBackground(CFG.colors.navy)
    .setFontColor(CFG.colors.white)
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  var totalHours = 0;
  var totalAmount = 0;
  var bodyTop = 10;
  var lastRow;

  if (rows.length === 0) {
    sh.getRange(bodyTop, 2)
      .setValue(MSG.noSessions)
      .setFontStyle('italic')
      .setFontColor(CFG.colors.gray);
    lastRow = bodyTop;
  } else {
    var out = rows.map(function (r) {
      totalHours += r.hours;
      totalAmount += r.amount;
      var line = [r.date, r.client, r.task, r.start, r.end, r.hours];
      if (includeMoney) line = line.concat([r.rate, r.amount]);
      return line;
    });
    sh.getRange(bodyTop, 2, out.length, headers.length).setValues(out);
    sh.getRange(bodyTop, 2, out.length, 1).setNumberFormat(CFG.formats.date);
    sh.getRange(bodyTop, 5, out.length, 2).setNumberFormat(CFG.formats.time);
    sh.getRange(bodyTop, 7, out.length, 1).setNumberFormat(CFG.formats.hours);
    if (includeMoney) sh.getRange(bodyTop, 8, out.length, 2).setNumberFormat(CFG.formats.euro);
    lastRow = bodyTop + out.length - 1;
  }

  // TOTAL row, bold with a top border across the table width.
  var totalRow = lastRow + 1;
  sh.getRange(totalRow, 2, 1, headers.length).setBorder(
    true, null, null, null, false, false, CFG.colors.navy, SpreadsheetApp.BorderStyle.SOLID_MEDIUM
  );
  sh.getRange(totalRow, 4).setValue('TOTAL').setFontWeight('bold').setHorizontalAlignment('right');
  sh.getRange(totalRow, 7).setValue(Math.round(totalHours * 100) / 100)
    .setNumberFormat(CFG.formats.hours)
    .setFontWeight('bold');
  if (includeMoney) {
    sh.getRange(totalRow, 9).setValue(Math.round(totalAmount * 100) / 100)
      .setNumberFormat(CFG.formats.euro)
      .setFontWeight('bold');
  }

  var certRow = totalRow + 3;
  sh.getRange(certRow, 2)
    .setValue(MSG.certification)
    .setFontStyle('italic')
    .setFontColor(CFG.colors.gray);
  // Automatic electronic signature — appears on every export, no signing
  // ceremony. The name (signature face) + certified statement + timestamp +
  // ID, plus a SHA-256 integrity seal over the timesheet's facts that makes a
  // silently-edited PDF detectable. Genuinely more verifiable than a plain
  // typed name, and (unlike DocuSign) requires zero manual action.
  var signRow = certRow + 2;
  sh.getRange(signRow, 2)
    .setValue(CFG.ownerName)
    .setFontFamily('Caveat')
    .setFontSize(22)
    .setFontColor(CFG.colors.navy);
  var signedTs = Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy HH:mm');
  sh.getRange(signRow + 1, 2)
    .setValue('Electronically signed & self-certified · ' + signedTs + ' · Malta ID ' + CFG.ownerId)
    .setFontColor(CFG.colors.gray)
    .setFontSize(9);
  var seal = documentSeal_(ctx, clientOrAll, year, month, rows, totalHours, totalAmount, signedTs);
  sh.getRange(signRow + 2, 2)
    .setValue('Document verification: ' + seal)
    .setFontColor(CFG.colors.gray)
    .setFontSize(8)
    .setFontFamily('Roboto Mono');

  var breakdown = [];
  var finalRow = signRow + 2;
  if (rows.length > 0) {
    var yyyymm = year + '-' + (month < 10 ? '0' : '') + month;
    breakdown = consolidateTasks_(ctx, clientOrAll, yyyymm, rows, { forceFallback: !!opts.forceFallback });
    finalRow = renderBreakdown_(sh, signRow + 4, breakdown, totalHours);
  }

  return {
    rowCount: rows.length,
    totalHours: Math.round(totalHours * 100) / 100,
    totalAmount: Math.round(totalAmount * 100) / 100,
    breakdown: breakdown,
    lastRow: finalRow,
    lastCol: lastCol,
  };
}

/**
 * WORK BREAKDOWN: consolidated "type of work" table + pie chart, so the
 * client sees where the hours went, not just a session list. Labels sit in
 * column B and overflow visually across the empty C/D; the chart reads the
 * two non-adjacent columns (B labels + E values) as separate ranges.
 * Returns the last row the section (incl. chart zone) occupies.
 */
function renderBreakdown_(sh, top, groups, totalHours) {
  sh.getRange(top, 2).setValue('WORK BREAKDOWN').setFontWeight('bold').setFontColor(CFG.colors.navy);

  var head = top + 1;
  sh.getRange(head, 2, 1, 5)
    .setBackground(CFG.colors.navy)
    .setFontColor(CFG.colors.white)
    .setFontWeight('bold');
  sh.getRange(head, 2).setValue('Type of work');
  sh.getRange(head, 5).setValue('Hours').setHorizontalAlignment('center');
  sh.getRange(head, 6).setValue('Share').setHorizontalAlignment('center');

  for (var i = 0; i < groups.length; i++) {
    var r = head + 1 + i;
    sh.getRange(r, 2).setValue(groups[i].label);
    sh.getRange(r, 5).setValue(groups[i].hours).setNumberFormat(CFG.formats.hours).setHorizontalAlignment('center');
    sh.getRange(r, 6)
      .setValue(totalHours > 0 ? groups[i].hours / totalHours : 0)
      .setNumberFormat('0%')
      .setHorizontalAlignment('center');
  }

  if (groups.length > 1) {
    var chart = sh
      .newChart()
      .setChartType(Charts.ChartType.PIE)
      .addRange(sh.getRange(head + 1, 2, groups.length, 1)) // labels (B)
      .addRange(sh.getRange(head + 1, 5, groups.length, 1)) // hours (E)
      .setOption('legend', { position: 'right', textStyle: { fontSize: 10 } })
      .setOption('colors', [
        CFG.colors.teal,
        CFG.colors.navy,
        CFG.colors.gold,
        CFG.colors.tealSoft,
        CFG.colors.green,
        CFG.colors.gray,
      ])
      .setOption('pieSliceBorderColor', 'white')
      .setOption('backgroundColor', 'white')
      .setOption('width', 330)
      .setOption('height', 210)
      .setPosition(head + 1, 7, 0, 6)
      .build();
    sh.insertChart(chart);
  }

  // Reserve vertical room for whichever is taller: table or chart (~11 rows).
  return Math.max(head + groups.length, head + 11) + 1;
}

/**
 * Keyed verification code over the timesheet's FULL content — every line item
 * (date, task, times, hours, amount) plus name, ID, totals and signing time —
 * HMAC-SHA256'd with a per-project secret. Editing any figure in the exported
 * PDF makes it re-derive to a different code, and without the secret it can't
 * be forged. Automatic and free: the honest version of an e-signature seal
 * (this is why DocuSign was unnecessary). The owner can re-derive it from the
 * tracker to prove a PDF is authentic and unaltered.
 */
function documentSeal_(ctx, clientOrAll, year, month, rows, totalHours, totalAmount, signedTs) {
  var tz = ctx.ss.getSpreadsheetTimeZone();
  var lines = rows
    .map(function (r) {
      return [
        Utilities.formatDate(r.start, tz, 'yyyy-MM-dd HH:mm'),
        Utilities.formatDate(r.end, tz, 'yyyy-MM-dd HH:mm'),
        r.task, r.hours, r.amount,
      ].join('~');
    })
    .join('|');
  var source = [
    clientOrAll, year + '-' + month, rows.length,
    Math.round(totalHours * 100) / 100, Math.round(totalAmount * 100) / 100,
    CFG.ownerName, CFG.ownerId, signedTs, lines,
  ].join('||');
  var bytes = Utilities.computeHmacSha256Signature(source, getOrCreateSigningSecret_());
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    hex += ('0' + (bytes[i] & 0xff).toString(16)).slice(-2);
  }
  return hex.slice(0, 40).toUpperCase();
}

/** Per-project HMAC secret for the verification seal; auto-created once, then stable. */
function getOrCreateSigningSecret_() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty('SIGNING_SECRET');
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('SIGNING_SECRET', s);
  }
  return s;
}

/**
 * Filters + sorts Time Log sessions for the report window.
 * Filter key is the full Start datetime (a session belongs to the month it
 * STARTED in — midnight-crossing rows stay whole, as in the Excel version).
 */
function collectReportRows_(ctx, clientOrAll, monthStart, nextMonthStart) {
  var sh = ctx.ss.getSheetByName(CFG.sheets.log);
  var last = sh.getLastRow();
  if (last < CFG.log.firstDataRow) return [];
  var vals = sh.getRange(CFG.log.firstDataRow, 1, last - 1, CFG.log.lastCol).getValues();
  var wantAll = String(clientOrAll) === CFG.allClients;
  var want = String(clientOrAll || '').trim().toLowerCase();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var v = vals[i];
    var start = v[CFG.log.cols.start - 1];
    var client = String(v[CFG.log.cols.client - 1] || '').trim();
    if (!client || !(start instanceof Date)) continue;
    if (start < monthStart || start >= nextMonthStart) continue;
    if (!wantAll && client.toLowerCase() !== want) continue;
    out.push({
      date: v[CFG.log.cols.date - 1],
      client: client,
      task: String(v[CFG.log.cols.task - 1] || ''),
      start: start,
      end: v[CFG.log.cols.end - 1],
      hours: Number(v[CFG.log.cols.hours - 1]) || 0,
      rate: Number(v[CFG.log.cols.rate - 1]) || 0,
      amount: Number(v[CFG.log.cols.amount - 1]) || 0,
    });
  }
  out.sort(function (a, b) {
    return a.start.getTime() - b.start.getTime();
  });
  return out;
}
