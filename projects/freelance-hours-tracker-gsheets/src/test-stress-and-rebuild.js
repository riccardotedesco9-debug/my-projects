// test-stress-and-rebuild.js — volume: 150 batch rows on top of everything
// the earlier sections logged, then a full-log invariant sweep, reports and
// sort at scale, zero-gap switch chains and rapid churn with no sleeps.
// Then the two maintenance paths: updateLayout_ (must preserve every byte of
// data) and a second full rebuild_ (the documented disaster-recovery path).

function sectionStress_(S, env) {
  var ctx = env.ctx;
  var log = env.logSh;
  var c = env.c;

  // --- Bulk-load 150 deterministic rows (batch writes, real formulas) ---
  var N = 150;
  var t0 = Date.now();
  var startRow = log.getLastRow() + 1;
  var overflow = startRow + N - 1 - log.getMaxRows();
  if (overflow > 0) log.insertRowsAfter(log.getMaxRows(), overflow + 10);
  var clients = ['Pet Centre', 'Splash Store', "Paws 'n' Claws"];
  var rates = [45, 20, 30];
  var clientsA = "'" + CFG.sheets.clients + "'!$A$2:$A";
  var clientsB = "'" + CFG.sheets.clients + "'!$B$2:$B";
  var ct = [];
  var se = [];
  var fDate = [];
  var fHours = [];
  var fRate = [];
  var fAmount = [];
  var exp = [];
  for (var i = 0; i < N; i++) {
    var r = startRow + i;
    var day = (i % 26) + 1;
    var mins = 30 + (i % 7) * 30;
    var s = new Date(env.y, env.m - 1, day, 6 + (i % 10), 0, 0);
    ct.push([clients[i % 3], 'Bulk task ' + (i % 20)]);
    se.push([s, new Date(s.getTime() + mins * 60000)]);
    var A = function (col) { return colLetter_(col) + r; };
    fDate.push(['=INT(' + A(c.start) + ')']);
    fHours.push(['=ROUND((' + A(c.end) + '-' + A(c.start) + ')*24, 2)']);
    fRate.push(['=IFERROR(N(INDEX(' + clientsB + ', MATCH(' + A(c.client) + ', ' + clientsA + ', 0))), 0)']);
    fAmount.push(['=ROUND(' + A(c.hours) + '*' + A(c.rate) + ', 2)']);
    var h = Math.round((mins / 60) * 100) / 100;
    exp.push({ hours: h, amount: Math.round(h * rates[i % 3] * 100) / 100 });
  }
  log.getRange(startRow, c.client, N, 2).setValues(ct);
  log.getRange(startRow, c.start, N, 2).setValues(se).setNumberFormat(CFG.formats.time);
  log.getRange(startRow, c.date, N, 1).setFormulas(fDate).setNumberFormat(CFG.formats.date);
  log.getRange(startRow, c.hours, N, 1).setFormulas(fHours).setNumberFormat(CFG.formats.hours);
  log.getRange(startRow, c.rate, N, 1).setFormulas(fRate).setNumberFormat(CFG.formats.euro);
  log.getRange(startRow, c.amount, N, 1).setFormulas(fAmount).setNumberFormat(CFG.formats.euro);
  SpreadsheetApp.flush();
  S.info('bulk load', N + ' rows in ' + (Date.now() - t0) + 'ms');
  S.t('bulk: row count grew by exactly ' + N, log.getLastRow(), startRow + N - 1);
  [0, 77, 137].forEach(function (idx) {
    S.t('bulk row ' + idx + ': hours', Number(log.getRange(startRow + idx, c.hours).getValue()), exp[idx].hours);
    S.t('bulk row ' + idx + ': amount', Number(log.getRange(startRow + idx, c.amount).getValue()), exp[idx].amount);
  });

  // --- Full-log invariant sweep: every row, every invariant ---
  var sweep = sweepLogInvariants_(ctx);
  S.info('log census', sweep.hourly + ' timed + ' + sweep.fixed + ' fixed rows; ' + sweep.overlaps.length + ' overlaps (intentional here)');
  S.t('every row internally consistent at volume', sweep.violations.slice(0, 5).join(' ; '), '');

  // --- Report + breakdown at volume ---
  t0 = Date.now();
  var mirror = jsReportMirror_(env, CFG.allClients, env.y, env.m);
  var meta = buildReportCtx_(ctx, CFG.allClients, env.y, env.m, true, { forceFallback: true });
  S.info('All-Clients month report at volume', meta.rowCount + ' rows in ' + (Date.now() - t0) + 'ms');
  S.t('volume report: rowCount matches mirror', meta.rowCount, mirror.count);
  S.near('volume report: hours match mirror', meta.totalHours, mirror.hours, 0.05);
  S.near('volume report: € matches mirror', meta.totalAmount, mirror.amount, 0.05);
  var bdHours = meta.breakdown.reduce(function (a, g) { return a + g.hours; }, 0);
  var bdAmount = meta.breakdown.reduce(function (a, g) { return a + (g.amount || 0); }, 0);
  S.near('volume breakdown: hours reconcile', Math.round(bdHours * 100) / 100, meta.totalHours, 0.05);
  S.near('volume breakdown: € reconciles', Math.round(bdAmount * 100) / 100, meta.totalAmount, 0.05);

  // --- Zero-gap switch chain, no sleeps ---
  var base = log.getLastRow();
  startWorkCtx_(ctx, 'Pet Centre', 'Chain A', {});
  startWorkCtx_(ctx, 'Splash Store', 'Chain B', {});
  startWorkCtx_(ctx, "Paws 'n' Claws", 'Chain C', {});
  stopAndLogCtx_(ctx);
  S.t('chain: three rows logged', log.getLastRow(), base + 3);
  S.t('chain: A→B seam is zero-gap', log.getRange(base + 1, c.end).getValue().getTime(), log.getRange(base + 2, c.start).getValue().getTime());
  S.t('chain: B→C seam is zero-gap', log.getRange(base + 2, c.end).getValue().getTime(), log.getRange(base + 3, c.start).getValue().getTime());

  // --- Rapid start/stop churn, no sleeps ---
  base = log.getLastRow();
  for (var k = 1; k <= 6; k++) {
    startWorkCtx_(ctx, 'Pet Centre', 'Churn ' + k, {});
    stopAndLogCtx_(ctx);
  }
  S.t('churn: six 0.00h rows, no corruption', log.getLastRow(), base + 6);
  S.t('churn: order preserved', String(log.getRange(base + 6, c.task).getValue()), 'Churn 6');
  S.t('churn: ends IDLE', getTimerState_(ctx).status, 'IDLE');

  // --- Mass delete then append ---
  var before = log.getLastRow();
  log.deleteRows(startRow + 50, 50);
  S.t('mass delete: 50 rows removed in one call', log.getLastRow(), before - 50);
  appendLogRow_(ctx, Date.now() - 60000, Date.now(), 'Pet Centre', 'After mass delete');
  S.t('append after mass delete lands at the end', String(log.getRange(log.getLastRow(), c.task).getValue()), 'After mass delete');

  // --- Sort at volume: formulas must follow their rows ---
  t0 = Date.now();
  S.t('sort runs', sortLogByDate_(ctx), true);
  S.info('sort duration', (Date.now() - t0) + 'ms for ' + (log.getLastRow() - 1) + ' rows');
  var dates = log.getRange(2, c.date, log.getLastRow() - 1, 1).getValues();
  var mono = true;
  for (var j = 1; j < dates.length; j++) {
    if (dates[j][0] instanceof Date && dates[j - 1][0] instanceof Date && dates[j][0].getTime() < dates[j - 1][0].getTime()) mono = false;
  }
  S.t('sorted oldest-first end to end', mono, true);
  var all = readLogValues_(env);
  var det = all.filter(function (row) { return String(row[c.task - 1]) === 'Deterministic row'; })[0];
  S.t('formulas followed their rows through the sort (8.50h row still €382.50)', det ? Number(det[c.amount - 1]) : 0, 382.5);
  S.t('…and still shows its 8.50 hours', det ? Number(det[c.hours - 1]) : 0, 8.5);
  var sweep2 = sweepLogInvariants_(ctx);
  S.t('every invariant still holds after the sort', sweep2.violations.slice(0, 5).join(' ; '), '');

  // --- Seal throughput over the whole dataset ---
  var rows = collectReportRows_(ctx, CFG.allClients, new Date(env.y - 1, 0, 1), new Date(env.y + 2, 0, 1));
  t0 = Date.now();
  var s1 = documentSeal_(ctx, CFG.allClients, env.y, 0, rows, 1, 1, 'x');
  var s2 = documentSeal_(ctx, CFG.allClients, env.y, 0, rows, 1, 1, 'x');
  S.t('seal deterministic over ' + rows.length + ' rows', s1, s2);
  S.info('seal throughput', rows.length + ' rows sealed twice in ' + (Date.now() - t0) + 'ms');
}

