// state.js — LOG-AS-TRUTH: a running session IS a Time Log row with a Start
// (D) set and End (E) blank. There is no scalar state blob to corrupt or lose;
// the rows survive any crash by construction, and the client's imported view
// shows the same in-progress rows the owner sees. This file reads that truth
// (getRunningSessions_) and paints the on-sheet surfaces (banner + the mobile
// RUNNING NOW block). LockService still serializes every mutation.
//
// Crash-safety contract: the ONLY authoritative record of a running session is
// its Time Log row. The banner and the RUNNING NOW block are display mirrors
// repainted from that truth; they may lag without ever losing a session.

/**
 * Execution context threaded through every state/timer/report function.
 * Production: active spreadsheet, no prefix, interactive.
 * Tests: throwaway spreadsheet, 'test:' property prefix, silent (no UI).
 * With log-as-truth the prefix no longer isolates timer state (each throwaway
 * spreadsheet's own Time Log does) — it survives only to scope the legacy
 * migration property key.
 */
function makeCtx_(opts) {
  opts = opts || {};
  return {
    ss: opts.ss || SpreadsheetApp.getActive(),
    prefix: opts.prefix || '',
    silent: !!opts.silent,
  };
}

function stateKey_(ctx) {
  return ctx.prefix + CFG.props.state;
}

/**
 * Every currently-running session, oldest first: a Time Log row with Start set
 * and End blank. Returns [{startedAtMs, client, task, free, row}]. startedAtMs
 * is derived from the stored Start value, so it is the SAME identity every
 * consumer (sidebar card, mobile stop checkbox, findInProgressRow_) computes —
 * no separate id store to drift out of sync.
 */
function getRunningSessions_(ctx) {
  var sh = ctx.ss.getSheetByName(CFG.sheets.log);
  var last = sh.getLastRow();
  if (last < CFG.log.firstDataRow) return [];
  var c = CFG.log.cols;
  var n = last - CFG.log.firstDataRow + 1;
  var vals = sh.getRange(CFG.log.firstDataRow, 1, n, CFG.log.lastCol).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var v = vals[i];
    var start = v[c.start - 1];
    var end = v[c.end - 1];
    if (start instanceof Date && !(end instanceof Date)) {
      out.push({
        startedAtMs: start.getTime(),
        client: String(v[c.client - 1] || ''),
        task: String(v[c.task - 1] || ''),
        free: String(v[c.amount - 1]) === 'Free',
        row: CFG.log.firstDataRow + i,
      });
    }
  }
  out.sort(function (a, b) { return a.startedAtMs - b.startedAtMs; });
  return out;
}

/** Row number of the in-progress session with this startedAtMs, or -1. */
function findInProgressRow_(ctx, startedAtMs) {
  var running = getRunningSessions_(ctx);
  for (var i = 0; i < running.length; i++) {
    if (running[i].startedAtMs === startedAtMs) return running[i].row;
  }
  return -1;
}

/** Reads a named checkbox cell as a strict boolean. */
function boolNamed_(ctx, name) {
  var r = ctx.ss.getRangeByName(name);
  return !!(r && r.getValue() === true);
}

/**
 * Serializes every timer transition. Sidebar calls, menu items, and the
 * installable onEdit (mobile checkboxes) can genuinely race.
 */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/** Paints BOTH on-sheet surfaces from the live running set. Best-effort. */
function paintRunningSurfaces_(ctx) {
  refreshStatusBanner_(ctx);
  renderRunningNow_(ctx);
}

/**
 * Dashboard status banner: green "● N running" when any timer is live, else the
 * exact idle string the rebuild spec asserts. Best-effort (cosmetic).
 */
function refreshStatusBanner_(ctx) {
  try {
    var range = ctx.ss.getRangeByName(CFG.named.dbStatus);
    if (!range) return;
    var n = getRunningSessions_(ctx).length;
    if (n > 0) {
      range.setValue('● ' + n + ' timer' + (n === 1 ? '' : 's') + ' running')
        .setBackground(CFG.colors.green)
        .setFontColor(CFG.colors.white);
    } else {
      range.setValue('IDLE — ready to start')
        .setBackground(CFG.colors.grayFill)
        .setFontColor(CFG.colors.gray);
    }
  } catch (e) {
    // Banner is cosmetic.
  }
}

