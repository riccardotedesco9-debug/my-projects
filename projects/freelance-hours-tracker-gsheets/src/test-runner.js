// test-runner.js — runSmokeTest(): the deep health check + stress suite.
// Section 1 is a READ-ONLY health check of the production spreadsheet; every
// other section drives the REAL functions on a throwaway spreadsheet and
// asserts CONTENT, never mere existence — the hard-won lesson from the Excel
// round, where an "exported PDF exists" check passed while a filter regression
// emptied the body. Each section runs in its own try/catch (one blow-up can't
// hide the rest) and is timed; the whole suite self-limits to stay inside the
// Apps Script 6-minute execution ceiling.
// Never throws; returns {passed, failed, warned, total, elapsedMs, sections, results}.

var SUITE_BUDGET_MS = 300000; // hard stop for STARTING new sections (5 min)

function runSmokeTest() {
  var suiteStart = Date.now();
  var suite = { results: [], sections: [], startMs: suiteStart };

  var prodCtx = makeCtx_({ silent: true });
  var prodLogRows = countLogRows_(prodCtx);
  var prodStateRaw = PropertiesService.getScriptProperties().getProperty(CFG.props.state) || '';

  runSection_(suite, 'Production health check', function (S) {
    sectionProdHealth_(S, prodCtx);
  });

  var env = null;
  try {
    var tBuild = Date.now();
    env = makeTestEnv_(buildThrowawaySpreadsheet_());
    suite.sections.push({ name: 'Throwaway tracker build', passed: 1, failed: 0, warned: 0, ms: Date.now() - tBuild });
    suite.results.push({ section: 'Throwaway tracker build', name: 'full rebuild_ on a fresh spreadsheet', ok: true, level: 'test', expected: 'built', actual: 'built' });
  } catch (buildErr) {
    suite.sections.push({ name: 'Throwaway tracker build', passed: 0, failed: 1, warned: 0, ms: 0 });
    suite.results.push({ section: 'Throwaway tracker build', name: 'full rebuild_ on a fresh spreadsheet', ok: false, level: 'test', expected: 'built', actual: String((buildErr && buildErr.stack) || buildErr) });
  }

  if (env) {
    runSection_(suite, 'Fresh-build layout spec & empty-tracker behavior', function (S) { sectionBuildSpec_(S, env); });
    runSection_(suite, 'Timer state machine & crash safety', function (S) { sectionTimer_(S, env); });
    runSection_(suite, 'Mobile checkboxes (installable onEdit)', function (S) { sectionCheckboxes_(S, env); });
    runSection_(suite, 'Time Log math, formats & data integrity', function (S) { sectionLogMath_(S, env); });
    runSection_(suite, 'Manual sessions & project fees', function (S) { sectionManualEntries_(S, env); });
    runSection_(suite, 'Reports & period windows', function (S) { sectionReports_(S, env); });
    runSection_(suite, 'Work breakdown, seal & filenames', function (S) { sectionBreakdownSeal_(S, env); });
    runSection_(suite, 'PDF artifacts', function (S) { sectionPdf_(S, env); });
    runSection_(suite, 'Client viewer privacy contract', function (S) { sectionViewer_(S, env); });
    runSection_(suite, 'Monthly Gmail drafts', function (S) { sectionDrafts_(S, env); });
    runSection_(suite, 'Dashboard & Summary reconciliation', function (S) { sectionReconcile_(S, env); });
    // The heavy tail gets tighter gates: a section that STARTS too late could
    // push past Apps Script's 6-min hard kill and strand cleanup entirely.
    runSection_(suite, 'Volume stress & full-log invariants', function (S) { sectionStress_(S, env); }, 210000);
    runSection_(suite, 'Non-destructive layout update', function (S) { sectionUpdateLayout_(S, env); }, 250000);
    runSection_(suite, 'Disaster-recovery rebuild', function (S) { sectionRebuild_(S, env); }, 270000);
  }

  var cleanS = cleanupSuite_(suite, env);

  // --- Production unchanged (warn-level: a mid-run phone tick or manual entry
  // on the REAL tracker also trips these — interference, not a suite bug) ---
  var prodRowsAfter = countLogRows_(prodCtx);
  var prodStateAfter = PropertiesService.getScriptProperties().getProperty(CFG.props.state) || '';
  cleanS.warn('production log unchanged during the run', prodRowsAfter === prodLogRows,
    prodLogRows + ' → ' + prodRowsAfter + ' rows (concurrent use, or a suite leak — check the Time Log tail)');
  cleanS.warn('production timer state unchanged during the run', prodStateAfter === prodStateRaw,
    'state changed mid-run (concurrent use, or a suite leak)');

  return tallySuite_(suite, suiteStart);
}

