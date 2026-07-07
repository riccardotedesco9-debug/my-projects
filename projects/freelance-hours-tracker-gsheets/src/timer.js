// timer.js — Start / Stop / zero-gap switch / log-row append.
// Semantics mirror the Excel reference (modTimer.bas) exactly:
//  - ONE active timer ever; starting while running offers a zero-gap switch
//    where old-end == new-start to the captured millisecond.
//  - Exact-minute billing, no rounding beyond 2-decimal hours.
//  - Full datetimes in Start/End so midnight-crossing sessions compute.

// ---------- Public API (sidebar / dialogs pass explicit args) ----------

/**
 * Starts (or offers to switch) the timer. Returns a plain object safe for
 * google.script.run: {ok, msg?, state?, needsConfirm?, current?}.
 * opts.confirmSwitch=true executes the zero-gap switch without asking again.
 */
function startWork(client, task, opts) {
  return startWorkCtx_(makeCtx_(), client, task, opts || {});
}

function stopAndLog() {
  return stopAndLogCtx_(makeCtx_());
}

/** Snapshot for the sidebar/dialogs. Epoch millis only — never Date objects. */
function getTimerSnapshot() {
  var ctx = makeCtx_();
  return buildSnapshot_(ctx, getTimerState_(ctx));
}

/**
 * Builds the sidebar model for a given state. start/stop return this inline so
 * the sidebar renders from one round-trip instead of a second refresh() call.
 */
function buildSnapshot_(ctx, state) {
  return {
    status: state.status,
    client: state.client,
    task: state.task,
    startedAtMs: state.startedAtMs,
    serverNowMs: Date.now(),
    clients: getClientNames_(ctx),
    dbClient: String(getNamedValue_(ctx, CFG.named.dbClient) || '').trim(),
    dbTask: String(getNamedValue_(ctx, CFG.named.dbTask) || '').trim(),
    // Read from the Dashboard's live formula cells — no recomputation here.
    todayHours: Number(getNamedValue_(ctx, CFG.named.dbToday)) || 0,
    monthHours: Number(getNamedValue_(ctx, CFG.named.dbMonth)) || 0,
  };
}

/**
 * Logs a forgotten session through the same appendLogRow_ path (so it gets
 * the formulas manually typed rows would lack). No timer-state change.
 * payload: {client, task, dateIso 'yyyy-mm-dd', startHm 'HH:mm', endHm, nextDay}.
 */
function addManualSession(payload) {
  return addManualSessionCtx_(makeCtx_(), payload || {});
}

function addManualSessionCtx_(ctx, p) {
  var client = String(p.client || '').trim();
  var task = String(p.task || '').trim();
  if (!client) return { ok: false, msg: MSG.pickClient };
  if (!clientExists_(ctx, client)) return { ok: false, msg: MSG.unknownClient(client) };
  var d = parseDateIso_(p.dateIso);
  var s = /^(\d{1,2}):(\d{2})$/.exec(String(p.startHm || ''));
  var e = /^(\d{1,2}):(\d{2})$/.exec(String(p.endHm || ''));
  if (!d || !s || !e) return { ok: false, msg: 'Fill in the date, start and end times.' };
  if (+s[1] > 23 || +s[2] > 59 || +e[1] > 23 || +e[2] > 59) {
    return { ok: false, msg: 'Times must be real clock times (00:00–23:59).' };
  }
  // Built in the script timezone (Europe/Malta) — same clock the timer uses.
  var startMs = new Date(+d[1], +d[2] - 1, +d[3], +s[1], +s[2], 0).getTime();
  var endMs = new Date(+d[1], +d[2] - 1, +d[3] + (p.nextDay ? 1 : 0), +e[1], +e[2], 0).getTime();
  if (endMs <= startMs) {
    return { ok: false, msg: 'End must be after start — tick "ends next day" for overnight sessions.' };
  }
  return withLock_(function () {
    appendLogRow_(ctx, startMs, endMs, client, task);
    return { ok: true, hours: Math.round(((endMs - startMs) / 3600000) * 100) / 100 };
  });
}

// ---------- Sheet-driven entry points (menu items + dashboard buttons) ----------

function startWorkFromSheet() {
  var ctx = makeCtx_();
  var client = String(getNamedValue_(ctx, CFG.named.dbClient) || '').trim();
  var task = String(getNamedValue_(ctx, CFG.named.dbTask) || '').trim();
  var ui = SpreadsheetApp.getUi();
  var opts = {};
  var res = startWorkCtx_(ctx, client, task, opts);
  if (res.needsRateConfirm) {
    var ra = ui.alert('No rate set', res.msg + '\n\nStart anyway?', ui.ButtonSet.YES_NO);
    if (ra !== ui.Button.YES) return;
    opts.confirmNoRate = true;
    res = startWorkCtx_(ctx, client, task, opts);
  }
  if (res.needsConfirm) {
    var ans = ui.alert('Switch task?', MSG.switchPrompt(res.current.client, res.current.task), ui.ButtonSet.YES_NO);
    if (ans !== ui.Button.YES) return;
    opts.confirmSwitch = true;
    res = startWorkCtx_(ctx, client, task, opts);
  }
  notify_(ctx, res.ok ? 'Timing ' + client + (task ? ' — ' + task : '') : res.msg);
}

