// test-timer-machine.js — the LOG-AS-TRUTH timer: guards, the in-progress row
// shape, MANY concurrent clocks with unique ids, independent stop-by-id, stopAll,
// discard, idempotent/double-fire safety, free sessions, the crash-safe order
// invariant, lock hygiene, the one-time legacy migration, and the phone surface
// (per-row stop checkboxes mapping to the right session).

function sectionTimer_(S, env) {
  var ctx = env.ctx;
  var log = env.logSh;
  var c = env.c;
  var props = PropertiesService.getScriptProperties();
  var dayFmt = function (d) { return Utilities.formatDate(d, env.tz, 'yyyy-MM-dd'); };
  var uniqueCount = function (arr) { var u = {}; arr.forEach(function (x) { u[x] = true; }); return Object.keys(u).length; };

  // --- Guards carry the exact UX copy; a refused start writes no row ---
  S.t('initial: nothing running', getRunningSessions_(ctx).length, 0);
  var guard = startWorkCtx_(ctx, '', 'x', {});
  S.t('empty client refused with MSG.pickClient', guard.ok === false && guard.msg === MSG.pickClient, true);
  guard = startWorkCtx_(ctx, '   ', 'x', {});
  S.t('whitespace client refused (trim)', guard.ok, false);
  guard = startWorkCtx_(ctx, 'Nobody Ltd', 'x', {});
  S.t('unknown client refused with MSG.unknownClient', guard.msg, MSG.unknownClient('Nobody Ltd'));
  guard = startWorkCtx_(ctx, 'Pet Centre', '', {});
  S.t('blank task refused with MSG.pickTask (task is mandatory)', guard.ok === false && guard.msg === MSG.pickTask, true);
  S.t('…a refused start writes no row', getRunningSessions_(ctx).length, 0);

  // --- Start ONE clock: the in-progress row shape + snapshot contract ---
  var r1 = startWorkCtx_(ctx, 'Pet Centre', 'Grooming records', {});
  S.t('start ok', r1.ok, true);
  var run1 = getRunningSessions_(ctx);
  S.t('one session running', run1.length, 1);
  S.t('running row: client + task', run1[0].client === 'Pet Centre' && run1[0].task === 'Grooming records', true);
  S.t('start id fresh (<5s) and canonical (matches the stored row)', Math.abs(Date.now() - run1[0].startedAtMs) < 5000 && r1.startedAtMs === run1[0].startedAtMs, true);
  var ipRow = run1[0].row;
  var ipVals = log.getRange(ipRow, 1, 1, CFG.log.lastCol).getValues()[0];
  S.t('in-progress row: Start set', ipVals[c.start - 1] instanceof Date, true);
  S.t('in-progress row: End blank', String(ipVals[c.end - 1]), '');
  S.t('in-progress row: Hours blank (no #VALUE! poison in the money aggregates)', String(ipVals[c.hours - 1]), '');
  S.t('in-progress row: Amount blank', String(ipVals[c.amount - 1]), '');
  S.t('in-progress row: Date = INT(Start) day', dayFmt(ipVals[c.date - 1]), dayFmt(ipVals[c.start - 1]));
  S.t('in-progress row: Status reads "In Progress"', String(ipVals[c.status - 1]), 'In Progress');
  S.t('banner announces a running timer', String(env.ss.getRangeByName(CFG.named.dbStatus).getValue()).indexOf('● 1 timer') === 0, true);
  var snap = buildSnapshot_(ctx);
  S.t('snapshot: running[] carries the session', snap.running.length === 1 && snap.running[0].client === 'Pet Centre', true);
  S.t('snapshot: epoch millis, never Date objects', typeof snap.running[0].startedAtMs === 'number' && typeof snap.serverNowMs === 'number', true);
  S.t('snapshot: serverNow fresh (<5s)', Math.abs(Date.now() - snap.serverNowMs) < 5000, true);
  S.t('snapshot: clients list from Clients sheet', snap.clients.length === 3 && snap.clients.indexOf("Paws 'n' Claws") >= 0, true);
  var again = startWorkCtx_(ctx, 'Pet Centre', 'Grooming records', {});
  S.t('same client+task is a no-op (duplicate guard)', again.msg, MSG.alreadyRunning);
  S.t('…still exactly one session running', getRunningSessions_(ctx).length, 1);

  // --- CONCURRENT: two more clocks run alongside, all ids unique ---
  startWorkCtx_(ctx, 'Splash Store', 'Restock', { confirmNoRate: true });
  startWorkCtx_(ctx, "Paws 'n' Claws", 'Grooming', {});
  var running = getRunningSessions_(ctx);
  S.t('three concurrent sessions', running.length, 3);
  var ids = running.map(function (r) { return r.startedAtMs; });
  S.t('all three ids unique', uniqueCount(ids), 3);
  S.t('sessions sorted oldest-first', ids[0] <= ids[1] && ids[1] <= ids[2], true);
  S.t('banner counts all three', String(env.ss.getRangeByName(CFG.named.dbStatus).getValue()).indexOf('● 3 timers') === 0, true);

  // --- Stop ONE by id: it completes; the other two keep running ---
  Utilities.sleep(500);
  var petId = running.filter(function (r) { return r.client === 'Pet Centre'; })[0].startedAtMs;
  var stop1 = stopSessionCtx_(ctx, petId);
  S.t('stop one ok', stop1.ok, true);
  S.t('stop message uses MSG.logged', stop1.msg, MSG.logged(stop1.loggedHours, 'Pet Centre'));
  var afterStop = getRunningSessions_(ctx);
  S.t('two still running after stopping one', afterStop.length, 2);
  S.t('the stopped client is gone from the running set', afterStop.filter(function (r) { return r.client === 'Pet Centre'; }).length, 0);
  var done = log.getRange(ipRow, 1, 1, CFG.log.lastCol).getValues()[0];
  var f = log.getRange(ipRow, 1, 1, CFG.log.lastCol).getNumberFormats()[0];
  S.t('completed row: End now set', done[c.end - 1] instanceof Date, true);
  S.t('completed row: rate 45 via live lookup', Number(done[c.rate - 1]), 45);
  S.t('completed row: amount = hours×rate', Number(done[c.amount - 1]), Math.round(Number(done[c.hours - 1]) * 45 * 100) / 100);
  S.t('completed row: Status reads "Finished"', String(done[c.status - 1]), 'Finished');
  S.t('start keeps hh:mm format', f[c.start - 1], 'hh:mm');
  S.t('end keeps hh:mm format', f[c.end - 1], 'hh:mm');
  S.t('date format dd/mm/yyyy', f[c.date - 1], CFG.formats.date);
  S.t('hours format 0.00', f[c.hours - 1], CFG.formats.hours);
  S.t('amount format €', f[c.amount - 1], CFG.formats.euro);
  var again2 = stopSessionCtx_(ctx, petId);
  S.t('stopping an already-stopped id is a no-op', again2.ok, false);
  S.t('…and changes nothing', getRunningSessions_(ctx).length, 2);

  // --- Stop ALL: the remaining two complete at one instant ---
  Utilities.sleep(300);
  var stopAllRes = stopAllCtx_(ctx);
  S.t('stopAll ok + reports the count', stopAllRes.ok === true && stopAllRes.count === 2, true);
  S.t('stopAll message', stopAllRes.msg, MSG.stoppedAll(2));
  S.t('nothing running after stopAll', getRunningSessions_(ctx).length, 0);
  S.t('banner back to idle', String(env.ss.getRangeByName(CFG.named.dbStatus).getValue()), 'IDLE — ready to start');
  S.t('stopAll with nothing running → not ok', stopAllCtx_(ctx).ok, false);

  // --- Free session: Amount = "Free" at start, kept through stop ---
  var freeRes = startWorkCtx_(ctx, 'Pet Centre', 'Pro bono grooming', { free: true });
  S.t('free start ok', freeRes.ok, true);
  var freeSess = getRunningSessions_(ctx).filter(function (r) { return r.task === 'Pro bono grooming'; })[0];
  var freeRow = freeSess.row;
  S.t('free session flagged running', freeSess.free, true);
  S.t('free in-progress row: Amount = "Free"', String(log.getRange(freeRow, c.amount).getValue()), 'Free');
  S.t('free in-progress row: Status "In Progress" while live', String(log.getRange(freeRow, c.status).getValue()), 'In Progress');
  Utilities.sleep(300);
  stopSessionCtx_(ctx, freeSess.startedAtMs);
  var freeDone = log.getRange(freeRow, 1, 1, CFG.log.lastCol).getValues()[0];
  S.t('free completed row: Amount stays "Free" (no amount formula)', String(freeDone[c.amount - 1]), 'Free');
  S.t('free completed row: hours formula present (hours still count)', log.getRange(freeRow, c.hours).getFormula() !== '', true);
  S.t('free completed row: Status reads "Free"', String(freeDone[c.status - 1]), 'Free');

  // --- Discard: removes the row, never logs ---
  var dRes = startWorkCtx_(ctx, 'Pet Centre', 'Discard me', {});
  var beforeDiscard = log.getLastRow();
  var disc = discardSessionCtx_(ctx, dRes.startedAtMs);
  S.t('discard ok', disc.ok, true);
  S.t('discard removes the row (never logs)', log.getLastRow(), beforeDiscard - 1);
  S.t('nothing running after discard', getRunningSessions_(ctx).length, 0);

  // --- Crash: a clock started 2h ago just keeps ticking until stopped ---
  var crashRes = startWorkCtx_(ctx, 'Pet Centre', 'Crash recovery', {});
  var crashRow = findInProgressRow_(ctx, crashRes.startedAtMs);
  // Backdate its stored Start by 2h so stop bills the elapsed wall-clock.
  log.getRange(crashRow, c.start).setValue(new Date(Date.now() - 7200000)).setNumberFormat(CFG.formats.time);
  var backdatedId = log.getRange(crashRow, c.start).getValue().getTime();
  var crashStop = stopSessionCtx_(ctx, backdatedId);
  S.near('crashed session bills the full elapsed 2h', crashStop.loggedHours, 2, 0.02);
  var crashWall = Math.round((wallClockMinutes_(env.tz, log.getRange(crashRow, c.start).getValue(), log.getRange(crashRow, c.end).getValue()) / 60) * 100) / 100;
  S.near('crash row hours cell matches its stored times', Number(log.getRange(crashRow, c.hours).getValue()), crashWall, 0.011);

  // --- Order invariant: a broken log sheet fails the stop but never loses the session ---
  startWorkCtx_(ctx, 'Pet Centre', 'Order test', {});
  S.t('precondition: one session running before the break', getRunningSessions_(ctx).length, 1);
  log.setName('TmpMoved');
  var threw = false;
  try { stopAllCtx_(ctx); } catch (e) { threw = true; }
  log.setName(CFG.sheets.log);
  S.t('stop with a broken log sheet throws (not silent)', threw, true);
  S.t('…and the session is still running (never lost)', getRunningSessions_(ctx).length, 1);
  S.t('…and stops cleanly once the sheet is back', stopAllCtx_(ctx).ok, true);
  S.t('…logging the original task', String(log.getRange(log.getLastRow(), c.task).getValue()), 'Order test');

  // --- Lock released even when the locked fn throws ---
  try { withLock_(function () { throw new Error('boom'); }); } catch (e) { /* expected */ }
  var t0 = Date.now();
  S.t('lock reacquired after a throw', withLock_(function () { return 42; }), 42);
  S.t('reacquired instantly (<2s)', Date.now() - t0 < 2000, true);

  // --- Rate guard: don't silently log €0 for a rate-less client. The warning
  // fires only on an INTERACTIVE (non-silent) context — the sidebar/menu path;
  // the silent mobile/test path deliberately proceeds, so use a non-silent ctx. ---
  var rateCtx = makeCtx_({ ss: env.ss, prefix: 'test:' }); // silent:false
  discardAllCtx_(rateCtx);
  var rgWarn = startWorkCtx_(rateCtx, 'Splash Store', 'rate probe', {}); // Splash rate blank here
  S.t('blank-rate client warns with MSG.noRate', rgWarn.needsRateConfirm === true && rgWarn.msg === MSG.noRate('Splash Store'), true);
  S.t('not started without confirm', getRunningSessions_(rateCtx).length, 0);
  S.t('starts after confirm', startWorkCtx_(rateCtx, 'Splash Store', 'rate probe', { confirmNoRate: true }).ok, true);
  var rgRated = startWorkCtx_(rateCtx, 'Pet Centre', 'rated probe', {}); // rate 45 → no warning
  S.t('rated client starts directly', rgRated.ok === true && !rgRated.needsRateConfirm, true);
  var rgFree = startWorkCtx_(rateCtx, 'Splash Store', 'free no-rate', { free: true }); // blank rate, but free → no warning
  S.t('free start skips the no-rate warning (rate is moot when free)', rgFree.ok === true && !rgFree.needsRateConfirm, true);
  discardAllCtx_(rateCtx);

  // --- Recovery choices route to stop/discard/all by id ---
  discardAllCtx_(ctx);
  var g1 = startWorkCtx_(ctx, 'Pet Centre', 'Recover keep', {});
  startWorkCtx_(ctx, 'Splash Store', 'Recover log', { confirmNoRate: true });
  recoveryChoiceCtx_(ctx, 'keep', g1.startedAtMs);
  S.t('recovery keep leaves everything running', getRunningSessions_(ctx).length, 2);
  var logRow = findInProgressRow_(ctx, getRunningSessions_(ctx).filter(function (r) { return r.task === 'Recover log'; })[0].startedAtMs);
  recoveryChoiceCtx_(ctx, 'log', getRunningSessions_(ctx).filter(function (r) { return r.task === 'Recover log'; })[0].startedAtMs);
  S.t('recovery "log" completes that one session', log.getRange(logRow, c.end).getValue() instanceof Date, true);
  S.t('…and leaves the other running', getRunningSessions_(ctx).length, 1);
  recoveryChoiceCtx_(ctx, 'discardAll', 0);
  S.t('recovery discardAll clears the rest', getRunningSessions_(ctx).length, 0);

  // --- Legacy migration: an old single-timer blob seeds ONE in-progress row ---
  var mig = makeCtx_({ ss: env.ss, prefix: 'migrate:', silent: true });
  discardAllCtx_(mig);
  props.setProperty(stateKey_(mig), JSON.stringify({ status: 'RUNNING', startedAtMs: Date.now() - 3600000, client: 'Pet Centre', task: 'Legacy session' }));
  migrateLegacyTimerState_(mig);
  var migRun = getRunningSessions_(mig);
  S.t('migration seeds one in-progress row from the legacy blob', migRun.length, 1);
  S.t('migration recovered the legacy task', migRun[0].task, 'Legacy session');
  S.t('migration deletes the legacy property', props.getProperty(stateKey_(mig)), null);
  migrateLegacyTimerState_(mig);
  S.t('migration is idempotent (no duplicate row)', getRunningSessions_(mig).filter(function (r) { return r.task === 'Legacy session'; }).length, 1);
  props.setProperty(stateKey_(mig), 'not json {');
  var beforeCorrupt = getRunningSessions_(mig).length;
  migrateLegacyTimerState_(mig);
  S.t('migration of a corrupt blob adds no row', getRunningSessions_(mig).length, beforeCorrupt);
  S.t('…and still deletes the property', props.getProperty(stateKey_(mig)), null);

  // Leave the log with NO running sessions so later sections reconcile cleanly
  // (completed rows stay; only the still-running ones are discarded).
  discardAllCtx_(ctx);
  S.t('section leaves nothing running', getRunningSessions_(ctx).length, 0);
}