/**
 * The read-only production health check ALONE — the everyday "how are things?"
 * instrument. ~30-60s, always finishes (no throwaway build, no stress), safe to
 * run anytime: it never writes to the tracker. Returns the same result shape as
 * runSmokeTest so the dialog renders it identically.
 */
function runQuickHealthCheck() {
  var suiteStart = Date.now();
  var suite = { results: [], sections: [], startMs: suiteStart };
  runSection_(suite, 'Production health check', function (S) {
    sectionProdHealth_(S, makeCtx_({ silent: true }));
  });
  return tallySuite_(suite, suiteStart);
}

/** Rolls section results into the headline verdict object. */
function tallySuite_(suite, suiteStart) {
  var passed = 0;
  var failed = 0;
  var warned = 0;
  suite.results.forEach(function (r) {
    if (r.level === 'test') {
      if (r.ok) passed++;
      else failed++;
    } else if (r.level === 'warn' && !r.ok) {
      warned++;
    }
  });
  return {
    passed: passed,
    failed: failed,
    warned: warned,
    skippedSections: suite.sections.filter(function (s) { return s.skipped; }).length,
    total: passed + failed,
    elapsedMs: Date.now() - suiteStart,
    sections: suite.sections,
    results: suite.results,
  };
}

/**
 * Runs one section in isolation: timed, budget-guarded, throw-contained.
 * gateMs (optional) is a tighter start-deadline for heavy tail sections.
 */
function runSection_(suite, name, fn, gateMs) {
  var sec = { name: name, passed: 0, failed: 0, warned: 0, ms: 0 };
  suite.sections.push(sec);
  if (Date.now() - suite.startMs > Math.min(gateMs || SUITE_BUDGET_MS, SUITE_BUDGET_MS)) {
    sec.warned++;
    sec.skipped = true;
    suite.results.push({ section: name, name: 'SKIPPED — suite time budget reached', ok: false, level: 'warn', expected: 'run', actual: 'skipped' });
    return;
  }
  var t0 = Date.now();
  try {
    fn(makeAsserter_(suite, sec));
  } catch (err) {
    sec.failed++;
    suite.results.push({ section: name, name: 'UNCAUGHT ERROR — section aborted here', ok: false, level: 'test', expected: 'no throw', actual: String((err && err.stack) || err) });
  }
  sec.ms = Date.now() - t0;
}

/** Assertion kit bound to one section: t (exact), near (±tol), warn, info. */
function makeAsserter_(suite, sec) {
  var push = function (name, ok, level, expected, actual) {
    suite.results.push({ section: sec.name, name: name, ok: ok, level: level, expected: String(expected), actual: String(actual) });
  };
  return {
    t: function (name, actual, expected) {
      var ok = actual === expected;
      if (ok) sec.passed++;
      else sec.failed++;
      push(name, ok, 'test', expected, actual);
    },
    near: function (name, actual, expected, tol) {
      var ok = typeof actual === 'number' && isFinite(actual) && Math.abs(actual - expected) <= tol;
      if (ok) sec.passed++;
      else sec.failed++;
      push(name, ok, 'test', expected + ' ±' + tol, actual);
    },
    warn: function (name, ok, detail) {
      if (!ok) sec.warned++;
      push(name, !!ok, 'warn', 'ok', ok ? 'ok' : String(detail));
    },
    info: function (name, detail) {
      push(name, true, 'info', '', detail);
    },
  };
}

