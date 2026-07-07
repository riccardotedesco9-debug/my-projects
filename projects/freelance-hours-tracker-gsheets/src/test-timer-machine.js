// test-timer-machine.js — the timer's whole state machine: guards, zero-gap
// switches, crash-safe persistence, corrupted-state resilience, the
// stop-before-reset ordering that makes a crash unable to lose a session,
// lock hygiene, recovery choices, and the phone-checkbox onEdit surface.

function sectionTimer_(S, env) {
  var ctx = env.ctx;
  var log = env.logSh;
  var c = env.c;
  var props = PropertiesService.getScriptProperties();
  var dayFmt = function (d) { return Utilities.formatDate(d, env.tz, 'yyyy-MM-dd'); };

  // --- Guards carry the exact UX copy ---
  S.t('initial status IDLE', getTimerState_(ctx).status, 'IDLE');
  var guard = startWorkCtx_(ctx, '', 'x', {});
  S.t('empty client refused with MSG.pickClient', guard.ok === false && guard.msg === MSG.pickClient, true);
  guard = startWorkCtx_(ctx, '   ', 'x', {});
  S.t('whitespace client refused (trim)', guard.ok, false);
  guard = startWorkCtx_(ctx, 'Nobody Ltd', 'x', {});
  S.t('unknown client refused with MSG.unknownClient', guard.msg, MSG.unknownClient('Nobody Ltd'));

  // --- Start: state, persistence, mirrors, snapshot contract ---
  var r1 = startWorkCtx_(ctx, 'Pet Centre', 'Grooming records', {});
  S.t('start ok', r1.ok, true);
  var st = getTimerState_(ctx);
  S.t('status RUNNING', st.status, 'RUNNING');
  S.t('start timestamp fresh (<5s)', Math.abs(Date.now() - st.startedAtMs) < 5000, true);
  // A fresh read returning the same start proves the state is durably in
  // Script Properties (survives a closed tab / crash / PC shutdown).
  S.t('start persisted (crash-safe)', getTimerState_(ctx).startedAtMs, r1.state.startedAtMs);
  var mirror = env.ss.getRangeByName(CFG.named.stStatus).offset(0, 0, 4, 1).getValues();
  S.t('settings mirror: status', String(mirror[0][0]), 'RUNNING');
  S.t('settings mirror: started-at matches state', mirror[1][0] instanceof Date && Math.abs(mirror[1][0].getTime() - st.startedAtMs) <= 2, true);
  S.t('settings mirror: client', String(mirror[2][0]), 'Pet Centre');
  S.t('banner announces the running client', String(env.ss.getRangeByName(CFG.named.dbStatus).getValue()).indexOf('● RUNNING — Pet Centre since ') === 0, true);
  var again = startWorkCtx_(ctx, 'Pet Centre', 'Grooming records', {});
  S.t('same client+task is a no-op', again.msg, MSG.alreadyRunning);
  S.t('no-op start does NOT reset the clock', getTimerState_(ctx).startedAtMs, r1.state.startedAtMs);
  var snap = buildSnapshot_(ctx, getTimerState_(ctx));
  S.t('snapshot: status/client mirror state', snap.status === 'RUNNING' && snap.client === 'Pet Centre', true);
  S.t('snapshot: epoch millis, never Date objects', typeof snap.startedAtMs === 'number' && typeof snap.serverNowMs === 'number', true);
  S.t('snapshot: serverNow fresh (<5s)', Math.abs(Date.now() - snap.serverNowMs) < 5000, true);
  S.t('snapshot: clients list from Clients sheet', snap.clients.length === 3 && snap.clients.indexOf("Paws 'n' Claws") >= 0, true);

  // --- Zero-gap switch → stop → row content + every column format ---
  // Short sleeps only need to make each session's duration measurably nonzero;
  // the assertions read the stored times, not the sleep length.
  Utilities.sleep(600);
  var r2 = startWorkCtx_(ctx, 'Splash Store', 'Restock', {}); // silent → auto zero-gap switch
  S.t('switch ok', r2.ok, true);
  S.t('switched to Splash Store', getTimerState_(ctx).client, 'Splash Store');
  Utilities.sleep(600);
  var r3 = stopAndLogCtx_(ctx);
  S.t('stop ok', r3.ok, true);
  S.t('stop message uses MSG.logged', r3.msg, MSG.logged(r3.loggedHours, 'Splash Store'));
  S.t('IDLE after stop', getTimerState_(ctx).status, 'IDLE');
  S.t('banner back to idle', String(env.ss.getRangeByName(CFG.named.dbStatus).getValue()), 'IDLE — ready to start');
  S.t('mirror started-at cleared on stop', String(env.ss.getRangeByName(CFG.named.stStartedAt).getValue()), '');
  S.t('two rows logged', log.getLastRow() - 1, 2);
  // Batch the row-content + format reads into two round-trips instead of ~18
  // (every getValue/getNumberFormat is a server hop — the suite's biggest cost).
  var v2 = log.getRange(2, 1, 1, CFG.log.lastCol).getValues()[0];
  var f2 = log.getRange(2, 1, 1, CFG.log.lastCol).getNumberFormats()[0];
  var start1 = v2[c.start - 1];
  var end1 = v2[c.end - 1];
  var row3 = log.getRange(3, 1, 1, CFG.log.lastCol).getValues()[0];
  var start2 = row3[c.start - 1];
  S.t('zero-gap: row1.End === row2.Start (exact ms)', end1.getTime(), start2.getTime());
  S.t('row1 client', String(v2[c.client - 1]), 'Pet Centre');
  S.t('row1 task', String(v2[c.task - 1]), 'Grooming records');
  S.t('row1 rate 45 via live lookup', Number(v2[c.rate - 1]), 45);
  var h1 = Number(v2[c.hours - 1]);
  S.t('row1 hours = ROUND((end-start)*24,2)', h1, Math.round(((end1 - start1) / 3600000) * 100) / 100);
  S.t('row1 amount = hours×rate', Number(v2[c.amount - 1]), Math.round(h1 * 45 * 100) / 100);
  S.t('row1 date == start day', dayFmt(v2[c.date - 1]), dayFmt(start1));
  S.t('start keeps hh:mm format', f2[c.start - 1], 'hh:mm');
  S.t('end keeps hh:mm format', f2[c.end - 1], 'hh:mm');
  S.t('date format dd/mm/yyyy', f2[c.date - 1], CFG.formats.date);
  S.t('hours format 0.00', f2[c.hours - 1], CFG.formats.hours);
  S.t('amount format €', f2[c.amount - 1], CFG.formats.euro);
  S.t('row2 blank-rate client → rate 0', Number(row3[c.rate - 1]), 0);

  // --- Stop when idle: refused, nothing logged ---
  var rows = log.getLastRow();
  var idleStop = stopAndLogCtx_(ctx);
  S.t('stop while IDLE refused', idleStop.ok === false && idleStop.msg === MSG.notRunning, true);
  S.t('stop while IDLE adds no row', log.getLastRow(), rows);

  // --- Corrupted state degrades to IDLE, never bricks ---
  var corrupt = makeCtx_({ ss: env.ss, prefix: 'corrupt:', silent: true });
  ['not json {', '{"status":"RUNNING"}', '{"status":"RUNNING","startedAtMs":"abc"}',
    '{"status":"RUNNING","startedAtMs":0}', '{"status":"PAUSED","startedAtMs":5}', 'null'].forEach(function (blob) {
    props.setProperty(stateKey_(corrupt), blob);
    S.t('corrupt blob → IDLE: ' + blob.slice(0, 24), getTimerState_(corrupt).status, 'IDLE');
  });
  S.t('tracker still starts after corruption', startWorkCtx_(corrupt, 'Pet Centre', 'x', {}).ok, true);
  discardRunningSession_(corrupt);
  var longTask = new Array(60).join('Għall-🐾-très-long-task ');
  setTimerState_(corrupt, { status: 'RUNNING', startedAtMs: 123456789, client: 'Pet Centre', task: longTask });
  S.t('long unicode task survives the state round-trip', getTimerState_(corrupt).task, longTask);
  props.deleteProperty(stateKey_(corrupt));

  // --- Crash simulation: PC died 2h ago; reopening bills the elapsed time ---
  setTimerState_(ctx, { status: 'RUNNING', startedAtMs: Date.now() - 7200000, client: 'Pet Centre', task: 'Crash recovery' });
  S.t('crashed session still RUNNING on re-read', getTimerState_(ctx).status, 'RUNNING');
  var crashStop = stopAndLogCtx_(ctx);
  S.near('crashed session bills the full elapsed 2h', crashStop.loggedHours, 2, 0.02);
  // The cell is wall-clock: compare against the row's own stored times so a
  // run inside the 2h window after a DST shift doesn't false-fail.
  var crashRow = log.getLastRow();
  var crashWall = Math.round((wallClockMinutes_(env.tz, log.getRange(crashRow, c.start).getValue(), log.getRange(crashRow, c.end).getValue()) / 60) * 100) / 100;
  S.near('crash row hours cell matches its stored times', Number(log.getRange(crashRow, c.hours).getValue()), crashWall, 0.011);

  // --- Order invariant: a failed append must NOT lose the session ---
  startWorkCtx_(ctx, 'Pet Centre', 'Order test', {});
  log.setName('TmpMoved');
  var threw = false;
  try {
    stopAndLogCtx_(ctx);
  } catch (e) {
    threw = true;
  }
  log.setName(CFG.sheets.log);
  S.t('stop with a broken log sheet throws (not silent)', threw, true);
  S.t('…and the session is still RUNNING (never lost)', getTimerState_(ctx).status, 'RUNNING');
  S.t('…and stops cleanly once the sheet is back', stopAndLogCtx_(ctx).ok, true);
  S.t('…logging the original task', String(log.getRange(log.getLastRow(), c.task).getValue()), 'Order test');

  // --- Lock released even when the locked fn throws ---
  try {
    withLock_(function () { throw new Error('boom'); });
  } catch (e) { /* expected */ }
  var t0 = Date.now();
  S.t('lock reacquired after a throw', withLock_(function () { return 42; }), 42);
  S.t('reacquired instantly (<2s)', Date.now() - t0 < 2000, true);

  // --- Recovery choices (the reopened-spreadsheet dialog) ---
  var rc = makeCtx_({ ss: env.ss, prefix: 'recovery:', silent: true });
  props.deleteProperty(stateKey_(rc));
  startWorkCtx_(rc, 'Pet Centre', 'Gamma', {});
  var runMs = getTimerState_(rc).startedAtMs;
  recoveryChoiceCtx_(rc, 'discard', runMs - 999);
  S.t('discard with a stale dialog is refused (different session)', getTimerState_(rc).status, 'RUNNING');
  recoveryChoiceCtx_(rc, 'keep', runMs);
  S.t('keep leaves the session running', getTimerState_(rc).status, 'RUNNING');
  rows = log.getLastRow();
  recoveryChoiceCtx_(rc, 'discard', runMs);
  S.t('matching discard goes IDLE', getTimerState_(rc).status, 'IDLE');
  S.t('discard never logs a row', log.getLastRow(), rows);
  startWorkCtx_(rc, 'Pet Centre', 'Recovery log', {});
  recoveryChoiceCtx_(rc, 'log', 0);
  S.t('recovery "log now" appends the session', String(log.getRange(log.getLastRow(), c.task).getValue()), 'Recovery log');
  S.t('recovery "log now" ends IDLE', getTimerState_(rc).status, 'IDLE');
  props.deleteProperty(stateKey_(rc));

  // --- Switch semantics (the reported "wrong task saved" concern) ---
  var swBase = log.getLastRow();
  startWorkCtx_(ctx, 'Pet Centre', 'Alpha task', {});
  Utilities.sleep(600);
  var swRes = startWorkCtx_(ctx, 'Pet Centre', 'Beta task', {}); // silent → auto zero-gap switch
  S.t('same-client task switch ok', swRes.ok, true);
  S.t('logged session keeps the OLD task (Alpha)', String(log.getRange(swBase + 1, c.task).getValue()), 'Alpha task');
  S.t('running session is the NEW task (Beta)', getTimerState_(ctx).task, 'Beta task');
  Utilities.sleep(600);
  stopAndLogCtx_(ctx);
  S.t('stop logs the NEW task (Beta)', String(log.getRange(swBase + 2, c.task).getValue()), 'Beta task');
  S.t('exactly two rows added by the switch pair', log.getLastRow(), swBase + 2);

  // Non-silent confirm gate: a task change must be confirmed; declining leaves
  // the ORIGINAL session running (the Cancel path the sidebar hardens).
  var gateCtx = makeCtx_({ ss: env.ss, prefix: 'switchgate:' });
  props.deleteProperty(stateKey_(gateCtx));
  startWorkCtx_(gateCtx, 'Pet Centre', 'Gamma', {});
  var gate = startWorkCtx_(gateCtx, 'Pet Centre', 'Delta', {});
  S.t('confirm gate: task change needs confirmation', !!gate.needsConfirm, true);
  S.t('confirm gate: prompt shows the OLD task', gate.current.task, 'Gamma');
  S.t('confirm gate: declining keeps OLD task running', getTimerState_(gateCtx).task, 'Gamma');
  var confd = startWorkCtx_(gateCtx, 'Pet Centre', 'Delta', { confirmSwitch: true });
  S.t('confirm gate: confirming runs the NEW task', confd.ok && getTimerState_(gateCtx).task, 'Delta');
  discardRunningSession_(gateCtx);
  props.deleteProperty(stateKey_(gateCtx));

  // --- Rate guard: don't silently log €0 for a rate-less client ---
  var rateCtx = makeCtx_({ ss: env.ss, prefix: 'rategate:' });
  props.deleteProperty(stateKey_(rateCtx));
  var rgWarn = startWorkCtx_(rateCtx, 'Splash Store', 'x', {}); // Splash rate is blank
  S.t('blank-rate client warns with MSG.noRate', rgWarn.needsRateConfirm === true && rgWarn.msg === MSG.noRate('Splash Store'), true);
  S.t('not started without confirm', getTimerState_(rateCtx).status, 'IDLE');
  S.t('starts after confirm', startWorkCtx_(rateCtx, 'Splash Store', 'x', { confirmNoRate: true }).ok, true);
  discardRunningSession_(rateCtx);
  var rgRated = startWorkCtx_(rateCtx, 'Pet Centre', 'y', {}); // rate 45 → no warning
  S.t('rated client starts directly', rgRated.ok === true && !rgRated.needsRateConfirm, true);
  discardRunningSession_(rateCtx);
  props.deleteProperty(stateKey_(rateCtx));

  // --- Property churn: state survives rapid rewrites ---
  var churn = makeCtx_({ ss: env.ss, prefix: 'churn:', silent: true });
  for (var i = 1; i <= 20; i++) {
    setTimerState_(churn, { status: 'RUNNING', startedAtMs: 1000000 + i, client: 'Pet Centre', task: 'churn ' + i });
  }
  S.t('20 rapid state rewrites: last write wins', getTimerState_(churn).startedAtMs, 1000020);
  props.deleteProperty(stateKey_(churn));
}

