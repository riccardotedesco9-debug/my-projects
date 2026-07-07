// test-log-and-entries.js — appendLogRow_ math and formats under every input
// shape (zero-duration, multi-day, unicode, formula-injection attempts,
// apostrophe clients, duplicate clients, live rate back-fill), log-surgery
// integrity (gaps, deletes, grid edge), and the two dialog entry points
// (manual past sessions + fixed project fees) with their full refusal matrix.

function sectionLogMath_(S, env) {
  var ctx = env.ctx;
  var log = env.logSh;
  var c = env.c;
  // Fixed mid-month datetimes throughout: exact-hours assertions must never
  // ride on Date.now() — a run inside the window after a DST shift (or one
  // crossing midnight into a new month) would false-fail wall-clock math.
  var at = function (day, h, min) { return new Date(env.y, env.m - 1, day, h, min, 0).getTime(); };

  // Splash Store's deterministic anchor (day 3) — the drafts/reconcile
  // sections rely on Splash having a session inside env.m regardless of when
  // the suite runs.
  appendLogRow_(ctx, at(3, 10, 0), at(3, 11, 0), 'Splash Store', 'Splash anchor');

  // --- Deterministic math row (1st of this month, 09:00→17:30) ---
  appendLogRow_(ctx, at(1, 9, 0), at(1, 17, 30), 'Pet Centre', 'Deterministic row');
  var r = log.getLastRow();
  S.t('8.5h row: hours 8.50', Number(log.getRange(r, c.hours).getValue()), 8.5);
  S.t('8.5h row: amount 382.50', Number(log.getRange(r, c.amount).getValue()), 382.5);

  // --- Duration edges ---
  appendLogRow_(ctx, at(2, 12, 0), at(2, 12, 0), 'Pet Centre', 'Zero duration');
  r = log.getLastRow();
  S.t('zero-duration session: 0.00 h (exact-minute billing)', Number(log.getRange(r, c.hours).getValue()), 0);
  S.t('zero-duration session: €0.00', Number(log.getRange(r, c.amount).getValue()), 0);
  appendLogRow_(ctx, at(10, 6, 0), at(11, 12, 0), 'Pet Centre', 'Left running 30h');
  S.t('30h multi-day session computes', Number(log.getRange(log.getLastRow(), c.hours).getValue()), 30);

  // --- Formula injection: free-typed text must never become a live formula ---
  appendLogRow_(ctx, at(4, 9, 0), at(4, 9, 30), 'Pet Centre', '=SUM(1,2)');
  r = log.getLastRow();
  S.t('task "=SUM(1,2)" stored as literal text', String(log.getRange(r, c.task).getValue()), '=SUM(1,2)');
  S.t('…and is NOT a formula', log.getRange(r, c.task).getFormula(), '');
  appendLogRow_(ctx, at(4, 10, 0), at(4, 10, 30), 'Pet Centre', '+lead follow-up');
  S.t('task "+lead follow-up" stored as literal text', String(log.getRange(log.getLastRow(), c.task).getValue()), '+lead follow-up');

  // --- Unicode + apostrophe client through the live rate formula ---
  var uni = 'Tħaffir tal-bejt — café ☕ "quoted"';
  appendLogRow_(ctx, at(4, 11, 0), at(4, 11, 30), 'Pet Centre', uni);
  S.t('unicode task round-trips exactly', String(log.getRange(log.getLastRow(), c.task).getValue()), uni);
  appendLogRow_(ctx, at(4, 14, 0), at(4, 15, 0), "Paws 'n' Claws", 'Apostrophe client');
  r = log.getLastRow();
  S.t("apostrophe client resolves rate 30", Number(log.getRange(r, c.rate).getValue()), 30);
  S.t("apostrophe client amount = 1h × 30", Number(log.getRange(r, c.amount).getValue()), 30);

  // --- Duplicate client name: first row wins, deterministically ---
  var dupRow = env.clientsSh.getLastRow() + 1;
  env.clientsSh.getRange(dupRow, 1, 1, 2).setValues([['Pet Centre', 99]]);
  appendLogRow_(ctx, at(5, 9, 0), at(5, 10, 0), 'Pet Centre', 'Dup-rate probe');
  S.t('duplicate client: rate lookup takes the FIRST row (45, not 99)', Number(log.getRange(log.getLastRow(), c.rate).getValue()), 45);
  env.clientsSh.getRange(dupRow, 1, 1, 3).clearContent();

  // --- Live rate back-fill: adding a rate re-prices existing rows ---
  env.clientsSh.getRange(3, CFG.clients.cols.rate).setValue(20); // Splash Store had none
  SpreadsheetApp.flush();
  S.t('adding a rate back-fills old rows (the noRate promise)', Number(log.getRange(3, c.rate).getValue()), 20);

  // --- Delete + append integrity (append never overwrites) ---
  var beforeLast = log.getLastRow();
  var gapRow = beforeLast - 1;
  var keepBelow = String(log.getRange(beforeLast, c.client).getValue());
  log.getRange(gapRow, 1, 1, CFG.log.lastCol).clearContent();
  appendLogRow_(ctx, at(6, 9, 0), at(6, 10, 0), 'Pet Centre', 'After-gap task');
  S.t('append lands at the end, not in the gap', String(log.getRange(beforeLast + 1, c.task).getValue()), 'After-gap task');
  S.t('row below the gap intact', String(log.getRange(beforeLast, c.client).getValue()), keepBelow);
  S.t('cleared gap stays blank', String(log.getRange(gapRow, c.client).getValue()), '');
  var afterAppendLast = log.getLastRow();
  log.deleteRows(gapRow, 1);
  S.t('native delete drops the row count by one', log.getLastRow(), afterAppendLast - 1);
  appendLogRow_(ctx, at(6, 11, 0), at(6, 11, 30), 'Pet Centre', 'After-delete task');
  S.t('append after delete still lands last', String(log.getRange(log.getLastRow(), c.task).getValue()), 'After-delete task');

  // --- Grid edge: appending at the very last grid row must grow the sheet ---
  var last = log.getLastRow();
  if (log.getMaxRows() > last) log.deleteRows(last + 1, log.getMaxRows() - last);
  var maxBefore = log.getMaxRows();
  appendLogRow_(ctx, at(7, 9, 0), at(7, 9, 1), 'Pet Centre', 'Grid-edge row');
  S.t('grid auto-grows at the edge', log.getMaxRows() > maxBefore, true);
  S.t('grid-edge row lands intact', String(log.getRange(log.getLastRow(), c.task).getValue()), 'Grid-edge row');
  S.t('grid-edge row got its formulas', log.getRange(log.getLastRow(), c.hours).getFormula() !== '', true);
  S.t('grid-edge row computes its exact minute (0.02h)', Number(log.getRange(log.getLastRow(), c.hours).getValue()), 0.02);
}