function sectionCheckboxes_(S, env) {
  var ss = env.ss;
  var ctx = env.ctx;
  var log = env.logSh;
  var chkStart = ss.getRangeByName(CFG.named.chkStart);
  var stopBlock = ss.getRangeByName(CFG.named.chkStopBlock);
  var runIds = ss.getRangeByName(CFG.named.dbRunIds);
  var freeBox = ss.getRangeByName(CFG.named.dbFree);
  var fire = function (range, value) { onEditInstallable({ range: range, value: value, source: ss }); };

  discardAllCtx_(ctx); // clean slate

  // --- Guard rails while idle ---
  fire(chkStart, 'FALSE'); // our own reset write must never re-trigger
  S.t('FALSE edits are ignored', getRunningSessions_(ctx).length, 0);
  var taskCell = ss.getRangeByName(CFG.named.dbTask);
  taskCell.setValue('TRUE'); // Sheets parses this like typed input → boolean true
  fire(taskCell, 'TRUE');
  S.t('a TRUE typed elsewhere on the Dashboard is ignored', getRunningSessions_(ctx).length, 0);
  S.t('…and the cell is NOT reset (never touch unhandled cells)', taskCell.getDisplayValue(), 'TRUE');
  fire(log.getRange('D2'), 'TRUE');
  S.t('edits on other sheets are ignored', getRunningSessions_(ctx).length, 0);
  setNamedValue_(ctx, CFG.named.dbClient, '');
  setNamedValue_(ctx, CFG.named.dbTask, '');
  freeBox.setValue(false);
  chkStart.setValue(true);
  fire(chkStart, 'TRUE');
  S.t('start tick with no client: refused', getRunningSessions_(ctx).length, 0);
  S.t('start tick with no client: box still reset (finally)', chkStart.getValue(), false);

  // --- The real phone flow: start → double-fire → a SECOND concurrent clock ---
  setNamedValue_(ctx, CFG.named.dbClient, 'Pet Centre');
  setNamedValue_(ctx, CFG.named.dbTask, 'Via checkbox');
  chkStart.setValue(true);
  fire(chkStart, 'TRUE');
  S.t('checkbox start: one session running', getRunningSessions_(ctx).length, 1);
  S.t('checkbox start: box reset', chkStart.getValue(), false);
  var firstId = getRunningSessions_(ctx)[0].startedAtMs;
  chkStart.setValue(true);
  fire(chkStart, 'TRUE'); // double-fire, same client+task → duplicate guard
  S.t('double-fire: still ONE session (duplicate guard)', getRunningSessions_(ctx).length, 1);
  S.t('double-fire: same id, clock untouched', getRunningSessions_(ctx)[0].startedAtMs, firstId);

  setNamedValue_(ctx, CFG.named.dbClient, "Paws 'n' Claws");
  setNamedValue_(ctx, CFG.named.dbTask, 'Phone second');
  chkStart.setValue(true);
  fire(chkStart, 'TRUE');
  S.t('checkbox: a second clock runs alongside (never a switch)', getRunningSessions_(ctx).length, 2);

  // --- The RUNNING NOW block: hidden ids mirror the sessions, stop maps by row ---
  SpreadsheetApp.flush();
  var renderedIds = runIds.getValues().map(function (r) { return r[0]; });
  var running = getRunningSessions_(ctx); // oldest-first == render order
  S.t('RUNNING NOW row 1 id matches the oldest session', Number(renderedIds[0]), running[0].startedAtMs);
  S.t('RUNNING NOW row 2 id matches the next session', Number(renderedIds[1]), running[1].startedAtMs);
  var secondId = running[1].startedAtMs;
  var stopCell2 = stopBlock.getCell(2, 1); // B18 — second RUNNING NOW row
  stopCell2.setValue(true);
  fire(stopCell2, 'TRUE');
  var afterMobileStop = getRunningSessions_(ctx);
  S.t('mobile stop maps to the RIGHT session (row 2 → the second clock)', afterMobileStop.filter(function (r) { return r.startedAtMs === secondId; }).length, 0);
  S.t('mobile stop leaves exactly one clock running', afterMobileStop.length, 1);
  S.t('…and it is the FIRST clock (untouched)', afterMobileStop[0].startedAtMs, firstId);

  // --- Free? via the phone: blank-rate client proceeds, session flagged free ---
  setNamedValue_(ctx, CFG.named.dbClient, 'Splash Store'); // blank rate — mobile proceeds anyway
  setNamedValue_(ctx, CFG.named.dbTask, 'Free phone');
  freeBox.setValue(true);
  chkStart.setValue(true);
  fire(chkStart, 'TRUE');
  var freeSess = getRunningSessions_(ctx).filter(function (r) { return r.task === 'Free phone'; })[0];
  S.t('checkbox: blank-rate client proceeds on mobile', !!freeSess, true);
  S.t('checkbox Free?: the session is flagged free', freeSess && freeSess.free, true);

  // Clean up so later sections reconcile against completed rows only.
  discardAllCtx_(ctx);
  S.t('mobile section leaves nothing running', getRunningSessions_(ctx).length, 0);
  freeBox.setValue(false);
  setNamedValue_(ctx, CFG.named.dbClient, 'Pet Centre');
  setNamedValue_(ctx, CFG.named.dbTask, '');
}