function stopAndLogFromSheet() {
  var ctx = makeCtx_();
  var res = stopAndLogCtx_(ctx);
  notify_(ctx, res.msg);
}

// ---------- Core (ctx-aware so tests drive the identical code) ----------

function startWorkCtx_(ctx, client, task, opts) {
  opts = opts || {};
  client = String(client || '').trim();
  task = String(task || '').trim();
  if (!client) return { ok: false, msg: MSG.pickClient };
  var info = getClientInfo_(ctx, client);
  if (!info.exists) return { ok: false, msg: MSG.unknownClient(client) };
  // Rate guard: don't silently log €0. The live Rate formula back-fills once a
  // rate is added, so confirming (or the mobile/silent paths) proceeds safely.
  if (!opts.confirmNoRate && !ctx.silent && !info.hasRate) {
    return { ok: false, needsRateConfirm: true, client: client, msg: MSG.noRate(client) };
  }

  return withLock_(function () {
    var state = getTimerState_(ctx);
    var nowMs = Date.now(); // captured ONCE — the zero-gap instant

    if (state.status === 'RUNNING') {
      if (state.client === client && state.task === task) {
        return { ok: true, msg: MSG.alreadyRunning, state: state, snapshot: buildSnapshot_(ctx, state) };
      }
      if (!opts.confirmSwitch && !ctx.silent) {
        return {
          ok: false,
          needsConfirm: true,
          current: { client: state.client, task: state.task, startedAtMs: state.startedAtMs },
        };
      }
      stopInternal_(ctx, state, nowMs); // old session ends at exactly nowMs
    }

    var next = { status: 'RUNNING', startedAtMs: nowMs, client: client, task: task };
    setTimerState_(ctx, next);
    refreshStatusBanner_(ctx, next);
    return { ok: true, state: next, snapshot: buildSnapshot_(ctx, next) };
  });
}

function stopAndLogCtx_(ctx) {
  return withLock_(function () {
    var state = getTimerState_(ctx);
    if (state.status !== 'RUNNING') return { ok: false, msg: MSG.notRunning };
    var endMs = Date.now();
    var hours = (endMs - state.startedAtMs) / 3600000;
    stopInternal_(ctx, state, endMs);
    refreshStatusBanner_(ctx, getTimerState_(ctx));
    SpreadsheetApp.flush(); // so the dashboard stat cells reflect the just-logged row
    return {
      ok: true,
      msg: MSG.logged(hours, state.client),
      loggedHours: hours,
      client: state.client,
      snapshot: buildSnapshot_(ctx, idleState_()),
    };
  });
}

/**
 * Logs the running session ending at endMs, then resets state to IDLE.
 * Callers own banner refresh, so a switch chains into the new start
 * without an intermediate IDLE flicker. Call only inside withLock_.
 */
function stopInternal_(ctx, state, endMs) {
  appendLogRow_(ctx, state.startedAtMs, endMs, state.client, state.task);
  setTimerState_(ctx, idleState_());
}

/** Discards the running session without logging (crash-recovery choice). */
function discardRunningSession_(ctx) {
  return withLock_(function () {
    setTimerState_(ctx, idleState_());
    refreshStatusBanner_(ctx, getTimerState_(ctx));
    return { ok: true };
  });
}

/**
 * Appends one session row. Order matters and is deliberate:
 * values first (full datetimes), re-assert the hh:mm format (a datetime write
 * can override a time-only format), then the formulas (Date reads Start).
 */
function appendLogRow_(ctx, startMs, endMs, client, task) {
  var sh = ctx.ss.getSheetByName(CFG.sheets.log);
  var c = CFG.log.cols;
  var r = Math.max(sh.getLastRow() + 1, CFG.log.firstDataRow);
  if (r > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 50); // never write past the grid

  sh.getRange(r, c.client, 1, 2).setValues([[literal_(client), literal_(task)]]);
  sh.getRange(r, c.start, 1, 2)
    .setValues([[new Date(startMs), new Date(endMs)]])
    .setNumberFormat(CFG.formats.time);

  var A = function (col) { return colLetter_(col) + r; };
  var clientsA = "'" + CFG.sheets.clients + "'!$A$2:$A";
  var clientsB = "'" + CFG.sheets.clients + "'!$B$2:$B";
  sh.getRange(r, c.date)
    .setFormula('=INT(' + A(c.start) + ')')
    .setNumberFormat(CFG.formats.date);
  sh.getRange(r, c.hours)
    .setFormula('=ROUND((' + A(c.end) + '-' + A(c.start) + ')*24, 2)')
    .setNumberFormat(CFG.formats.hours);
  // Live lookup → a Clients rate change re-prices old rows; overtype to pin.
  // N() coerces a blank rate to 0; IFERROR covers a deleted client.
  sh.getRange(r, c.rate)
    .setFormula('=IFERROR(N(INDEX(' + clientsB + ', MATCH(' + A(c.client) + ', ' + clientsA + ', 0))), 0)')
    .setNumberFormat(CFG.formats.euro);
  sh.getRange(r, c.amount)
    .setFormula('=ROUND(' + A(c.hours) + '*' + A(c.rate) + ', 2)')
    .setNumberFormat(CFG.formats.euro);
  return r;
}

