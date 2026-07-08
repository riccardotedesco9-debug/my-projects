// test-report-windows.js — report content against an independent JS mirror of
// the filter semantics, plus the boundary cases that silently mis-bill when
// they regress: first/last instants of a month, midnight-crossing attribution,
// year isolation, case-insensitive client match, fixed-fee rendering, and
// regenerate-on-demand idempotency (stale rows/charts from a previous export).

function sectionReports_(S, env) {
  var ctx = env.ctx;
  var rep = env.repSh;
  var c = env.c;

  // --- Controlled boundary rows in a quiet month (2 months back) ---
  var base = new Date(env.y, env.m - 3, 1); // JS normalizes across year edges
  var yB = base.getFullYear();
  var mB = base.getMonth() + 1;
  var lastDay = new Date(yB, mB, 0).getDate();
  var add = function (yy, mm, dd, h1, min1, h2, min2, task) {
    appendLogRow_(ctx, new Date(yy, mm - 1, dd, h1, min1, 0).getTime(), new Date(yy, mm - 1, dd, h2, min2, 0).getTime(), 'Pet Centre', task);
  };
  add(yB, mB, 1, 0, 0, 1, 0, 'Boundary first-instant');
  add(yB, mB, lastDay, 23, 0, 23, 59, 'Boundary last-day');
  var prev = new Date(yB, mB - 1, 0); // last day of the month before mB
  add(prev.getFullYear(), prev.getMonth() + 1, prev.getDate(), 23, 0, 23, 59, 'Boundary prev-month');
  appendLogRow_(ctx,
    new Date(yB, mB - 1, lastDay, 23, 30, 0).getTime(),
    new Date(yB, mB - 1, lastDay + 1, 0, 30, 0).getTime(), // JS rolls into the next month
    'Pet Centre', 'Boundary cross-midnight');
  appendLogRow_(ctx,
    new Date(env.y - 1, 11, 31, 23, 0, 0).getTime(),
    new Date(env.y - 1, 11, 31, 23, 30, 0).getTime(),
    'Pet Centre', 'Prev-year row');

  var bodyTasks = function (meta) {
    if (meta.rowCount === 0) return [];
    return rep.getRange(12, 4, meta.rowCount, 1).getValues().map(function (r) { return String(r[0]); });
  };

  // --- Month window semantics ---
  var mirror = jsReportMirror_(env, 'Pet Centre', yB, mB);
  var meta = buildReportCtx_(ctx, 'Pet Centre', yB, mB, true, { forceFallback: true });
  S.t('boundary month: rowCount matches independent mirror', meta.rowCount, mirror.count);
  var tasks = bodyTasks(meta);
  S.t('1st 00:00 session included', tasks.indexOf('Boundary first-instant') >= 0, true);
  S.t('last-day 23:59 session included', tasks.indexOf('Boundary last-day') >= 0, true);
  S.t('previous month excluded', tasks.indexOf('Boundary prev-month') < 0, true);
  S.t('midnight-crossing session attributed to its START month', tasks.indexOf('Boundary cross-midnight') >= 0, true);
  var after = new Date(yB, mB, 1); // the month after mB, across year edges
  var nextMeta = buildReportCtx_(ctx, 'Pet Centre', after.getFullYear(), after.getMonth() + 1, true, { forceFallback: true });
  S.t('…and never billed twice (absent from the next month)', bodyTasks(nextMeta).indexOf('Boundary cross-midnight') < 0, true);
  var ciMeta = buildReportCtx_(ctx, 'pet centre', yB, mB, true, { forceFallback: true });
  S.t('client match is case-insensitive', ciMeta.rowCount, meta.rowCount);

  // --- Year windows (mirror-based: boundary rows may spill into y-1 when
  // the suite runs early in the year) ---
  var yPrevMirror = jsReportMirror_(env, 'Pet Centre', env.y - 1, 0);
  var yPrev = buildReportCtx_(ctx, 'Pet Centre', env.y - 1, 0, true, { forceFallback: true });
  S.t('previous-year export matches mirror', yPrev.rowCount, yPrevMirror.count);
  S.t('previous-year export contains its Dec 31 row', bodyTasks(yPrev).indexOf('Prev-year row') >= 0, true);
  S.near('previous-year export hours match mirror', yPrev.totalHours, yPrevMirror.hours, 0.02);
  S.t('year period cell is plain text', rep.getRange('C6').getNumberFormat(), '@');
  S.t('year period cell shows the year', String(rep.getRange('C6').getValue()), String(env.y - 1));
  var yMirror = jsReportMirror_(env, CFG.allClients, env.y, 0);
  var yMeta = buildReportCtx_(ctx, CFG.allClients, env.y, 0, true, { forceFallback: true });
  S.t('whole-year All Clients: rowCount matches mirror', yMeta.rowCount, yMirror.count);
  S.near('whole-year All Clients: hours match mirror', yMeta.totalHours, yMirror.hours, 0.02);
  S.t('whole-year excludes the previous year', bodyTasks(yMeta).indexOf('Prev-year row') < 0, true);

  // --- Current-month content: filter purity, totals, fixed-fee rendering ---
  var curMirror = jsReportMirror_(env, 'Pet Centre', env.y, env.m);
  var cur = buildReportCtx_(ctx, 'Pet Centre', env.y, env.m, true, { forceFallback: true });
  S.t('current month rowCount matches mirror', cur.rowCount, curMirror.count);
  S.near('totalHours excludes fixed-fee hours', cur.totalHours, curMirror.hours, 0.02);
  S.near('totalAmount includes fixed-fee €', cur.totalAmount, curMirror.amount, 0.02);
  S.t('TOTAL € cell equals meta.totalAmount', Number(rep.getRange(12 + cur.rowCount, 9).getValue()), cur.totalAmount);
  var clients = rep.getRange(12, 3, cur.rowCount, 1).getValues().map(function (r) { return String(r[0]); });
  S.t('per-client report leaks no other client', clients.filter(function (n) { return n !== 'Pet Centre'; }).join(','), '');
  var body = rep.getRange(12, 2, cur.rowCount, 8).getValues();
  // The injection defense must hold on the RENDERED report too, not just the
  // log — this is what actually reaches the client's PDF.
  var injIdx = -1;
  body.forEach(function (r, i) {
    if (String(r[2]) === '=SUM(1,2)') injIdx = i;
  });
  S.t('injected task renders as literal text on the report', injIdx >= 0, true);
  if (injIdx >= 0) S.t('…and is not a live formula there', rep.getRange(12 + injIdx, 4).getFormula(), '');
  var feeLine = body.filter(function (r) { return String(r[2]) === 'Logo design'; })[0];
  S.t('fee row renders: Rate = "Fixed"', feeLine ? String(feeLine[6]) : '(row missing)', 'Fixed');
  S.t('fee row renders: blank Start + Hours', feeLine ? String(feeLine[3]) + String(feeLine[5]) : 'x', '');
  S.t('fee row renders: the agreed €250', feeLine ? Number(feeLine[7]) : 0, 250);
  var dates = rep.getRange(12, 2, cur.rowCount, 1).getValues();
  var sorted = true;
  for (var i = 1; i < dates.length; i++) {
    if (dates[i][0] instanceof Date && dates[i - 1][0] instanceof Date && dates[i][0].getTime() < dates[i - 1][0].getTime()) sorted = false;
  }
  S.t('body is date-sorted (fees slot in by date)', sorted, true);
  S.t('report title present', String(rep.getRange('B3').getValue()), 'TIMESHEET');
  S.t('freelancer name on the report', String(rep.getRange('C5').getValue()), CFG.ownerName);
  S.t('signature at the bottom', String(rep.getRange(cur.signatureRow, 2).getValue()), CFG.ownerName);
  S.t('verification seal present', /^Document verification: [0-9A-F]{40}$/.test(String(rep.getRange(cur.signatureRow + 2, 2).getValue())), true);

  // --- Regenerate idempotency: the sheet is a disposable surface ---
  var cur2 = buildReportCtx_(ctx, 'Pet Centre', env.y, env.m, true, { forceFallback: true });
  S.t('identical rebuild → identical meta', cur2.rowCount === cur.rowCount && cur2.totalHours === cur.totalHours && cur2.totalAmount === cur.totalAmount, true);
  S.t('regeneration keeps exactly ONE pie', rep.getCharts().length, 1);
  var hoursOnly = buildReportCtx_(ctx, 'Pet Centre', env.y, env.m, false, { forceFallback: true });
  var hdr = rep.getRange(11, 2, 1, 8).getValues()[0].join('|');
  S.t('hours-only: no Rate/Amount columns', hdr.indexOf('Rate') < 0 && hdr.indexOf('Amount') < 0, true);
  S.t('hours-only: table ends at column G', hoursOnly.lastCol, 7);
  S.t('hours-only: fixed-fee rows excluded', hoursOnly.rowCount, cur.rowCount - curMirror.fixed);
  // Scan the FULL vertical extent the money build wrote (body + TOTAL +
  // breakdown + signature zone), not just the shorter hours-only body.
  var stale = rep.getRange(12, 9, cur.signatureRow - 12 + 1, 1).getValues().filter(function (r) { return r[0] !== ''; });
  S.t('money→hours-only toggle leaves no stale € column', stale.length, 0);
  S.t('hours-only still draws its pie (by hours)', rep.getCharts().length, 1);

  // --- Fixed-only period: € without hours must not divide by zero ---
  var feb = buildReportCtx_(ctx, "Paws 'n' Claws", env.y + 1, 2, true, { forceFallback: true });
  S.t('fixed-only month: one row', feb.rowCount, 1);
  S.t('fixed-only month: zero hours', feb.totalHours, 0);
  S.t('fixed-only month: € carried', feb.totalAmount, 100);
  // First breakdown group row = bodyTop(12) + rows + gap-to-breakdown(4) + (label, header)(2).
  S.t('fixed-only month: share cell is 0, not an error', Number(rep.getRange(12 + feb.rowCount + 4 + 2, 6).getValue()), 0);
  S.t('fixed-only month: single group → no pie', rep.getCharts().length, 0);
  var febHours = buildReportCtx_(ctx, "Paws 'n' Claws", env.y + 1, 2, false, { forceFallback: true });
  S.t('fixed-only month, hours-only: empty timesheet', febHours.rowCount === 0 && String(rep.getRange('B12').getValue()) === MSG.noSessions, true);

  // --- In-progress rows are EXCLUDED from the report/PDF/seal ---
  var logSh = ctx.ss.getSheetByName(CFG.sheets.log);
  var ipRow = appendInProgressRow_(ctx, new Date(env.y, env.m - 1, 12, 9, 0, 0).getTime(), 'Pet Centre', 'STILL RUNNING report-exclude', false);
  var withIp = buildReportCtx_(ctx, 'Pet Centre', env.y, env.m, true, { forceFallback: true });
  var ipTasks = withIp.rowCount ? rep.getRange(12, 4, withIp.rowCount, 1).getValues().map(function (r) { return String(r[0]); }) : [];
  S.t('in-progress row excluded from the report body', ipTasks.indexOf('STILL RUNNING report-exclude') < 0, true);
  logSh.deleteRow(ipRow); // don't let it pollute later sections

  // --- A "Free" completed session: "Free" (green) in Amount, €0 in the total,
  //     hours still counted ---
  var freeRow = appendInProgressRow_(ctx, new Date(env.y, env.m - 1, 13, 9, 0, 0).getTime(), 'Pet Centre', 'FREE report-render', true);
  completeSessionRow_(ctx, freeRow, new Date(env.y, env.m - 1, 13, 11, 0, 0).getTime()); // 2h
  var freeMirror = jsReportMirror_(env, 'Pet Centre', env.y, env.m);
  var freeMeta = buildReportCtx_(ctx, 'Pet Centre', env.y, env.m, true, { forceFallback: true });
  S.t('free report: rowCount matches mirror (free row included)', freeMeta.rowCount, freeMirror.count);
  var freeBody = rep.getRange(12, 2, freeMeta.rowCount, 8).getValues();
  var freeLine = freeBody.filter(function (r) { return String(r[2]) === 'FREE report-render'; })[0];
  S.t('free row renders "Free" in the Amount column', freeLine ? String(freeLine[7]) : '(missing)', 'Free');
  S.t('free row renders no rate ("—")', freeLine ? String(freeLine[6]) : 'x', '—');
  S.near('free report: hours match mirror (free hours counted)', freeMeta.totalHours, freeMirror.hours, 0.05);
  S.near('free report: € total excludes the free session', freeMeta.totalAmount, freeMirror.amount, 0.05);
  logSh.deleteRow(freeRow);
}