function sectionCheckboxes_(S, env) {
  var ss = env.ss;
  var ctx = env.ctx;
  var log = env.logSh;
  var c = env.c;
  var chkStart = ss.getRangeByName(CFG.named.chkStart);
  var chkStop = ss.getRangeByName(CFG.named.chkStop);
  var fire = function (range, value) {
    onEditInstallable({ range: range, value: value, source: ss });
  };

  // --- Guard rails while IDLE ---
  var rows = log.getLastRow();
  fire(chkStart, 'FALSE'); // our own reset write must never re-trigger
  S.t('FALSE edits are ignored', getTimerState_(ctx).status, 'IDLE');
  var taskCell = ss.getRangeByName(CFG.named.dbTask);
  taskCell.setValue('TRUE'); // Sheets parses this like typed input → boolean true
  fire(taskCell, 'TRUE');
  S.t('a TRUE typed elsewhere on the Dashboard is ignored', getTimerState_(ctx).status, 'IDLE');
  S.t('…and the cell is NOT reset (never touch unhandled cells)', taskCell.getDisplayValue(), 'TRUE');
  fire(log.getRange('D2'), 'TRUE');
  S.t('edits on other sheets are ignored', getTimerState_(ctx).status, 'IDLE');
  chkStop.setValue(true);
  fire(chkStop, 'TRUE');
  S.t('stop tick while IDLE: safe no-op', log.getLastRow(), rows);
  S.t('stop tick while IDLE: box reset', chkStop.getValue(), false);
  setNamedValue_(ctx, CFG.named.dbClient, '');
  chkStart.setValue(true);
  fire(chkStart, 'TRUE');
  S.t('start tick with no client: refused', getTimerState_(ctx).status, 'IDLE');
  S.t('start tick with no client: box still reset (finally)', chkStart.getValue(), false);

  // --- The real phone flow: start → double-fire → switch → no-rate → stop ---
  setNamedValue_(ctx, CFG.named.dbClient, 'Pet Centre');
  setNamedValue_(ctx, CFG.named.dbTask, 'Via checkbox');
  chkStart.setValue(true);
  fire(chkStart, 'TRUE');
  S.t('checkbox start: RUNNING', getTimerState_(ctx).status, 'RUNNING');
  S.t('checkbox start: box reset', chkStart.getValue(), false);
  var startedMs = getTimerState_(ctx).startedAtMs;
  chkStart.setValue(true);
  fire(chkStart, 'TRUE'); // double-fire (Sheets re-delivers events)
  S.t('double-fire: still ONE session, clock untouched', getTimerState_(ctx).startedAtMs, startedMs);
  S.t('double-fire: no extra row', log.getLastRow(), rows);

  setNamedValue_(ctx, CFG.named.dbClient, "Paws 'n' Claws");
  setNamedValue_(ctx, CFG.named.dbTask, 'Phone switch');
  chkStart.setValue(true);
  fire(chkStart, 'TRUE'); // dialog-free zero-gap switch on mobile
  S.t('checkbox switch: old session logged', String(log.getRange(rows + 1, c.task).getValue()), 'Via checkbox');
  S.t('checkbox switch: new client running', getTimerState_(ctx).client, "Paws 'n' Claws");
  S.t('checkbox switch: zero-gap to the millisecond', Math.abs(log.getRange(rows + 1, c.end).getValue().getTime() - getTimerState_(ctx).startedAtMs) <= 2, true);

  setNamedValue_(ctx, CFG.named.dbClient, 'Splash Store'); // blank rate — mobile proceeds anyway
  chkStart.setValue(true);
  fire(chkStart, 'TRUE');
  S.t('checkbox: blank-rate client proceeds on mobile', getTimerState_(ctx).client, 'Splash Store');
  S.t('checkbox: apostrophe client row logged with rate 30', Number(log.getRange(rows + 2, c.rate).getValue()), 30);
  chkStop.setValue(true);
  fire(chkStop, 'TRUE');
  S.t('checkbox stop: IDLE', getTimerState_(ctx).status, 'IDLE');
  S.t('checkbox stop: session logged', log.getLastRow(), rows + 3);
  setNamedValue_(ctx, CFG.named.dbClient, 'Pet Centre');
  setNamedValue_(ctx, CFG.named.dbTask, '');
}