/**
 * Logs a fixed-price project as one line: an agreed € amount, no hours/rate.
 * payload: {client, description, dateIso 'yyyy-mm-dd', amount}.
 */
function addProjectFee(payload) {
  return addProjectFeeCtx_(makeCtx_(), payload || {});
}

function addProjectFeeCtx_(ctx, p) {
  var client = String(p.client || '').trim();
  var desc = String(p.description || '').trim();
  if (!client) return { ok: false, msg: MSG.pickClient };
  if (!clientExists_(ctx, client)) return { ok: false, msg: MSG.unknownClient(client) };
  if (!desc) return { ok: false, msg: 'Describe the project.' };
  var d = parseDateIso_(p.dateIso);
  if (!d) return { ok: false, msg: 'Pick a date.' };
  var amount = Number(p.amount);
  if (!isFinite(amount) || amount <= 0) return { ok: false, msg: 'Enter the agreed amount (€).' };
  amount = Math.round(amount * 100) / 100;
  var dateMs = new Date(+d[1], +d[2] - 1, +d[3]).getTime();
  return withLock_(function () {
    appendFixedRow_(ctx, dateMs, client, desc, amount);
    return { ok: true, amount: amount };
  });
}

/**
 * Appends a fixed-fee project row: Date + Client + Task + a literal Amount,
 * with Start/End/Hours/Rate left blank (it isn't hourly). The report flags a
 * no-Start row as a fixed-fee project.
 */
function appendFixedRow_(ctx, dateMs, client, task, amount) {
  var sh = ctx.ss.getSheetByName(CFG.sheets.log);
  var c = CFG.log.cols;
  var r = Math.max(sh.getLastRow() + 1, CFG.log.firstDataRow);
  if (r > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 50);
  sh.getRange(r, c.date).setValue(new Date(dateMs)).setNumberFormat(CFG.formats.date);
  sh.getRange(r, c.client, 1, 2).setValues([[literal_(client), literal_(task)]]);
  sh.getRange(r, c.amount).setValue(amount).setNumberFormat(CFG.formats.euro);
  return r;
}

/**
 * setValues interprets a string starting with '=' as a live formula (documented
 * USER_ENTERED-style parsing) — a task named "=SUM meeting" would silently
 * become one. '+' is prefixed defensively for parity with UI typing. The
 * leading apostrophe is the text-input marker: the stored value carries no
 * apostrophe. Used on every write of free-typed text (log AND report).
 */
function literal_(s) {
  s = String(s);
  return /^[=+]/.test(s) ? "'" + s : s;
}

/**
 * Crash-recovery dialog callback: 'keep' | 'log' | 'discard'.
 * expectedStartMs guards 'discard' against acting on a DIFFERENT session than
 * the one the dialog displayed (e.g. a phone checkbox started a new one).
 */
function recoveryChoice(choice, expectedStartMs) {
  recoveryChoiceCtx_(makeCtx_(), choice, expectedStartMs);
  try {
    showSidebar();
  } catch (e) {
    // No UI context (e.g. mobile) — sidebar will appear on next desktop open.
  }
  return getTimerSnapshot();
}

function recoveryChoiceCtx_(ctx, choice, expectedStartMs) {
  if (choice === 'log') {
    var res = stopAndLogCtx_(ctx);
    notify_(ctx, res.msg);
    return res;
  }
  if (choice === 'discard') {
    var current = getTimerState_(ctx);
    if (expectedStartMs && current.startedAtMs !== expectedStartMs) {
      notify_(ctx, 'Not discarded — a different session is running now.');
      return { ok: false, msg: 'different session running' };
    }
    discardRunningSession_(ctx);
    notify_(ctx, 'Session discarded.');
    return { ok: true };
  }
  // 'keep': nothing to do — state is already RUNNING and authoritative.
  return { ok: true };
}

/**
 * Strict 'yyyy-mm-dd' parse: shape, real month/day ranges, AND a round-trip
 * check so rollover dates (2026-02-31 → Mar 3) are refused, not silently
 * shifted into a different month. Returns the regex match array or null.
 */
function parseDateIso_(dateIso) {
  var d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateIso || ''));
  if (!d) return null;
  if (+d[2] < 1 || +d[2] > 12 || +d[3] < 1 || +d[3] > 31) return null;
  var probe = new Date(+d[1], +d[2] - 1, +d[3]);
  if (probe.getMonth() !== +d[2] - 1 || probe.getDate() !== +d[3]) return null;
  return d;
}

function colLetter_(col) {
  var letter = '';
  while (col > 0) {
    var rem = (col - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    col = (col - rem - 1) / 26;
  }
  return letter;
}