function sectionManualEntries_(S, env) {
  var ctx = env.ctx;
  var log = env.logSh;
  var c = env.c;
  var pad = function (n) { return n < 10 ? '0' + n : String(n); };
  var iso = function (y, m, d) { return y + '-' + pad(m) + '-' + pad(d); };
  var dayFmt = function (d) { return Utilities.formatDate(d, env.tz, 'yyyy-MM-dd'); };

  // --- Manual past session, crossing midnight ---
  var man = addManualSessionCtx_(ctx, {
    client: 'Pet Centre', task: 'Manual catch-up',
    dateIso: iso(env.y, env.m, 1), startHm: '22:00', endHm: '01:30', nextDay: true,
  });
  S.t('manual session ok', man.ok, true);
  S.t('returns 3.50 h', man.hours, 3.5);
  var r = log.getLastRow();
  S.t('hours formula 3.50', Number(log.getRange(r, c.hours).getValue()), 3.5);
  S.t('rate lookup 45', Number(log.getRange(r, c.rate).getValue()), 45);
  S.t('crosses midnight (red-date rule input)', dayFmt(log.getRange(r, c.end).getValue()) > dayFmt(log.getRange(r, c.start).getValue()), true);

  // --- Refusal matrix: nothing malformed may reach the log ---
  var rows = log.getLastRow();
  var refuse = function (name, payload) {
    var res = addManualSessionCtx_(ctx, payload);
    S.t('refused: ' + name, res.ok, false);
  };
  refuse('end before start', { client: 'Pet Centre', task: 'x', dateIso: iso(env.y, 1, 1), startHm: '10:00', endHm: '09:00', nextDay: false });
  refuse('end equals start', { client: 'Pet Centre', task: 'x', dateIso: iso(env.y, 1, 1), startHm: '10:00', endHm: '10:00', nextDay: false });
  refuse('month 13', { client: 'Pet Centre', task: 'x', dateIso: env.y + '-13-01', startHm: '09:00', endHm: '10:00', nextDay: false });
  refuse('Feb 31 (rollover)', { client: 'Pet Centre', task: 'x', dateIso: env.y + '-02-31', startHm: '09:00', endHm: '10:00', nextDay: false });
  refuse('25:00 start', { client: 'Pet Centre', task: 'x', dateIso: iso(env.y, 1, 1), startHm: '25:00', endHm: '10:00', nextDay: true });
  refuse('9:5 shape', { client: 'Pet Centre', task: 'x', dateIso: iso(env.y, 1, 1), startHm: '9:5', endHm: '10:00', nextDay: false });
  refuse('unknown client', { client: 'Nobody Ltd', task: 'x', dateIso: iso(env.y, 1, 1), startHm: '09:00', endHm: '10:00', nextDay: false });
  refuse('empty client', { client: '', task: 'x', dateIso: iso(env.y, 1, 1), startHm: '09:00', endHm: '10:00', nextDay: false });
  refuse('missing date', { client: 'Pet Centre', task: 'x', dateIso: '', startHm: '09:00', endHm: '10:00', nextDay: false });
  S.t('nothing malformed reached the log', log.getLastRow(), rows);
  var empty = addManualSessionCtx_(ctx, { client: 'Pet Centre', task: '', dateIso: iso(env.y, env.m, 2), startHm: '09:00', endHm: '10:00', nextDay: false });
  S.t('empty task is allowed (labelled Untitled work later)', empty.ok === true && empty.hours === 1, true);

  // --- DST fold: the sheet bills wall-clock, and stays self-consistent ---
  var dstDay = new Date(env.y, 2, 31);
  while (dstDay.getDay() !== 0) dstDay.setDate(dstDay.getDate() - 1); // last Sunday of March
  var dst = addManualSessionCtx_(ctx, {
    client: 'Pet Centre', task: 'DST spring-forward',
    dateIso: iso(env.y, 3, dstDay.getDate()), startHm: '01:30', endHm: '03:30', nextDay: false,
  });
  S.t('DST-spanning session accepted', dst.ok, true);
  r = log.getLastRow();
  var sheetHours = Number(log.getRange(r, c.hours).getValue());
  var wall = Math.round((wallClockMinutes_(env.tz, log.getRange(r, c.start).getValue(), log.getRange(r, c.end).getValue()) / 60) * 100) / 100;
  S.t('DST row: sheet hours == wall-clock hours (billing consistency)', sheetHours, wall);
  // Independent constant: 01:30→03:30 is ALWAYS 2.00 wall-clock hours in
  // Malta, so a storage bug can't hide behind the mirror above.
  S.t('DST row bills exactly 2.00 (the timesheet is wall-clock)', sheetHours, 2);
  if (dst.hours !== sheetHours) S.info('DST divergence (known)', 'dialog reported ' + dst.hours + ' h elapsed; sheet bills ' + sheetHours + ' h wall-clock');

  // --- Fixed-price project fee ---
  var feeBase = log.getLastRow();
  var fee = addProjectFeeCtx_(ctx, { client: 'Pet Centre', description: 'Logo design', dateIso: iso(env.y, env.m, 15), amount: 250 });
  S.t('project fee ok', fee.ok, true);
  S.t('one row appended', log.getLastRow(), feeBase + 1);
  var feeRow = log.getLastRow();
  S.t('fee amount stored as a value', Number(log.getRange(feeRow, c.amount).getValue()), 250);
  S.t('fee has no hours', String(log.getRange(feeRow, c.hours).getValue()), '');
  S.t('fee has no start time', String(log.getRange(feeRow, c.start).getValue()), '');
  S.t('fee is inert to the timer', getTimerState_(ctx).status, 'IDLE');

  // --- Fee refusal matrix + cent rounding ---
  rows = log.getLastRow();
  var refuseFee = function (name, payload) {
    S.t('fee refused: ' + name, addProjectFeeCtx_(ctx, payload).ok, false);
  };
  refuseFee('zero amount', { client: 'Pet Centre', description: 'x', dateIso: iso(env.y, 1, 1), amount: 0 });
  refuseFee('negative amount', { client: 'Pet Centre', description: 'x', dateIso: iso(env.y, 1, 1), amount: -3 });
  refuseFee('non-numeric amount', { client: 'Pet Centre', description: 'x', dateIso: iso(env.y, 1, 1), amount: 'abc' });
  refuseFee('missing description', { client: 'Pet Centre', description: '', dateIso: iso(env.y, 1, 1), amount: 100 });
  refuseFee('impossible date', { client: 'Pet Centre', description: 'x', dateIso: env.y + '-02-30', amount: 100 });
  refuseFee('unknown client', { client: 'Nobody Ltd', description: 'x', dateIso: iso(env.y, 1, 1), amount: 100 });
  S.t('no refused fee reached the log', log.getLastRow(), rows);
  // Fee in an otherwise-empty far month → the fixed-only report case later.
  var rounded = addProjectFeeCtx_(ctx, { client: "Paws 'n' Claws", description: 'Site retainer', dateIso: (env.y + 1) + '-02-10', amount: 99.999 });
  S.t('fee rounds to cents (99.999 → 100)', rounded.amount, 100);
  S.t('rounded fee cell value 100', Number(log.getRange(log.getLastRow(), c.amount).getValue()), 100);
}