/** Independent JS mirror of collectReportRows_ filter semantics (the oracle). */
function jsReportMirror_(env, clientOrAll, year, month) {
  var vals = readLogValues_(env);
  var c = CFG.log.cols;
  var isYear = !month;
  var ps = isYear ? new Date(year, 0, 1) : new Date(year, month - 1, 1);
  var pe = isYear ? new Date(year + 1, 0, 1) : new Date(year, month, 1);
  var wantAll = String(clientOrAll) === CFG.allClients;
  var want = String(clientOrAll || '').trim().toLowerCase();
  var out = { count: 0, hours: 0, amount: 0, fixed: 0 };
  vals.forEach(function (v) {
    var date = v[c.date - 1];
    var client = String(v[c.client - 1] || '').trim();
    if (!client || !(date instanceof Date)) return;
    if (date < ps || date >= pe) return;
    if (!wantAll && client.toLowerCase() !== want) return;
    var start = v[c.start - 1];
    var end = v[c.end - 1];
    // Running (in-progress) rows — Start set, End blank — are excluded, exactly
    // as collectReportRows_ excludes them.
    if (start instanceof Date && !(end instanceof Date)) return;
    var fixed = !(start instanceof Date);
    out.count++;
    if (fixed) out.fixed++;
    else out.hours += Number(v[c.hours - 1]) || 0;
    out.amount += Number(v[c.amount - 1]) || 0;
  });
  out.hours = Math.round(out.hours * 100) / 100;
  out.amount = Math.round(out.amount * 100) / 100;
  return out;
}