/**
 * Renders the mobile RUNNING NOW block: up to CFG.run.maxRows rows, each a STOP
 * checkbox (chkStopBlock) + a "client — task · since HH:mm" label + a hidden
 * startedAtMs (dbRunIds) the onEdit stop handler maps back to a session. Empty
 * rows are blanked (checkbox removed) so the block only shows live timers. An
 * overflow past the cap is noted on the banner. Best-effort.
 */
function renderRunningNow_(ctx) {
  try {
    var idRange = ctx.ss.getRangeByName(CFG.named.dbRunIds);
    var stopRange = ctx.ss.getRangeByName(CFG.named.chkStopBlock);
    if (!idRange || !stopRange) return;
    var sh = idRange.getSheet();
    var top = idRange.getRow();
    var idCol = idRange.getColumn();
    var stopCol = stopRange.getColumn();
    var labelCol = stopCol + 1; // C: merged label face C:F per row
    var cap = CFG.run.maxRows;
    var running = getRunningSessions_(ctx);
    var tz = ctx.ss.getSpreadsheetTimeZone();

    for (var i = 0; i < cap; i++) {
      var row = top + i;
      var box = sh.getRange(row, stopCol);
      var labelCell = sh.getRange(row, labelCol);
      var idCell = sh.getRange(row, idCol);
      if (i < running.length) {
        var r = running[i];
        var since = Utilities.formatDate(new Date(r.startedAtMs), tz, 'HH:mm');
        box.insertCheckboxes();
        box.setValue(false);
        labelCell
          .setValue(r.client + (r.task ? ' — ' + r.task : '') + '   · since ' + since + (r.free ? '   · FREE' : ''))
          .setFontColor(r.free ? CFG.colors.green : CFG.colors.navy);
        idCell.setValue(r.startedAtMs);
      } else {
        box.clearDataValidations();
        box.clearContent();
        labelCell.setValue('');
        idCell.clearContent();
      }
    }

    var extra = running.length - cap;
    if (extra > 0) {
      var banner = ctx.ss.getRangeByName(CFG.named.dbStatus);
      if (banner) banner.setValue(String(banner.getValue()) + '  (+' + extra + ' more — open the panel)');
    }
  } catch (e) {
    // RUNNING NOW block is a display mirror.
  }
}

/**
 * One-time bridge off the old single-timer model: if the legacy `timerState`
 * property still holds a RUNNING blob and no in-progress row matches it, seed
 * one row so the crashed session isn't lost; then delete the property forever.
 * A corrupt blob is simply deleted. Safe to call repeatedly (no-op once gone).
 */
function migrateLegacyTimerState_(ctx) {
  var key = stateKey_(ctx);
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(key);
    if (!raw) return;
    var s = JSON.parse(raw);
    if (s && s.status === 'RUNNING' && typeof s.startedAtMs === 'number' && s.startedAtMs > 0) {
      if (findInProgressRow_(ctx, s.startedAtMs) < 0) {
        appendInProgressRow_(ctx, s.startedAtMs, String(s.client || ''), String(s.task || ''), false);
      }
    }
  } catch (e) {
    // Unparseable blob → nothing to recover; fall through to the delete.
  }
  try {
    PropertiesService.getScriptProperties().deleteProperty(key);
  } catch (e2) {
    // Best-effort cleanup.
  }
}

function getNamedValue_(ctx, name) {
  var r = ctx.ss.getRangeByName(name);
  return r ? r.getValue() : '';
}

function setNamedValue_(ctx, name, value) {
  var r = ctx.ss.getRangeByName(name);
  if (r) r.setValue(value);
}

/** Non-blocking user feedback (toast); suppressed in silent/test contexts. */
function notify_(ctx, message) {
  if (ctx.silent) return;
  try {
    ctx.ss.toast(message, '⏱ Hours Tracker', 6);
  } catch (e) {
    // Toast can fail in trigger contexts without UI — never fatal.
  }
}