function sectionUpdateLayout_(S, env) {
  var ctx = env.ctx;
  var log = env.logSh;
  var rowsBefore = log.getLastRow();
  var clientRow = env.clientsSh.getRange(2, 1, 1, 3).getValues()[0];
  startWorkCtx_(ctx, 'Pet Centre', 'Survives the update', {});

  var t0 = Date.now();
  updateLayout_(env.ss);
  S.info('updateLayout duration', (Date.now() - t0) + 'ms');

  S.t('every log row preserved', log.getLastRow(), rowsBefore);
  S.t('still 6 sheets', env.ss.getSheets().length, 6);
  S.t('settings mirror stays hidden after the update', env.ss.getSheetByName(CFG.sheets.settings).isSheetHidden(), true);
  var after = env.clientsSh.getRange(2, 1, 1, 3).getValues()[0];
  S.t('client name preserved', String(after[0]), String(clientRow[0]));
  S.t('client rate preserved', Number(after[1]), Number(clientRow[1]));
  S.t('client email preserved', String(after[2]), String(clientRow[2]));
  var missing = Object.keys(CFG.named).filter(function (k) { return !env.ss.getRangeByName(CFG.named[k]); });
  S.t('all named ranges re-registered', missing.join(','), '');
  S.t('summary charts not duplicated', env.ss.getSheetByName(CFG.sheets.summary).getCharts().length, 2);
  S.t('log banding not duplicated', log.getBandings().length, 1);
  S.t('log filter survives the update (idempotent, not doubled)', !!log.getFilter(), true);
  var dump = log.getConditionalFormatRules().map(function (r) {
    var bc = r.getBooleanCondition();
    return bc ? bc.getCriteriaValues().join(' ') : '[gradient]';
  });
  S.t('8 conditional rules re-asserted', dump.length, 8);
  S.t('rule order re-asserted (midnight+busy first)', dump[0].indexOf('INT($E2)') >= 0 && dump[0].indexOf('>12') >= 0, true);
  var colVal = log.getRange(2, CFG.log.cols.client).getDataValidation();
  S.t('log client dropdown restored', !!colVal && colVal.getAllowInvalid() === false, true);

  S.t('running timer survives the update', getTimerState_(ctx).status, 'RUNNING');
  var stop = stopAndLogCtx_(ctx);
  S.t('…and stops & logs cleanly afterwards', stop.ok, true);

  // The phone path must still work against the re-created Dashboard.
  setNamedValue_(ctx, CFG.named.dbClient, 'Pet Centre');
  setNamedValue_(ctx, CFG.named.dbTask, 'Post-update tick');
  var chkStart = env.ss.getRangeByName(CFG.named.chkStart);
  chkStart.setValue(true);
  onEditInstallable({ range: chkStart, value: 'TRUE', source: env.ss });
  S.t('checkbox path alive after update', getTimerState_(ctx).status, 'RUNNING');
  var chkStop = env.ss.getRangeByName(CFG.named.chkStop);
  chkStop.setValue(true);
  onEditInstallable({ range: chkStop, value: 'TRUE', source: env.ss });
  S.t('checkbox stop alive after update', getTimerState_(ctx).status, 'IDLE');

  var sweep = sweepLogInvariants_(ctx);
  S.t('every data invariant survived the update', sweep.violations.slice(0, 5).join(' ; '), '');

  // Seed guard: a blank row 2 with real clients below must NOT re-seed —
  // re-seeding would overwrite a real client and re-price its history to €0.
  var petRow = env.clientsSh.getRange(2, 1, 1, 3).getValues()[0];
  env.clientsSh.getRange(2, 1, 1, 3).clearContent();
  buildClientsSheet_(env.ss);
  S.t('seed guard: blank row 2 + real clients below → no re-seed', String(env.clientsSh.getRange(2, 1).getValue()), '');
  S.t('seed guard: clients below the blank row untouched', String(env.clientsSh.getRange(4, 1).getValue()), "Paws 'n' Claws");
  env.clientsSh.getRange(2, 1, 1, 3).setValues([petRow]);
}

