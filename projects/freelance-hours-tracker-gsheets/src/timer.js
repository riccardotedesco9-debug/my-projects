// timer.js — Start / Stop / in-progress + fixed-fee log rows (LOG-AS-TRUTH).
//  - MANY concurrent clocks: each running session is a Time Log row with Start
//    set and End blank, identified by Start.getTime(). Starting never replaces
//    a running clock; overlapping time bills each task independently.
//  - Exact-minute billing, no rounding beyond 2-decimal hours.
//  - Full datetimes in Start/End so midnight-crossing sessions compute.
//  - A session can be logged "Free" (no charge) — the Amount cell holds "Free".

// ---------- Public API (sidebar / dialogs pass explicit args) ----------

/**
 * Opens a NEW clock (concurrent — never replaces a running one). Returns a
 * plain object safe for google.script.run: {ok, msg?, needsRateConfirm?,
 * startedAtMs?, snapshot?}. opts.free=true logs it as a no-charge session.
 */
function startWork(client, task, opts) {
  return startWorkCtx_(makeCtx_(), client, task, opts || {});
}

/** Stops + logs ONE running session by its startedAtMs. Idempotent. */
function stopSession(startedAtMs) {
  return stopSessionCtx_(makeCtx_(), Number(startedAtMs));
}

/** Stops + logs every running session at one shared end instant. */
function stopAll() {
  return stopAllCtx_(makeCtx_());
}

/** Snapshot for the sidebar/dialogs. Epoch millis only — never Date objects. */
function getTimerSnapshot() {
  return buildSnapshot_(makeCtx_());
}

/**
 * Builds the sidebar/dialog model straight from the live running set. start/stop
 * return this inline so the sidebar renders from one round-trip. `running` is
 * every live clock (oldest first); each carries its own startedAtMs so the panel
 * ticks and stops them independently.
 */
function buildSnapshot_(ctx) {
  var running = getRunningSessions_(ctx).map(function (r) {
    return { startedAtMs: r.startedAtMs, client: r.client, task: r.task, free: r.free };
  });
  return {
    running: running,
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
  var opts = { free: boolNamed_(ctx, CFG.named.dbFree) };
  var res = startWorkCtx_(ctx, client, task, opts);
  if (res.needsRateConfirm) {
    var ra = ui.alert('No rate set', res.msg + '\n\nStart anyway?', ui.ButtonSet.YES_NO);
    if (ra !== ui.Button.YES) return;
    opts.confirmNoRate = true;
    res = startWorkCtx_(ctx, client, task, opts);
  }
  notify_(ctx, res.ok
    ? 'Timing ' + client + (task ? ' — ' + task : '') + (opts.free ? ' (free)' : '')
    : res.msg);
}

function stopAllFromSheet() {
  var ctx = makeCtx_();
  var res = stopAllCtx_(ctx);
  notify_(ctx, res.ok ? res.msg : MSG.noneRunning);
}

// ---------- Core (ctx-aware so tests drive the identical code) ----------

/**
 * Opens a NEW concurrent clock: appends an in-progress Time Log row (Start set,
 * End blank). Never touches other running sessions. A same-client+task duplicate
 * is a no-op so a double-tap can't open two identical clocks. startedAtMs is
 * unique among the running set (a same-ms collision bumps +1ms).
 */
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
    var running = getRunningSessions_(ctx);
    var used = {};
    for (var i = 0; i < running.length; i++) {
      if (running[i].client === client && running[i].task === task) {
        return { ok: true, msg: MSG.alreadyRunning, startedAtMs: running[i].startedAtMs, snapshot: buildSnapshot_(ctx) };
      }
      used[running[i].startedAtMs] = true;
    }
    var startMs = Date.now();
    while (used[startMs]) startMs++; // unique identity among the live clocks
    appendInProgressRow_(ctx, startMs, client, task, !!opts.free);
    paintRunningSurfaces_(ctx);
    SpreadsheetApp.flush(); // so the dashboard/snapshot reflect the new row
    var snapshot = buildSnapshot_(ctx);
    // Return the CANONICAL (stored, read-back) id: a sheet datetime can round-
    // trip ±1ms, so every consumer must key stop/discard off the stored value,
    // never the pre-write startMs. The duplicate guard makes client+task unique.
    var mine = snapshot.running.filter(function (x) { return x.client === client && x.task === task; })[0];
    return { ok: true, startedAtMs: mine ? mine.startedAtMs : startMs, snapshot: snapshot };
  });
}