/**
 * Shared test environment: throwaway tracker + ctx + handles. Pet Centre gets
 * rate 45 + an email; a third client with an apostrophe in its name is added
 * so unicode/quoting survives every chain the suite drives.
 */
function makeTestEnv_(throwaway) {
  var testCtx = makeCtx_({ ss: throwaway, prefix: 'test:', silent: true });
  PropertiesService.getScriptProperties().deleteProperty(stateKey_(testCtx));
  var clientsSh = throwaway.getSheetByName(CFG.sheets.clients);
  clientsSh.getRange(2, CFG.clients.cols.rate).setValue(45); // Pet Centre
  clientsSh.getRange(2, CFG.clients.cols.email).setValue('client@example.test');
  clientsSh.getRange(4, 1, 1, 3).setValues([["Paws 'n' Claws", 30, '']]);
  var now = new Date();
  return {
    ss: throwaway,
    ctx: testCtx,
    logSh: throwaway.getSheetByName(CFG.sheets.log),
    clientsSh: clientsSh,
    repSh: throwaway.getSheetByName(CFG.sheets.report),
    c: CFG.log.cols,
    y: now.getFullYear(),
    m: now.getMonth() + 1,
    tz: throwaway.getSpreadsheetTimeZone(),
    scratchIds: [], // extra spreadsheets to trash in cleanup
    propPrefixes: ['test:', 'switchgate:', 'rategate:', 'corrupt:', 'recovery:', 'churn:'],
    cleanupProps: [], // exact extra property keys to delete in cleanup
    gmailDrafts: [], // drafts to sweep in cleanup if a section died mid-way
  };
}

/**
 * Trash throwaways, sweep leftover drafts, delete every suite-owned property —
 * then VERIFY the observable state (trashed flag, remaining keys), never just
 * that the code ran. Returns its asserter so the runner can append the final
 * production checks under the same section counters.
 */
function cleanupSuite_(suite, env) {
  var sec = { name: 'Cleanup', passed: 0, failed: 0, warned: 0, ms: 0 };
  suite.sections.push(sec);
  var S = makeAsserter_(suite, sec);
  var t0 = Date.now();
  try {
    if (env) {
      env.gmailDrafts.forEach(function (d) {
        try {
          d.deleteDraft();
        } catch (e) {
          // already deleted by its section — the normal case
        }
      });
      var props = PropertiesService.getScriptProperties();
      props.getKeys().forEach(function (k) {
        var mine = env.propPrefixes.some(function (p) { return k.indexOf(p) === 0; });
        if (mine || env.cleanupProps.indexOf(k) >= 0) props.deleteProperty(k);
      });
      var leaked = props.getKeys().filter(function (k) {
        return env.propPrefixes.some(function (p) { return k.indexOf(p) === 0; });
      });
      S.t('no test state left in Script Properties', leaked.join(','), '');
      var ids = [env.ss.getId()].concat(env.scratchIds);
      ids.forEach(function (id) {
        DriveApp.getFileById(id).setTrashed(true);
      });
      var untrashed = ids.filter(function (id) { return !DriveApp.getFileById(id).isTrashed(); });
      S.t('throwaway spreadsheets really in the bin', untrashed.join(','), '');
    }
  } catch (cleanupErr) {
    sec.failed++;
    suite.results.push({ section: 'Cleanup', name: 'CLEANUP', ok: false, level: 'test', expected: 'clean', actual: String(cleanupErr) });
  }
  sec.ms = Date.now() - t0;
  return S;
}

function countLogRows_(ctx) {
  var sh = ctx.ss.getSheetByName(CFG.sheets.log);
  return sh ? Math.max(sh.getLastRow() - 1, 0) : -1;
}

/** One read of every log data row (or [] when empty). */
function readLogValues_(env) {
  var last = env.logSh.getLastRow();
  if (last < CFG.log.firstDataRow) return [];
  return env.logSh.getRange(CFG.log.firstDataRow, 1, last - 1, CFG.log.lastCol).getValues();
}