function sectionRebuild_(S, env) {
  // The documented "safe to run twice" contract — this is rebuild #2 on a
  // fully-loaded workbook, the exact disaster-recovery path. Destroys the
  // throwaway's data by design; it is trashed right after anyway.
  var t0 = Date.now();
  rebuild_(env.ss);
  S.info('full rebuild duration', (Date.now() - t0) + 'ms');
  S.t('exactly 6 sheets after rebuild', env.ss.getSheets().length, 6);
  S.t('no leftover __rebuild__ sheet', env.ss.getSheetByName('__rebuild__'), null);
  var order = env.ss.getSheets().map(function (sh) { return sh.getName(); }).join('|');
  S.t('canonical tab order', order, [CFG.sheets.dashboard, CFG.sheets.log, CFG.sheets.report, CFG.sheets.summary, CFG.sheets.clients, CFG.sheets.settings].join('|'));
  var missing = Object.keys(CFG.named).filter(function (k) { return !env.ss.getRangeByName(CFG.named[k]); });
  S.t('all named ranges rebuilt', missing.join(','), '');
  S.t('log wiped to a clean slate', env.ss.getSheetByName(CFG.sheets.log).getLastRow(), 1);
  S.t('starter clients re-seeded', String(env.ss.getSheetByName(CFG.sheets.clients).getRange(2, 1).getValue()), 'Pet Centre');
  S.t('summary rebuilt with its 2 charts', env.ss.getSheetByName(CFG.sheets.summary).getCharts().length, 2);
  S.t('report shell rebuilt chartless', env.ss.getSheetByName(CFG.sheets.report).getCharts().length, 0);
  S.t('banner reset to idle', String(env.ss.getRangeByName(CFG.named.dbStatus).getValue()), 'IDLE — ready to start');
}