/** Stops + logs ONE running session by id. Missing id → idempotent no-op. */
function stopSessionCtx_(ctx, startedAtMs) {
  return withLock_(function () {
    var row = findInProgressRow_(ctx, startedAtMs);
    if (row < 0) return { ok: false, msg: MSG.noneRunning, snapshot: buildSnapshot_(ctx) };
    var sh = ctx.ss.getSheetByName(CFG.sheets.log);
    var client = String(sh.getRange(row, CFG.log.cols.client).getValue() || '');
    var endMs = Date.now();
    completeSessionRow_(ctx, row, endMs);
    paintRunningSurfaces_(ctx);
    SpreadsheetApp.flush();
    var hours = Math.max(0, (endMs - startedAtMs) / 3600000);
    return { ok: true, msg: MSG.logged(hours, client), loggedHours: hours, client: client, snapshot: buildSnapshot_(ctx) };
  });
}

/** Stops + logs every running session at one shared end instant. */
function stopAllCtx_(ctx) {
  return withLock_(function () {
    var running = getRunningSessions_(ctx);
    if (running.length === 0) return { ok: false, msg: MSG.noneRunning, snapshot: buildSnapshot_(ctx) };
    var endMs = Date.now();
    running.forEach(function (r) { completeSessionRow_(ctx, r.row, endMs); });
    paintRunningSurfaces_(ctx);
    SpreadsheetApp.flush();
    return { ok: true, msg: MSG.stoppedAll(running.length), count: running.length, snapshot: buildSnapshot_(ctx) };
  });
}

/** Discards one running session (deletes its row) without logging. */
function discardSessionCtx_(ctx, startedAtMs) {
  return withLock_(function () {
    var row = findInProgressRow_(ctx, startedAtMs);
    if (row < 0) return { ok: false, msg: MSG.noneRunning, snapshot: buildSnapshot_(ctx) };
    ctx.ss.getSheetByName(CFG.sheets.log).deleteRow(row);
    paintRunningSurfaces_(ctx);
    SpreadsheetApp.flush();
    return { ok: true, snapshot: buildSnapshot_(ctx) };
  });
}

/** Discards ALL running sessions (bottom-up so row indices stay valid). */
function discardAllCtx_(ctx) {
  return withLock_(function () {
    var running = getRunningSessions_(ctx);
    running.sort(function (a, b) { return b.row - a.row; });
    var sh = ctx.ss.getSheetByName(CFG.sheets.log);
    running.forEach(function (r) { sh.deleteRow(r.row); });
    paintRunningSurfaces_(ctx);
    SpreadsheetApp.flush();
    return { ok: true, count: running.length };
  });
}

/**
 * Appends an in-progress row: Client, Task, Start (hh:mm), Date (=INT(Start))
 * and the per-row Status formula; End/Hours/Rate blank; Amount blank, or the
 * literal "Free" when free-at-start. The amount formula is deliberately withheld
 * until stop — writing =ROUND(hours*rate) while Hours is blank would poison the
 * money aggregates with #VALUE!.
 */
function appendInProgressRow_(ctx, startMs, client, task, free) {
  var sh = ctx.ss.getSheetByName(CFG.sheets.log);
  var c = CFG.log.cols;
  var r = Math.max(sh.getLastRow() + 1, CFG.log.firstDataRow);
  if (r > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 50);
  sh.getRange(r, c.client, 1, 2).setValues([[literal_(client), literal_(task)]]);
  sh.getRange(r, c.start).setValue(new Date(startMs)).setNumberFormat(CFG.formats.time);
  sh.getRange(r, c.date).setFormula('=INT(' + colLetter_(c.start) + r + ')').setNumberFormat(CFG.formats.date);
  if (free) sh.getRange(r, c.amount).setValue('Free');
  writeStatusFormula_(sh, r);
  return r;
}

/**
 * Completes a running row at endMs: writes End, then the hourly formulas. A row
 * flagged "Free" keeps that flag (writeHourlyFormulas_ skips its amount).
 */
function completeSessionRow_(ctx, row, endMs) {
  var sh = ctx.ss.getSheetByName(CFG.sheets.log);
  sh.getRange(row, CFG.log.cols.end).setValue(new Date(endMs)).setNumberFormat(CFG.formats.time);
  writeHourlyFormulas_(sh, row);
  return row;
}

/**
 * Appends one COMPLETED session row (manual "add past session" + demo seed).
 * Full datetimes first, re-assert the hh:mm format (a datetime write can
 * override a time-only format), then the shared hourly formulas.
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
  writeHourlyFormulas_(sh, r);
  writeStatusFormula_(sh, r);
  return r;
}

/**
 * Writes the Date/Hours/Rate/Amount formulas for one hourly row — shared by the
 * manual/demo append and the on-stop completion. Amount is left untouched when
 * the row is flagged "Free" (Amount === "Free") so a free session shows "Free".
 * Date reads Start, so full datetimes must already be in place. Status (col G)
 * has its own per-row formula (writeStatusFormula_) and is never written here.
 */
