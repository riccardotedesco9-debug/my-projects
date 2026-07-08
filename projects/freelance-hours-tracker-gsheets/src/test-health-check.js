// test-health-check.js — Section 1 of the smoke suite: a READ-ONLY health
// check of the PRODUCTION tracker (structure, wiring, properties, triggers,
// Drive tree, and a full data-integrity sweep of the real Time Log). Nothing
// here writes to production — ever. Also home of the invariant-sweep helpers
// the stress section reuses on the throwaway.

function sectionProdHealth_(S, ctx) {
  var ss = ctx.ss;
  var props = PropertiesService.getScriptProperties();

  // --- Structure ---
  Object.keys(CFG.sheets).forEach(function (k) {
    S.t('sheet exists: ' + CFG.sheets[k], !!ss.getSheetByName(CFG.sheets[k]), true);
  });
  S.t('locale en_GB (dd/mm dates)', ss.getSpreadsheetLocale(), 'en_GB');
  S.t('timezone Europe/Malta', ss.getSpreadsheetTimeZone(), 'Europe/Malta');
  var logSh = ss.getSheetByName(CFG.sheets.log);
  if (logSh) {
    S.t('Time Log header row intact', logSh.getRange(1, 1, 1, CFG.log.lastCol).getValues()[0].join('|'), CFG.log.headers.join('|'));
    var ruleDump = logSh.getConditionalFormatRules()
      .map(function (r) {
        var bc = r.getBooleanCondition();
        return bc ? bc.getCriteriaValues().join(' ') : '[gradient]';
      })
      .join(' | ');
    S.warn('guard-rail formats live (>8h / midnight / gradient)',
      ruleDump.indexOf('>8') >= 0 && ruleDump.indexOf('INT($E2)') >= 0 && ruleDump.indexOf('[gradient]') >= 0,
      'missing — run Maintenance → Update layout');
  }

  // --- Named ranges (the sidebar, checkboxes and mirrors hang off these) ---
  var missingNamed = Object.keys(CFG.named).filter(function (k) {
    return !ss.getRangeByName(CFG.named[k]);
  });
  S.t('all ' + Object.keys(CFG.named).length + ' named ranges resolve', missingNamed.join(','), '');

  // --- Settings mirror + schema ---
  var settings = ss.getSheetByName(CFG.sheets.settings);
  if (settings) {
    S.warn('Settings sheet hidden', settings.isSheetHidden(), 'visible — cosmetic only');
    S.t('schema version matches code', String(settings.getRange('C9').getValue()), CFG.schemaVersion);
  }

  // --- Triggers (phone checkboxes + auto-open + monthly drafts are dead without these) ---
  var handlers = {};
  ScriptApp.getProjectTriggers().forEach(function (t) {
    handlers[t.getHandlerFunction()] = (handlers[t.getHandlerFunction()] || 0) + 1;
  });
  ['onOpenInstallable', 'onEditInstallable', 'monthlyEmailJob'].forEach(function (h) {
    S.t('trigger installed: ' + h, (handlers[h] || 0) >= 1, true);
  });

  // --- Script Properties (identity + keys) ---
  S.warn('OWNER_NAME set (PDFs sign with it)', CFG.ownerName !== 'Freelancer', 'placeholder "Freelancer" — run installSecrets / set Script Properties');
  S.warn('OWNER_EMAIL set (monthly-draft alerts need it)', !!CFG.ownerEmail, 'empty');
  S.warn('OWNER_ID set (shown on timesheets)', !!CFG.ownerId, 'empty');
  S.info('SIGNING_SECRET', props.getProperty('SIGNING_SECRET') ? 'present — seals verifiable' : 'not yet created (appears on first export)');
  S.info('ANTHROPIC_API_KEY', props.getProperty('ANTHROPIC_API_KEY') ? 'present — AI task grouping active' : 'absent — exact-match grouping fallback');
  var leftover = props.getKeys().filter(function (k) {
    return ['test:', 'migrate:'].some(function (p) { return k.indexOf(p) === 0; });
  });
  S.warn('no stale test state from earlier runs', leftover.length === 0, leftover.join(','));

  // --- Legacy timer blob gone (running timers now live as Time Log rows) ---
  var legacy = props.getProperty(CFG.props.state);
  S.warn('no legacy single-timer property left (migrated to log rows)', !legacy,
    'still present: ' + String(legacy).slice(0, 60) + ' — open the sheet / Update layout to migrate it');

  // --- Running timers (in-progress rows) sanity ---
  var runningNow = getRunningSessions_(ctx);
  S.info('timers', runningNow.length === 0 ? 'none running'
    : runningNow.length + ' running: ' + runningNow.map(function (r) { return r.client + (r.task ? '/' + r.task : ''); }).join(', '));
  runningNow.forEach(function (r) {
    var ageH = (Date.now() - r.startedAtMs) / 3600000;
    S.t('running timer started in the past (' + r.client + ')', r.startedAtMs <= Date.now(), true);
    S.warn('running timer younger than 16h (' + r.client + ')', ageH < 16, 'running ' + ageH.toFixed(1) + 'h — forgot to stop?');
  });

  // --- Clients hygiene ---
  var names = getClientNames_(ctx);
  S.t('at least one client configured', names.length >= 1, true);
  var lower = {};
  var dups = [];
  names.forEach(function (n) {
    var k = n.toLowerCase();
    if (lower[k]) dups.push(n);
    lower[k] = true;
  });
  S.t('no duplicate client names (rate lookup must be deterministic)', dups.join(','), '');
  var clientsSh = ss.getSheetByName(CFG.sheets.clients);
  if (clientsSh && clientsSh.getLastRow() >= 2) {
    var cRows = clientsSh.getRange(2, 1, clientsSh.getLastRow() - 1, 3).getValues();
    var badRates = [];
    var noRate = [];
    var badEmails = [];
    cRows.forEach(function (r) {
      var n = String(r[0] || '').trim();
      if (!n) return;
      var rate = r[1];
      if (rate !== '' && rate !== null && !isFinite(Number(rate))) badRates.push(n + '="' + rate + '"');
      else if (rate === '' || Number(rate) <= 0) noRate.push(n);
      var em = String(r[2] || '').trim();
      if (em && em.indexOf('@') < 0) badEmails.push(n);
    });
    S.t('every rate numeric or blank (text rates bill €0 silently)', badRates.join(','), '');
    S.warn('clients with no €/h rate (their hours bill €0)', noRate.length === 0, noRate.join(', '));
    S.warn('client emails look like emails', badEmails.length === 0, badEmails.join(', '));
  }

  // --- Full Time Log data-integrity sweep (one read) ---
  var sweep = sweepLogInvariants_(ctx);
  S.info('production log', sweep.hourly + ' timed sessions + ' + sweep.fixed + ' fixed fees + ' + sweep.inProgress + ' in progress');
  S.t('every log row internally consistent (date/hours/amount math)', sweep.violations.slice(0, 5).join(' ; '), '');
  // Overlapping wall-clock is INTENTIONAL now — several clocks can run at once
  // and each task bills independently. Informational, never a warning.
  S.info('overlapping (simultaneous) sessions', sweep.overlaps.length === 0 ? 'none' : sweep.overlaps.length + ' pair(s) — simultaneous billing, by design');
  S.warn('every logged client still on the Clients sheet', sweep.orphanClients.length === 0, sweep.orphanClients.join(', '));

  // --- Dashboard formulas alive + reconcile against the raw log ---
  var dbToday = ss.getRangeByName(CFG.named.dbToday);
  var dbMonth = ss.getRangeByName(CFG.named.dbMonth);
  if (dbToday && dbMonth) {
    S.t('dashboard stat cells are still formulas', dbToday.getFormula().indexOf('SUMIF') >= 0 && dbMonth.getFormula().indexOf('SUMIFS') >= 0, true);
    var statVals = [dbToday.getValue(), dbMonth.getValue(), dbMonth.offset(1, 0).getValue()];
    var errCells = statVals.filter(function (v) { return typeof v !== 'number' || /^#/.test(String(v)); });
    S.t('no error values in dashboard stats', errCells.join(','), '');
    S.near('dashboard "This month" hours match the raw log', Number(statVals[1]) || 0, sweep.monthHours, 0.05);
    S.near('dashboard "Earned this month" matches the raw log', Number(statVals[2]) || 0, sweep.monthAmount, 0.05);
  }
  var summary = ss.getSheetByName(CFG.sheets.summary);
  if (summary) S.warn('Summary carries its 2 charts', summary.getCharts().length === 2, summary.getCharts().length + ' — run Update layout');

  // --- Phone checkboxes not stuck ---
  var chkS = ss.getRangeByName(CFG.named.chkStart);
  if (chkS) S.warn('phone START checkbox at rest (not stuck TRUE)', chkS.getValue() !== true, 'the START box is stuck ticked');

  // --- Drive tree: every artifact the tracker makes lives under one root ---
  var rootIt = DriveApp.getRootFolder().getFoldersByName(CFG.folders.root);
  var root = rootIt.hasNext() ? rootIt.next() : null;
  S.warn('Drive folder "' + CFG.folders.root + '" exists', !!root, 'missing — run setup() / Update layout');
  if (root) {
    var homed = false;
    var parIt = DriveApp.getFileById(ss.getId()).getParents();
    while (parIt.hasNext()) {
      if (parIt.next().getId() === root.getId()) homed = true;
    }
    S.warn('tracker spreadsheet filed inside the root folder', homed, 'the tracker itself sits outside its folder');

    var tsIt = root.getFoldersByName(CFG.folders.timesheets);
    var ts = tsIt.hasNext() ? tsIt.next() : null;
    S.warn('Timesheets/ export folder exists', !!ts, 'missing');
    if (ts) {
      var clientDirs = 0;
      var pdfCount = 0;
      var dirIt = ts.getFolders();
      while (dirIt.hasNext()) {
        clientDirs++;
        var fIt = dirIt.next().getFiles();
        while (fIt.hasNext()) {
          fIt.next();
          pdfCount++;
        }
      }
      S.info('Timesheets filed', clientDirs + ' client folder(s), ' + pdfCount + ' PDF(s)');
    }

    var cvIt = root.getFoldersByName(CFG.folders.viewers);
    var cv = cvIt.hasNext() ? cvIt.next() : null;
    S.warn('Client Views/ folder exists', !!cv, 'missing — created with your first client view');
    if (cv) {
      var views = 0;
      var vIt = cv.getFiles();
      while (vIt.hasNext()) {
        vIt.next();
        views++;
      }
      S.info('Client Views filed', views + ' live view file(s)');
    }

    // Nothing the tracker makes should be loose in My Drive root.
    var loose = [];
    var rootSheets = DriveApp.getRootFolder().getFilesByType(MimeType.GOOGLE_SHEETS);
    var scanned = 0;
    while (rootSheets.hasNext() && scanned < 200) {
      var nm = rootSheets.next().getName();
      scanned++;
      if (nm.indexOf('Hours — ') === 0 && nm.indexOf(CFG.ownerName) > 0) loose.push(nm);
    }
    S.warn('no client views loose in My Drive root', loose.length === 0,
      loose.slice(0, 4).join(' ; ') + ' — belongs in Client Views/ (re-create it to re-file)');
  }
  // Self-healing: a suite run killed by the 6-min ceiling can strand its
  // throwaway. Anything suite-named and older than an hour is safely ours —
  // trash it (recoverable from the bin for 30 days) and report.
  var litter = DriveApp.searchFiles("title contains 'TEST HoursTracker' and trashed=false");
  var litterCount = 0;
  var swept = 0;
  while (litter.hasNext() && litterCount < 10) {
    var f = litter.next();
    litterCount++;
    if (Date.now() - f.getDateCreated().getTime() > 3600000) {
      f.setTrashed(true);
      swept++;
    }
  }
  S.warn('no stranded TEST spreadsheets in Drive', litterCount === 0,
    litterCount + ' found (earlier run died before cleanup)' + (swept ? ' — ' + swept + ' auto-trashed now' : ''));

  // --- Export dialog model ---
  var model = getExportModel();
  S.t('export dialog offers 12 months + 2 full years', model.periods.length, 14);
  S.t('full-year options use the month-0 sentinel', model.periods[12].month === 0 && model.periods[13].month === 0, true);
  var now = new Date();
  S.t('first export period is the current month', model.periods[0].year * 100 + model.periods[0].month, now.getFullYear() * 100 + now.getMonth() + 1);
  var eleven = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  S.t('12th export period is 11 months back (year rollover)', model.periods[11].year * 100 + model.periods[11].month, eleven.getFullYear() * 100 + eleven.getMonth() + 1);

  S.info('Gmail/Mail daily quota remaining', MailApp.getRemainingDailyQuota());
}

/**
 * Reads the whole Time Log once and checks every row's internal consistency:
 * hourly rows must satisfy Date == day(Start), Hours == wall-clock(End-Start),
 * Amount == Hours×Rate; fixed-fee rows must carry an Amount and no times.
 * Wall-clock math is derived from formatted components (DST-proof: the sheet
 * bills what the clock on the wall says, exactly like the ROUND((E-D)*24,2)
 * serial formula). Also detects overlapping sessions and orphaned clients.
 */
function sweepLogInvariants_(ctx) {
  var out = { rows: 0, hourly: 0, fixed: 0, inProgress: 0, violations: [], overlaps: [], orphanClients: [], monthHours: 0, monthAmount: 0 };
  var sh = ctx.ss.getSheetByName(CFG.sheets.log);
  if (!sh || sh.getLastRow() < CFG.log.firstDataRow) return out;
  var tz = ctx.ss.getSpreadsheetTimeZone();
  var c = CFG.log.cols;
  var vals = sh.getRange(CFG.log.firstDataRow, 1, sh.getLastRow() - 1, CFG.log.lastCol).getValues();
  var known = {};
  getClientNames_(ctx).forEach(function (n) { known[n.toLowerCase()] = true; });
  var monthKey = Utilities.formatDate(new Date(), tz, 'yyyy-MM');
  var day = function (d) { return Utilities.formatDate(d, tz, 'yyyy-MM-dd'); };
  var timed = [];

  vals.forEach(function (v, i) {
    var rowN = i + CFG.log.firstDataRow;
    var blank = v.every(function (cell) { return cell === '' || cell === null; });
    if (blank) return;
    out.rows++;
    var date = v[c.date - 1];
    var client = String(v[c.client - 1] || '').trim();
    var start = v[c.start - 1];
    var end = v[c.end - 1];
    var hours = Number(v[c.hours - 1]) || 0;
    var rate = Number(v[c.rate - 1]) || 0;
    var amount = Number(v[c.amount - 1]) || 0;
    if (!client || !(date instanceof Date)) {
      out.violations.push('row ' + rowN + ': missing client or date — it will never appear on a timesheet');
      return;
    }
    if (client && !known[client.toLowerCase()]) out.orphanClients.push(client + ' (row ' + rowN + ')');
    if (Utilities.formatDate(date, tz, 'yyyy-MM') === monthKey) {
      out.monthHours += hours;
      out.monthAmount += amount;
    }
    if (Utilities.formatDate(date, tz, 'HHmmss') !== '000000') {
      out.violations.push('row ' + rowN + ': Date cell carries a time of day (hand-typed?) — breaks month bucketing');
    }
    if (start instanceof Date && end instanceof Date) {
      out.hourly++;
      var expHours = Math.round((wallClockMinutes_(tz, start, end) / 60) * 100) / 100;
      // A "Free" row carries the text "Free" in Amount (→ 0), yet its hours still
      // count; only price the amount check on rows that hold a numeric amount.
      var isFree = String(v[c.amount - 1]) === 'Free';
      if (Math.abs(hours - expHours) > 0.011) out.violations.push('row ' + rowN + ': hours ' + hours + ' ≠ ' + expHours + ' (End−Start)');
      if (!isFree && Math.abs(amount - Math.round(hours * rate * 100) / 100) > 0.011) out.violations.push('row ' + rowN + ': amount ' + amount + ' ≠ hours×rate');
      if (day(date) !== day(start)) out.violations.push('row ' + rowN + ': Date ≠ day of Start');
      // Wall-clock ordering (not epoch): the DST fall-back hour reads back
      // ambiguous epochs and would flag legitimate sessions as overlapping.
      timed.push({ row: rowN, s: wallClockUtcMs_(tz, start), e: wallClockUtcMs_(tz, end) });
    } else if (start instanceof Date && !(end instanceof Date)) {
      // A running (in-progress) session: Start set, End blank. Not a violation —
      // it completes on stop; its blank Hours/Amount read 0 in every aggregate.
      out.inProgress++;
    } else {
      out.fixed++;
      if (!(amount > 0) && String(v[c.amount - 1]) !== 'Free') out.violations.push('row ' + rowN + ': no times and no amount — dead row');
    }
  });

  timed.sort(function (a, b) { return a.s - b.s; });
  for (var i = 1; i < timed.length; i++) {
    if (timed[i].s < timed[i - 1].e) out.overlaps.push('rows ' + timed[i - 1].row + '+' + timed[i].row);
  }
  out.monthHours = Math.round(out.monthHours * 100) / 100;
  out.monthAmount = Math.round(out.monthAmount * 100) / 100;
  return out;
}

/** Wall-clock minutes between two sheet datetimes, immune to DST epoch skew. */
function wallClockMinutes_(tz, start, end) {
  return (wallClockUtcMs_(tz, end) - wallClockUtcMs_(tz, start)) / 60000;
}

/** A sheet datetime's wall-clock components re-anchored in UTC (no DST). */
function wallClockUtcMs_(tz, d) {
  var p = Utilities.formatDate(d, tz, 'yyyy MM dd HH mm ss').split(' ');
  return Date.UTC(+p[0], +p[1] - 1, +p[2], +p[3], +p[4], +p[5]);
}
