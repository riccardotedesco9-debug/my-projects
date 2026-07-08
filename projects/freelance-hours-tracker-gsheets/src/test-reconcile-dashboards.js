// test-reconcile-dashboards.js — the money must add up EVERYWHERE. Every
// dashboard stat, summary total, pivot matrix row, and chart-data column is
// reconciled against an independent JS aggregation of the raw Time Log —
// a formula regression can't hide behind "the cell shows a number".
// Reads happen FIRST, then a rollover check: if midnight (or a month edge)
// passed mid-section, the volatile TODAY()-window comparisons are skipped
// with a warning instead of false-failing on a correct system.

function sectionReconcile_(S, env) {
  SpreadsheetApp.flush();
  var ss = env.ss;
  var c = env.c;
  var tz = env.tz;
  var vals = readLogValues_(env);
  var now = new Date();
  var todayKey = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var monthKey = Utilities.formatDate(now, tz, 'yyyy-MM');
  var ymOf = function (d) { return d.getFullYear() * 12 + d.getMonth(); };
  var curYm = ymOf(now);
  var weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));

  // --- Independent JS aggregation (mirrors the formulas' windows, including
  // the "client is not null" guard the Summary QUERYs carry) ---
  // Totals/by-client/chart follow the Summary's F2 window selector (months);
  // the matrices stay on a fixed 13-month grid. Mirrors whatever F2 holds; the
  // || 13 is only a fallback if F2 is somehow unset (build default is 12).
  var winMonths = Number(ss.getSheetByName(CFG.sheets.summary).getRange('F2').getValue()) || 13;
  var js = { today: 0, week: 0, month: 0, monthEarn: 0, winH: 0, winE: 0, petMonth: 0 };
  var buckets = {};
  var clientSet = {};
  vals.forEach(function (v) {
    var date = v[c.date - 1];
    var client = String(v[c.client - 1] || '').trim();
    if (!(date instanceof Date) || !client) return;
    clientSet[client] = true;
    var hours = Number(v[c.hours - 1]) || 0;
    var amount = Number(v[c.amount - 1]) || 0;
    var dKey = Utilities.formatDate(date, tz, 'yyyy-MM-dd');
    if (dKey === todayKey) js.today += hours;
    if (date >= weekStart && dKey <= todayKey) js.week += hours;
    if (Utilities.formatDate(date, tz, 'yyyy-MM') === monthKey) {
      js.month += hours;
      js.monthEarn += amount;
      if (client === 'Pet Centre') js.petMonth += hours;
    }
    if (ymOf(date) >= curYm - 13) buckets[ymOf(date)] = true; // matrix (fixed 13-mo grid)
    if (ymOf(date) >= curYm - winMonths) {
      js.winH += hours;
      js.winE += amount;
    }
  });
  // Preconditions: the fixed read windows below can hold 14 month-buckets /
  // 10 clients — a future test seeding more must fail HERE, with a clear name.
  S.t('precondition: month buckets fit the matrix window', Object.keys(buckets).length <= 14, true);
  S.t('precondition: clients fit the by-client card', Object.keys(clientSet).length <= 10, true);

  // --- Read phase (everything volatile, in one burst) ---
  var dash = ss.getSheetByName(CFG.sheets.dashboard);
  var summary = ss.getSheetByName(CFG.sheets.summary);
  var vToday = Number(ss.getRangeByName(CFG.named.dbToday).getValue());
  var vWeek = Number(dash.getRange('C27').getValue()); // "This week" (AT A GLANCE row 2)
  var vMonth = Number(ss.getRangeByName(CFG.named.dbMonth).getValue());
  var vEarn = Number(dash.getRange('C29').getValue()); // "Earned this month" (AT A GLANCE row 4)
  var byClient = dash.getRange('E27:G36').getValues(); // THIS MONTH BY CLIENT spill
  var snap = buildSnapshot_(env.ctx);
  var vSumHours = Number(summary.getRange('B5').getValue());
  var vSumEarn = Number(summary.getRange('E5').getValue());
  var hdr = summary.getRange('B35:N35').getValues()[0].map(String).join('|');
  var matrix = summary.getRange('B36:N49').getValues();
  var eMatrix = summary.getRange('B54:N67').getValues();
  var q = summary.getRange('U3:U26').getValues();
  var rVals = summary.getRange('V3:V26').getValues().map(function (r) { return r[0]; }).filter(function (v) { return v !== '' && v !== null; });
  var chartCount = summary.getCharts().length;
  var dayRolled = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd') !== todayKey;
  var monthRolled = Utilities.formatDate(new Date(), tz, 'yyyy-MM') !== monthKey;

  // --- Day-window reconciliation (TODAY()-based formulas) ---
  if (dayRolled) {
    S.warn('midnight rolled over mid-section — day-window checks skipped this run', false, 'rerun the suite for Today/Week reconciliation');
  } else {
    S.near('Today == raw log', vToday, js.today, 0.02);
    S.near('This week == raw log (Monday-anchored)', vWeek, js.week, 0.02);
    S.near('sidebar footer todayHours == dashboard', snap.todayHours, js.today, 0.02);
  }

  // --- Month-window reconciliation ---
  if (monthRolled) {
    S.warn('month rolled over mid-section — month-window checks skipped this run', false, 'rerun the suite');
  } else {
    S.near('This month == raw log', vMonth, js.month, 0.02);
    S.near('Earned this month == raw log (fees included)', vEarn, js.monthEarn, 0.02);
    S.near('sidebar footer monthHours == dashboard', snap.monthHours, js.month, 0.02);
    var petRow = byClient.filter(function (r) { return String(r[0]) === 'Pet Centre'; })[0];
    S.t('by-client card lists Pet Centre', !!petRow, true);
    if (petRow) S.near('by-client card: Pet Centre hours', Number(petRow[1]), js.petMonth, 0.02);
    S.near('Summary total hours == raw log window (F2 selector)', vSumHours, js.winH, 0.05);
    S.near('Summary total earnings == raw log window (F2 selector)', vSumEarn, js.winE, 0.05);
    S.t('hours matrix headers carry the clients', hdr.indexOf('Pet Centre') >= 0 && hdr.indexOf("Paws 'n' Claws") >= 0, true);
    var monthRow = matrix.filter(function (r) { return r[0] instanceof Date && ymOf(r[0]) === curYm; })[0];
    S.t('hours matrix has a row for this month', !!monthRow, true);
    if (monthRow) {
      var rowSum = monthRow.slice(1).reduce(function (a, v) { return a + (Number(v) || 0); }, 0);
      S.near('hours matrix row sums to this month\'s total', rowSum, js.month, 0.05);
    }
    var eRow = eMatrix.filter(function (r) { return r[0] instanceof Date && ymOf(r[0]) === curYm; })[0];
    S.t('earnings matrix has a row for this month', !!eRow, true);
    if (eRow) {
      var eSum = eRow.slice(1).reduce(function (a, v) { return a + (Number(v) || 0); }, 0);
      S.near('earnings matrix row sums to this month\'s €', eSum, js.monthEarn, 0.05);
    }
    var qSum = q.reduce(function (a, r) { return a + (Number(r[0]) || 0); }, 0);
    S.near('chart data: per-month € sums to the window total', qSum, js.winE, 0.05);
    S.t('cumulative column is populated', rVals.length > 0, true);
    if (rVals.length) S.near('cumulative line ends at the grand total', Number(rVals[rVals.length - 1]), js.winE, 0.05);
  }

  // --- Window-independent shape checks ---
  var mono = true;
  for (var i = 1; i < rVals.length; i++) {
    if (Number(rVals[i]) < Number(rVals[i - 1]) - 0.001) mono = false;
  }
  S.t('cumulative line never goes down', mono, true);
  S.t('summary still carries its 2 charts', chartCount, 2);

  // Client-filter guard: unticking a client whose name has an apostrophe
  // ("Paws 'n' Claws") must NOT error the not-matches QUERY and blank the whole
  // summary (it did with a single-quoted GViz literal; double-quoted, it holds).
  // Exercises the exclusion path the default-all-ticked checks never touch.
  var cliNames = summary.getRange('G22:G32').getValues().map(function (r) { return String(r[0]); });
  var apoRow = -1;
  for (var ai = 0; ai < cliNames.length; ai++) { if (cliNames[ai].indexOf("'") >= 0) { apoRow = ai; break; } }
  if (apoRow >= 0) {
    var box = summary.getRange(22 + apoRow, 6); // F column checkbox for that client
    box.setValue(false);
    SpreadsheetApp.flush();
    S.t('untick apostrophe client: summary stays live (not error-blanked to 0)', Number(summary.getRange('E5').getValue()) > 0, true);
    box.setValue(true); // restore
    SpreadsheetApp.flush();
  } else {
    S.warn('no apostrophe client present to exercise the client-filter guard', false, 'seed one to cover H1');
  }
}
