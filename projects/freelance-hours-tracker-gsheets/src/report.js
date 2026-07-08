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
  // month 0 (or falsy) means a whole-year export.
  var isYear = !month;
  var periodStart = isYear ? new Date(year, 0, 1) : new Date(year, month - 1, 1);
  var periodEnd = isYear ? new Date(year + 1, 0, 1) : new Date(year, month, 1);
  var lastCol = includeMoney ? 9 : 7;
  var rows = collectReportRows_(ctx, clientOrAll, periodStart, periodEnd);
  // An hours-only timesheet omits fixed-fee project rows (they carry no hours).
  if (!includeMoney) rows = rows.filter(function (r) { return !r.fixed; });

  var body = sh.getRange(3, 1, Math.max(sh.getMaxRows() - 2, 1), 10); // incl. col J pie-legend helper
  body.clear();
  // clear() does NOT unmerge: without this, toggling includeMoney between
  // exports throws when the new 'Generated:' merge overlaps the stale one.
  body.breakApart();
  // The pie chart is regenerated per export too.
  sh.getCharts().forEach(function (ch) {
    sh.removeChart(ch);
  });

  // The report shell is trimmed small (not the 1000-row default) — grow the grid
  // to hold THIS report before writing into it. ~40 rows headroom covers the
  // breakdown table, pie and signature.
  var needed = 12 + rows.length + 40;
  if (sh.getMaxRows() < needed) sh.insertRowsAfter(sh.getMaxRows(), needed - sh.getMaxRows());

  sh.getRange('B3').setValue('TIMESHEET').setFontSize(22).setFontWeight('bold').setFontColor(CFG.colors.navy);

  sh.getRange('B5').setValue('Freelancer').setFontWeight('bold');
  sh.getRange('C5').setValue(CFG.ownerName);
  sh.getRange('B6').setValue('Period').setFontWeight('bold');
  // Month → a real date with an mmmm-yyyy format (a string would coerce badly);
  // year → the plain year. Left-aligned to line up with the text rows.
  if (isYear) {
    sh.getRange('C6').setValue(String(year)).setNumberFormat('@').setHorizontalAlignment('left');
  } else {
    sh.getRange('C6').setValue(periodStart).setNumberFormat(CFG.formats.month).setHorizontalAlignment('left');
  }
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
  // A "SESSIONS" section heading at row 10 (blank row 9 breathes above it), then
  // the navy column bar at row 11 — mirrors the WORK BREAKDOWN heading-over-table
  // layout so every section is titled.
  sh.getRange(10, 2).setValue('SESSIONS').setFontWeight('bold').setFontColor(CFG.colors.navy);
  sh.getRange(11, 2, 1, headers.length)
    .setValues([headers])
    .setBackground(CFG.colors.navy)
    .setFontColor(CFG.colors.white)
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  var totalHours = 0;
  var totalAmount = 0;
  var bodyTop = 12;
  var lastRow;

  if (rows.length === 0) {
    sh.getRange(bodyTop, 2)
      .setValue(MSG.noSessions)
      .setFontStyle('italic')
      .setFontColor(CFG.colors.gray);
    lastRow = bodyTop;
  } else {
    var out = rows.map(function (r) {
      totalHours += r.fixed ? 0 : r.hours;
      totalAmount += r.amount; // a free row's amount is 0 → excluded from the total
      // Fixed-fee project rows have no times/hours/rate — just the agreed €.
      // literal_ guards the re-write: a task stored as "=SUM(...)" text in the
      // log must stay text here too, not become a live formula on the PDF.
      var line = [
        r.date, literal_(r.client), literal_(r.task),
        r.start || '', r.end || '', r.fixed ? '' : r.hours,
      ];
      if (includeMoney) {
        // A free session shows "Free" (green, below) in place of € and no rate;
        // a fixed-fee row shows "Fixed"; everything else its live rate + amount.
        line = line.concat([r.fixed ? 'Fixed' : (r.free ? '—' : r.rate), r.free ? 'Free' : r.amount]);
      }
      return line;
    });
    sh.getRange(bodyTop, 2, out.length, headers.length).setValues(out);
    sh.getRange(bodyTop, 2, out.length, 1).setNumberFormat(CFG.formats.date);
    sh.getRange(bodyTop, 5, out.length, 2).setNumberFormat(CFG.formats.time);
    sh.getRange(bodyTop, 7, out.length, 1).setNumberFormat(CFG.formats.hours);
    if (includeMoney) {
      // Right-align Rate + Amount so the € values AND the text cells ("Fixed",
      // "—", "Free") all line up on the right instead of the text hanging left.
      sh.getRange(bodyTop, 8, out.length, 2).setNumberFormat(CFG.formats.euro).setHorizontalAlignment('right');
      // Paint "Free" amounts green — a no-charge session reads as a gift, not €0.
      rows.forEach(function (r, i) {
        if (r.free) sh.getRange(bodyTop + i, 9).setFontColor(CFG.colors.green).setFontWeight('bold');
      });
    }
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

  // Work breakdown, set below the session TOTAL so the two tables read as
  // separate sections without a cramped seam (3 blank rows between).
  var breakdown = [];
  var afterBreakdown = totalRow + 2;
  if (rows.length > 0) {
    var yyyymm = isYear ? year + '-full' : year + '-' + (month < 10 ? '0' : '') + month;
    breakdown = consolidateTasks_(ctx, clientOrAll, yyyymm, rows, { forceFallback: !!opts.forceFallback });
    afterBreakdown = renderBreakdown_(sh, totalRow + 4, breakdown, totalHours, includeMoney);
  }

  // …and the automatic electronic signature closes the page at the bottom:
  // name (signature face) + a self-certified-as-correct line + an HMAC
  // verification seal over the line items. Unlike DocuSign, zero manual action.
  var signRow = afterBreakdown + 2;
  sh.getRange(signRow, 2)
    .setValue(CFG.ownerName)
    .setFontFamily('Caveat')
    .setFontSize(22)
    .setFontColor(CFG.colors.navy);
  var signedTs = Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy HH:mm');
  sh.getRange(signRow + 1, 2)
    .setValue('Electronically signed & self-certified as correct · ' + signedTs + ' · Malta ID ' + CFG.ownerId)
    .setFontColor(CFG.colors.gray)
    .setFontSize(9);
  var seal = documentSeal_(ctx, clientOrAll, year, month, rows, totalHours, totalAmount, signedTs);
  sh.getRange(signRow + 2, 2)
    .setValue('Document verification: ' + seal)
    .setFontColor(CFG.colors.gray)
    .setFontSize(8)
    .setFontFamily('Roboto Mono');

  return {
    rowCount: rows.length,
    totalHours: Math.round(totalHours * 100) / 100,
    totalAmount: Math.round(totalAmount * 100) / 100,
    breakdown: breakdown,
    signatureRow: signRow,
    lastRow: signRow + 2,
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
function renderBreakdown_(sh, top, groups, totalHours, includeMoney) {
  sh.getRange(top, 2).setValue('WORK BREAKDOWN').setFontWeight('bold').setFontColor(CFG.colors.navy);

  // Heading sits directly above the navy table header (no floating gap), matching
  // the SESSIONS heading-over-bar and the pie's title-over-chart.
  var head = top + 1;
  var cols = includeMoney ? 6 : 5; // B..F (Share) [..G Amount]
  sh.getRange(head, 2, 1, cols)
    .setBackground(CFG.colors.navy)
    .setFontColor(CFG.colors.white)
    .setFontWeight('bold');
  sh.getRange(head, 2).setValue('Type of work');
  sh.getRange(head, 5).setValue('Hours').setHorizontalAlignment('center');
  sh.getRange(head, 6).setValue('Share').setHorizontalAlignment('center');
  if (includeMoney) sh.getRange(head, 7).setValue('Amount').setHorizontalAlignment('center');

  var totalAmount = 0;
  for (var i = 0; i < groups.length; i++) {
    var r = head + 1 + i;
    sh.getRange(r, 2).setValue(literal_(groups[i].label));
    sh.getRange(r, 5).setValue(groups[i].hours).setNumberFormat(CFG.formats.hours).setHorizontalAlignment('center');
    sh.getRange(r, 6)
      .setValue(totalHours > 0 ? groups[i].hours / totalHours : 0)
      .setNumberFormat('0%')
      .setHorizontalAlignment('center');
    if (includeMoney) {
      sh.getRange(r, 7).setValue(groups[i].amount || 0).setNumberFormat(CFG.formats.euro).setHorizontalAlignment('right');
      totalAmount += groups[i].amount || 0;
    }
    // Hidden pie-legend label (col J): "Type of work   €Amount" (or "…  Xh" in
    // hours mode) so the amount shows beside each name in the legend. Column J is
    // hidden below, so it never appears in the exported PDF.
    var vNum = includeMoney ? (groups[i].amount || 0) : groups[i].hours;
    var vp = (Math.round(vNum * 100) / 100).toFixed(2).split('.');
    vp[0] = vp[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    sh.getRange(r, 10).setValue(literal_(groups[i].label + (includeMoney ? '   €' + vp.join('.') : '   ' + vp.join('.') + ' h')));
  }
  sh.hideColumns(10); // the pie-legend helper column

  var totalRowN = head + 1 + groups.length;
  sh.getRange(totalRowN, 2, 1, cols).setBorder(true, null, null, null, false, false, CFG.colors.navy, SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(totalRowN, 4).setValue('TOTAL').setFontWeight('bold').setHorizontalAlignment('right');
  sh.getRange(totalRowN, 5).setValue(Math.round(totalHours * 100) / 100).setNumberFormat(CFG.formats.hours).setFontWeight('bold').setHorizontalAlignment('center');
  if (includeMoney) {
    sh.getRange(totalRowN, 7).setValue(Math.round(totalAmount * 100) / 100).setNumberFormat(CFG.formats.euro).setFontWeight('bold').setHorizontalAlignment('right');
  }

  if (groups.length > 1) {
    // Title as a styled sheet CELL above the pie (navy bold, matching the
    // section headings) — Sheets' embedded-chart renderer ignores titleTextStyle
    // colour, so the pie's own title can't be navy; a cell can. The chart itself
    // is titleless and sits one row below the heading.
    sh.getRange(totalRowN + 2, 2)
      .setValue(includeMoney ? 'Cost by work type' : 'Hours by work type')
      .setFontWeight('bold')
      .setFontColor(CFG.colors.navy);
    var chartTop = totalRowN + 3;
    // Pie by € when money is shown, else by hours. Google pies force the legend
    // and the on-slice text to share one label source, so: full work-type names
    // go in the legend (the key you need), and slices show percentages.
    var valueCol = includeMoney ? 7 : 5;
    var chart = sh
      .newChart()
      .setChartType(Charts.ChartType.PIE)
      .addRange(sh.getRange(head + 1, 10, groups.length, 1)) // labels = "name   €amount" (hidden col J)
      .addRange(sh.getRange(head + 1, valueCol, groups.length, 1)) // values
      .setOption('legend', { position: 'right', textStyle: { fontSize: 10, color: CFG.colors.navy } })
      .setOption('pieSliceText', 'percentage') // % on slices; full names in the legend
      .setOption('title', '') // titled by the navy cell above
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
      .setOption('width', 520)
      .setOption('height', 250)
      .setPosition(chartTop, 2, 0, 0) // below the heading → full width, always renders on A4
      .build();
    sh.insertChart(chart);
    return chartTop + 14; // heading row + pie zone
  }

  return totalRowN + 1;
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
      var s = r.start
        ? Utilities.formatDate(r.start, tz, 'yyyy-MM-dd HH:mm')
        : Utilities.formatDate(r.date, tz, 'yyyy-MM-dd') + ' fixed';
      var e = r.end ? Utilities.formatDate(r.end, tz, 'yyyy-MM-dd HH:mm') : '';
      return [s, e, r.task, r.hours, r.amount].join('~');
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
 * Filters + sorts Time Log rows for a report window (a month or a whole year).
 * Filters on the DATE column so it handles both hourly sessions AND fixed-fee
 * project rows (which have a date + amount but no Start/End). A row with no
 * Start is a fixed-fee project (flagged `fixed`).
 */
function collectReportRows_(ctx, clientOrAll, periodStart, periodEnd) {
  var sh = ctx.ss.getSheetByName(CFG.sheets.log);
  var last = sh.getLastRow();
  if (last < CFG.log.firstDataRow) return [];
  var c = CFG.log.cols;
  var vals = sh.getRange(CFG.log.firstDataRow, 1, last - 1, CFG.log.lastCol).getValues();
  var wantAll = String(clientOrAll) === CFG.allClients;
  var want = String(clientOrAll || '').trim().toLowerCase();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var v = vals[i];
    var date = v[c.date - 1];
    var client = String(v[c.client - 1] || '').trim();
    if (!client || !(date instanceof Date)) continue;
    if (date < periodStart || date >= periodEnd) continue;
    if (!wantAll && client.toLowerCase() !== want) continue;
    var start = v[c.start - 1];
    var end = v[c.end - 1];
    // Skip a still-running (in-progress) session — Start set, End blank. It has
    // no final hours/amount yet, so it must never reach a timesheet/PDF or seal.
    if (start instanceof Date && !(end instanceof Date)) continue;
    out.push({
      date: date,
      client: client,
      task: String(v[c.task - 1] || ''),
      start: start instanceof Date ? start : null,
      end: end instanceof Date ? end : null,
      hours: Number(v[c.hours - 1]) || 0,
      rate: Number(v[c.rate - 1]) || 0,
      amount: Number(v[c.amount - 1]) || 0,
      free: String(v[c.amount - 1]) === 'Free',
      fixed: !(start instanceof Date),
    });
  }
  out.sort(function (a, b) {
    var ka = a.start ? a.start.getTime() : a.date.getTime();
    var kb = b.start ? b.start.getTime() : b.date.getTime();
    return ka - kb;
  });
  return out;
}
