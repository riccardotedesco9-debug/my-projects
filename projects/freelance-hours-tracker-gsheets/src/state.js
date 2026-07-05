// state.js — authoritative timer state (Script Properties JSON) + LockService
// guard + display mirrors (Settings cells, Dashboard banner).
//
// Crash-safety contract: the ONLY authoritative record of a running session is
// the Script Properties blob. Sheets cells and the sidebar are display mirrors;
// they may lag or fail without ever losing a session.

/**
 * Execution context threaded through every state/timer/report function.
 * Production: active spreadsheet, no prefix, interactive.
 * Tests: throwaway spreadsheet, 'test:' property prefix, silent (no UI).
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

function idleState_() {
  return { status: 'IDLE', startedAtMs: 0, client: '', task: '' };
}

/** Reads timer state; any corruption degrades safely to IDLE. */
function getTimerState_(ctx) {
  var raw = PropertiesService.getScriptProperties().getProperty(stateKey_(ctx));
  if (!raw) return idleState_();
  try {
    var s = JSON.parse(raw);
    if (s && s.status === 'RUNNING' && typeof s.startedAtMs === 'number' && s.startedAtMs > 0) {
      return { status: 'RUNNING', startedAtMs: s.startedAtMs, client: String(s.client || ''), task: String(s.task || '') };
    }
  } catch (e) {
    // fall through to IDLE
  }
  return idleState_();
}

function setTimerState_(ctx, state) {
  PropertiesService.getScriptProperties().setProperty(stateKey_(ctx), JSON.stringify(state));
  mirrorStateToSettings_(ctx, state);
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

/**
 * Best-effort write-through to the (hidden) Settings sheet — display only.
 * The four mirror cells are the contiguous block stStatus..stTask (C4:C7 in
 * build-sheets.js), so one setValues beats four setValue calls (latency).
 */
function mirrorStateToSettings_(ctx, state) {
  try {
    var top = ctx.ss.getRangeByName(CFG.named.stStatus);
    if (!top) return;
    var running = state.status === 'RUNNING';
    top.offset(0, 0, 4, 1).setValues([
      [state.status],
      [running ? new Date(state.startedAtMs) : ''],
      [state.client],
      [state.task],
    ]);
  } catch (e) {
    // Mirror failure must never block a timer transition.
  }
}

/** Paints the Dashboard status banner for the given state. Best-effort. */
function refreshStatusBanner_(ctx, state) {
  try {
    var range = ctx.ss.getRangeByName(CFG.named.dbStatus);
    if (!range) return;
    if (state.status === 'RUNNING') {
      var since = Utilities.formatDate(new Date(state.startedAtMs), ctx.ss.getSpreadsheetTimeZone(), 'HH:mm');
      range.setValue('● RUNNING — ' + state.client + ' since ' + since)
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
