// test-runner.js — runSmokeTest(): end-to-end suite that drives the REAL
// functions on a throwaway spreadsheet (rebuild_ → timer lifecycle → report →
// PDF → checkbox handler → monthly drafts) and asserts CONTENT, never mere
// existence — the hard-won lesson from the Excel round, where an "exported
// PDF exists" check passed while a filter regression emptied the body.
// Never throws; returns {passed, failed, total, results:[{name,ok,expected,actual}]}.

function runSmokeTest() {
  var results = [];
  var t = function (name, actual, expected) {
    var ok = actual === expected;
    results.push({ name: name, ok: ok, expected: String(expected), actual: String(actual) });
  };

  var prodCtx = makeCtx_({ silent: true });
  var prodLogRows = countLogRows_(prodCtx);
  var prodStateRaw = PropertiesService.getScriptProperties().getProperty(CFG.props.state) || '';

  var throwaway = null;
  var testCtx = null;
  var c = CFG.log.cols;

  try {
    throwaway = buildThrowawaySpreadsheet_();
    testCtx = makeCtx_({ ss: throwaway, prefix: 'test:', silent: true });
    PropertiesService.getScriptProperties().deleteProperty(stateKey_(testCtx));

    var clientsSh = throwaway.getSheetByName(CFG.sheets.clients);
    clientsSh.getRange(2, CFG.clients.cols.rate).setValue(45); // Pet Centre
    // A fixed test address — independent of whether OWNER_EMAIL is set.
    clientsSh.getRange(2, CFG.clients.cols.email).setValue('client@example.test');
    var logSh = throwaway.getSheetByName(CFG.sheets.log);

    // --- Build sanity ---
    t('build: 6 sheets', throwaway.getSheets().length, 6);
    t('build: locale en_GB', throwaway.getSpreadsheetLocale(), 'en_GB');
    t('build: timezone Malta', throwaway.getSpreadsheetTimeZone(), 'Europe/Malta');

    // --- Timer lifecycle ---
    t('initial status IDLE', getTimerState_(testCtx).status, 'IDLE');
    var guard = startWorkCtx_(testCtx, '', 'x', {});
    t('guard: empty client refused', guard.ok, false);
    guard = startWorkCtx_(testCtx, 'Nobody Ltd', 'x', {});
    t('guard: unknown client refused', guard.ok, false);

    var r1 = startWorkCtx_(testCtx, 'Pet Centre', 'Grooming records', {});
    t('start ok', r1.ok, true);
    var st = getTimerState_(testCtx);
    t('status RUNNING', st.status, 'RUNNING');
    t('start timestamp fresh (<5s)', Math.abs(Date.now() - st.startedAtMs) < 5000, true);
    var again = startWorkCtx_(testCtx, 'Pet Centre', 'Grooming records', {});
    t('same client+task is a no-op', again.msg, MSG.alreadyRunning);

    Utilities.sleep(1500);
    var r2 = startWorkCtx_(testCtx, 'Splash Store', 'Restock', {}); // silent → auto zero-gap switch
    t('switch ok', r2.ok, true);
    t('switched to Splash Store', getTimerState_(testCtx).client, 'Splash Store');
    Utilities.sleep(1200);
    var r3 = stopAndLogCtx_(testCtx);
    t('stop ok', r3.ok, true);
    t('IDLE after stop', getTimerState_(testCtx).status, 'IDLE');
    t('two rows logged', logSh.getLastRow() - 1, 2);

    // --- Zero-gap invariant + row content ---
    var start1 = logSh.getRange(2, c.start).getValue();
    var end1 = logSh.getRange(2, c.end).getValue();
    var start2 = logSh.getRange(3, c.start).getValue();
    t('zero-gap: row1.End === row2.Start (exact ms)', end1.getTime(), start2.getTime());
    t('row1 client', String(logSh.getRange(2, c.client).getValue()), 'Pet Centre');
    t('row1 task', String(logSh.getRange(2, c.task).getValue()), 'Grooming records');
    t('row1 end > start', end1.getTime() > start1.getTime(), true);
    t('row1 rate 45 via lookup', Number(logSh.getRange(2, c.rate).getValue()), 45);
    var h1 = Number(logSh.getRange(2, c.hours).getValue());
    t('row1 hours = ROUND((end-start)*24,2)', h1, Math.round(((end1 - start1) / 3600000) * 100) / 100);
    t('row1 amount = hours*rate', Number(logSh.getRange(2, c.amount).getValue()), Math.round(h1 * 45 * 100) / 100);
    var dayFmt = function (d) { return Utilities.formatDate(d, 'Europe/Malta', 'yyyy-MM-dd'); };
    t('row1 date == start day', dayFmt(logSh.getRange(2, c.date).getValue()), dayFmt(start1));
    t('row1 start keeps hh:mm format', logSh.getRange(2, c.start).getNumberFormat(), 'hh:mm');
    t('row2 client', String(logSh.getRange(3, c.client).getValue()), 'Splash Store');
    t('row2 blank-rate client → rate 0', Number(logSh.getRange(3, c.rate).getValue()), 0);

    // --- Deterministic math row (1st of this month, 09:00→17:30) ---
    var now = new Date();
    var y = now.getFullYear();
    var m = now.getMonth() + 1;
    var ds = new Date(y, m - 1, 1, 9, 0, 0);
    var de = new Date(y, m - 1, 1, 17, 30, 0);
    appendLogRow_(testCtx, ds.getTime(), de.getTime(), 'Pet Centre', 'Deterministic row');
    t('det row hours 8.50', Number(logSh.getRange(4, c.hours).getValue()), 8.5);
    t('det row amount 382.50', Number(logSh.getRange(4, c.amount).getValue()), 382.5);

    // --- Guard-rail formulas present ---
    var ruleDump = logSh.getConditionalFormatRules()
      .map(function (r) {
        var bc = r.getBooleanCondition();
        return bc ? bc.getCriteriaValues().join(' ') : '[gradient]';
      })
      .join(' | ');
    t('>8h/day rule present', ruleDump.indexOf('>8') >= 0, true);
    t('midnight-cross rule present', ruleDump.indexOf('INT($E2)') >= 0, true);
    t('hours gradient present', ruleDump.indexOf('[gradient]') >= 0, true);

    // --- Report content (the empty-PDF lesson lives here) ---
    // forceFallback keeps the WORK BREAKDOWN grouping deterministic (no AI).
    var meta = buildReportCtx_(testCtx, 'Pet Centre', y, m, true, { forceFallback: true });
    var rep = throwaway.getSheetByName(CFG.sheets.report);
    t('report: 2 Pet Centre sessions this month', meta.rowCount, 2);
    t('report: title cell', String(rep.getRange('B3').getValue()), 'TIMESHEET');
    t('report: freelancer', String(rep.getRange('C5').getValue()), CFG.ownerName);
    t('report: period format mmmm yyyy', rep.getRange('C6').getNumberFormat(), 'mmmm yyyy');
    t('report: client cell', String(rep.getRange('C7').getValue()), 'Pet Centre');
    // Body is sorted by start → det row (1st, 09:00) first unless today IS the 1st and earlier.
    t('report: first body row is Pet Centre', String(rep.getRange('C10').getValue()), 'Pet Centre');
    t('report: total hours cell', Number(rep.getRange(10 + meta.rowCount, 7).getValue()), meta.totalHours);
    t('report: certification line', String(rep.getRange(10 + meta.rowCount + 3, 2).getValue()), MSG.certification);
    t('report: Malta ID shown', String(rep.getRange('C8').getValue()), CFG.ownerId);
    t('report: e-signature name', String(rep.getRange(10 + meta.rowCount + 5, 2).getValue()), CFG.ownerName);
    t('report: verification seal present', /^Document verification: [0-9A-F]{40}$/.test(String(rep.getRange(10 + meta.rowCount + 7, 2).getValue())), true);
    t('report: total = 8.5 + row1', meta.totalHours, Math.round((8.5 + h1) * 100) / 100);

    // --- Work breakdown + pie (content + artifact) ---
    var bdTop = 10 + meta.rowCount + 3 + 2 + 4; // totalRow + cert(+3) + sign block(+2) + gap(+4)
    t('breakdown: header cell', String(rep.getRange(bdTop, 2).getValue()), 'WORK BREAKDOWN');
    t('breakdown: 2 groups (fallback grouping)', meta.breakdown.length, 2);
    var bdSum = meta.breakdown.reduce(function (acc, g) { return acc + g.hours; }, 0);
    t('breakdown: groups sum to total', Math.round(bdSum * 100) / 100, meta.totalHours);
    t('breakdown: pie chart present', rep.getCharts().length, 1);

    var metaHoursOnly = buildReportCtx_(testCtx, 'Pet Centre', y, m, false, { forceFallback: true });
    var hdr = rep.getRange(9, 2, 1, 8).getValues()[0].join('|');
    t('hours-only: no Rate/Amount columns', hdr.indexOf('Rate') < 0 && hdr.indexOf('Amount') < 0, true);
    t('hours-only: lastCol is G', metaHoursOnly.lastCol, 7);

    // --- PDF (content already asserted above; artifact must be real too) ---
    var pdf = exportPdfCtx_(testCtx, {
      client: 'Pet Centre', year: y, month: m, includeMoney: true, save: false, forceFallback: true,
    });
    t('pdf: > 5KB', pdf.sizeBytes > 5000, true);
    t('pdf: content type', String(pdf.contentType).toLowerCase().indexOf('pdf') >= 0, true);
    t('pdf: filename', pdf.name, 'Timesheet_' + y + '-' + (m < 10 ? '0' + m : m) + '_PetCentre_' + sanitize_(CFG.ownerName) + '.pdf');
    t('pdf: covers 2 sessions', pdf.meta.rowCount, 2);

    // --- Mobile checkbox path (drives the real onEdit handler) ---
    setNamedValue_(testCtx, CFG.named.dbClient, 'Pet Centre');
    setNamedValue_(testCtx, CFG.named.dbTask, 'Via checkbox');
    var chkStart = throwaway.getRangeByName(CFG.named.chkStart);
    chkStart.setValue(true);
    onEditInstallable({ range: chkStart, value: 'TRUE', source: throwaway });
    t('checkbox: started timer', getTimerState_(testCtx).status, 'RUNNING');
    t('checkbox: box reset to false', chkStart.getValue(), false);
    var chkStop = throwaway.getRangeByName(CFG.named.chkStop);
    chkStop.setValue(true);
    onEditInstallable({ range: chkStop, value: 'TRUE', source: throwaway });
    t('checkbox: stop → IDLE', getTimerState_(testCtx).status, 'IDLE');
    t('checkbox: session logged', logSh.getLastRow() - 1, 4);

    // --- Manual past session (midnight-crossing, gets the live formulas) ---
    var man = addManualSessionCtx_(testCtx, {
      client: 'Pet Centre',
      task: 'Manual catch-up',
      dateIso: y + '-' + (m < 10 ? '0' + m : m) + '-01',
      startHm: '22:00',
      endHm: '01:30',
      nextDay: true,
    });
    t('manual: ok', man.ok, true);
    t('manual: returns 3.50 h', man.hours, 3.5);
    t('manual: row appended', logSh.getLastRow() - 1, 5);
    t('manual: hours formula 3.50', Number(logSh.getRange(6, c.hours).getValue()), 3.5);
    t('manual: rate lookup 45', Number(logSh.getRange(6, c.rate).getValue()), 45);
    t('manual: crosses midnight (red-date rule input)',
      dayFmt(logSh.getRange(6, c.end).getValue()) > dayFmt(logSh.getRange(6, c.start).getValue()), true);
    var badManual = addManualSessionCtx_(testCtx, {
      client: 'Pet Centre', task: 'x', dateIso: y + '-01-01', startHm: '10:00', endHm: '09:00', nextDay: false,
    });
    t('manual: end-before-start refused', badManual.ok, false);

    // --- Monthly drafts (isolated: a Gmail failure must not kill the suite) ---
    try {
      var job = monthlyEmailJobCtx_(testCtx, { year: y, month: m, save: false, forceFallback: true });
      t('drafts: one prepared (Pet Centre has email)', job.drafted.length, 1);
      t('drafts: Splash skipped (no email)', job.skippedNoEmail.indexOf('Splash Store') >= 0, true);
      t('drafts: no per-client failures', job.failed.length, 0);
      t('drafts: draft object captured', job.drafted.length ? !!job.drafted[0].draft : false, true);
      // Requirement: the draft body carries the PDF only, never a link.
      t('drafts: body has no URL', /https?:\/\//i.test(draftBody_('Pet Centre', 'July 2026', { totalHours: 1, rowCount: 1 })), false);
      // Delete via the captured reference — no getDrafts(), so gmail.compose suffices.
      job.drafted.forEach(function (d) {
        if (d.draft) d.draft.deleteDraft();
      });
    } catch (gmailErr) {
      results.push({
        name: 'drafts: Gmail section (auth?)',
        ok: false,
        expected: 'no throw',
        actual: String(gmailErr),
      });
    }

    // --- Switch scenarios (the reported "wrong task saved" concern) ---
    var swBase = logSh.getLastRow();
    startWorkCtx_(testCtx, 'Pet Centre', 'Alpha task', {});
    Utilities.sleep(1100);
    var swRes = startWorkCtx_(testCtx, 'Pet Centre', 'Beta task', {}); // silent → auto zero-gap switch
    t('switch: same-client switch ok', swRes.ok, true);
    t('switch: logged session keeps OLD task (Alpha)', String(logSh.getRange(swBase + 1, c.task).getValue()), 'Alpha task');
    t('switch: running session is NEW task (Beta)', getTimerState_(testCtx).task, 'Beta task');
    Utilities.sleep(1100);
    stopAndLogCtx_(testCtx);
    t('switch: stop logs the NEW task (Beta)', String(logSh.getRange(swBase + 2, c.task).getValue()), 'Beta task');
    t('switch: exactly two rows added', logSh.getLastRow(), swBase + 2);

    // Non-silent confirm gate: a task change must be confirmed; declining leaves
    // the ORIGINAL session running (the Cancel path the sidebar fix hardens).
    var gateCtx = makeCtx_({ ss: throwaway, prefix: 'switchgate:' });
    PropertiesService.getScriptProperties().deleteProperty(stateKey_(gateCtx));
    startWorkCtx_(gateCtx, 'Pet Centre', 'Gamma', {});
    var gate = startWorkCtx_(gateCtx, 'Pet Centre', 'Delta', {});
    t('confirm gate: task change needs confirmation', !!gate.needsConfirm, true);
    t('confirm gate: prompt shows the OLD task', gate.current.task, 'Gamma');
    t('confirm gate: declining keeps OLD task running', getTimerState_(gateCtx).task, 'Gamma');
    var confd = startWorkCtx_(gateCtx, 'Pet Centre', 'Delta', { confirmSwitch: true });
    t('confirm gate: confirming runs the NEW task', confd.ok && getTimerState_(gateCtx).task, 'Delta');
    discardRunningSession_(gateCtx);
    PropertiesService.getScriptProperties().deleteProperty(stateKey_(gateCtx));

    // --- Rate guard: don't silently log €0 for a rate-less client ---
    var rateCtx = makeCtx_({ ss: throwaway, prefix: 'rategate:' });
    PropertiesService.getScriptProperties().deleteProperty(stateKey_(rateCtx));
    var rgWarn = startWorkCtx_(rateCtx, 'Splash Store', 'x', {}); // Splash rate is blank
    t('rate guard: blank-rate client warns', !!rgWarn.needsRateConfirm, true);
    t('rate guard: not started without confirm', getTimerState_(rateCtx).status, 'IDLE');
    var rgGo = startWorkCtx_(rateCtx, 'Splash Store', 'x', { confirmNoRate: true });
    t('rate guard: starts after confirm', rgGo.ok, true);
    discardRunningSession_(rateCtx);
    var rgRated = startWorkCtx_(rateCtx, 'Pet Centre', 'y', {}); // rate 45 → no warning
    t('rate guard: rated client starts directly', rgRated.ok === true && !rgRated.needsRateConfirm, true);
    discardRunningSession_(rateCtx);
    PropertiesService.getScriptProperties().deleteProperty(stateKey_(rateCtx));
  } catch (err) {
    results.push({
      name: 'UNCAUGHT ERROR',
      ok: false,
      expected: 'no throw',
      actual: String((err && err.stack) || err),
    });
  } finally {
    try {
      if (testCtx) PropertiesService.getScriptProperties().deleteProperty(stateKey_(testCtx));
      if (throwaway) DriveApp.getFileById(throwaway.getId()).setTrashed(true);
    } catch (cleanupErr) {
      results.push({ name: 'CLEANUP', ok: false, expected: 'clean', actual: String(cleanupErr) });
    }
  }

  // --- Production untouched (assertable even after cleanup) ---
  var prodRowsAfter = countLogRows_(prodCtx);
  var prodStateAfter = PropertiesService.getScriptProperties().getProperty(CFG.props.state) || '';
  results.push({ name: 'production log untouched', ok: prodRowsAfter === prodLogRows, expected: String(prodLogRows), actual: String(prodRowsAfter) });
  results.push({ name: 'production timer state untouched', ok: prodStateAfter === prodStateRaw, expected: prodStateRaw || '(empty)', actual: prodStateAfter || '(empty)' });

  var failed = results.filter(function (r) { return !r.ok; }).length;
  return { passed: results.length - failed, failed: failed, total: results.length, results: results };
}

function countLogRows_(ctx) {
  var sh = ctx.ss.getSheetByName(CFG.sheets.log);
  return sh ? Math.max(sh.getLastRow() - 1, 0) : -1;
}