function writeHourlyFormulas_(sh, r) {
  var c = CFG.log.cols;
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
  var amtCell = sh.getRange(r, c.amount);
  if (String(amtCell.getValue()) !== 'Free') {
    amtCell.setFormula('=ROUND(' + A(c.hours) + '*' + A(c.rate) + ', 2)').setNumberFormat(CFG.formats.euro);
  }
}

/**
 * Writes the per-row Status formula (col G): "In progress" while Start is set
 * and End blank, "Free" when Amount is the literal "Free", else blank. Written
 * once per row and auto-updates as End/Amount change; it moves with its row on a
 * sort (like the other per-row formulas). Client-safe — carries no money, and is
 * the only Status write (the column is never a sheet-wide spill, which would
 * push the first append off row 2 and collide with per-row writes).
 */
function writeStatusFormula_(sh, r) {
  var c = CFG.log.cols;
  var L = colLetter_;
  sh.getRange(r, c.status)
    .setFormula('=IF(AND(' + L(c.start) + r + '<>"", ' + L(c.end) + r + '=""), "In progress", IF(' + L(c.amount) + r + '="Free", "Free", ""))')
    .setHorizontalAlignment('center');
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
  writeStatusFormula_(sh, r);
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
 * Multi-session recovery dialog callback. Per-card: 'log'/'stop' + id, or
 * 'discard' + id. Footer: 'stopAll', 'discardAll', 'keep' (no-op). A stale id
 * (already stopped elsewhere) is a safe no-op. Returns the fresh snapshot so
 * the dialog re-renders the remaining cards.
 */
function recoveryChoice(choice, startedAtMs) {
  recoveryChoiceCtx_(makeCtx_(), choice, startedAtMs != null ? Number(startedAtMs) : 0);
  return getTimerSnapshot();
}

function recoveryChoiceCtx_(ctx, choice, id) {
  if (choice === 'log' || choice === 'stop') return stopSessionCtx_(ctx, id);
  if (choice === 'discard') return discardSessionCtx_(ctx, id);
  if (choice === 'stopAll') return stopAllCtx_(ctx);
  if (choice === 'discardAll') return discardAllCtx_(ctx);
  return { ok: true }; // 'keep' — the rows are already the authoritative truth
}

// ---------- Mark a session free / paid after the fact (menu) ----------

function toggleSelectedFree() {
  var ctx = makeCtx_();
  var res = markSelectedFreeCtx_(ctx);
  notify_(ctx, res.msg);
}

/**
 * Toggles the selected Time Log row(s) between "Free" (no charge) and priced.
 * Free = the literal "Free" in the Amount cell (SUM/QUERY treat text as €0, so
 * it drops out of the money totals but its hours still count). Un-free restores
 * the amount formula on a completed row, or clears it on a still-running one.
 * Ignores the header + blank rows.
 */
function markSelectedFreeCtx_(ctx) {
  var sh = ctx.ss.getActiveSheet();
  if (sh.getName() !== CFG.sheets.log) return { ok: false, msg: MSG.selectLogRows };
  var rl = sh.getActiveRangeList();
  var ranges = rl ? rl.getRanges() : [sh.getActiveRange()];
  var c = CFG.log.cols;
  return withLock_(function () {
    var freed = 0;
    var paid = 0;
    ranges.forEach(function (rng) {
      var startRow = rng.getRow();
      for (var i = 0; i < rng.getNumRows(); i++) {
        var r = startRow + i;
        if (r < CFG.log.firstDataRow) continue;
        if (String(sh.getRange(r, c.client).getValue()).trim() === '') continue;
        var amtCell = sh.getRange(r, c.amount);
        if (String(amtCell.getValue()) === 'Free') {
          if (sh.getRange(r, c.end).getValue() instanceof Date) {
            amtCell.setFormula('=ROUND(' + colLetter_(c.hours) + r + '*' + colLetter_(c.rate) + r + ', 2)')
              .setNumberFormat(CFG.formats.euro);
          } else {
            amtCell.clearContent();
          }
          paid++;
        } else {
          amtCell.setValue('Free');
          freed++;
        }
        // Ensure the row carries a Status formula so "Free" surfaces to the
        // client even on an older row created before the Status column existed.
        writeStatusFormula_(sh, r);
      }
    });
    if (freed + paid === 0) return { ok: false, msg: MSG.selectLogRows };
    paintRunningSurfaces_(ctx);
    SpreadsheetApp.flush();
    return { ok: true, msg: 'Updated ' + (freed + paid) + ' row(s): ' + freed + ' free, ' + paid + ' paid.' };
  });
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
