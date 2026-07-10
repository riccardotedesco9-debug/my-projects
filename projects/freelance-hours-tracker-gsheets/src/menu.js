// menu.js — custom menu, sidebar/dialog plumbing, open-time crash recovery.
//
// Two onOpen layers by design:
//  - simple onOpen(e): menu only (safe under any AuthMode, never needs auth)
//  - installable onOpenInstallable(e): full-auth work — banner refresh,
//    crash-recovery prompt, sidebar auto-reopen. Created by setup().

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('⏱ Tracker')
    .addItem('Open timer panel', 'showSidebar')
    .addItem('Add past session…', 'showAddSessionDialog')
    .addItem('Add project fee…', 'showAddProjectDialog')
    .addSeparator()
    .addItem('▶ Start (Dashboard client/task)', 'startWorkFromSheet')
    .addItem('■ Stop & log all', 'stopAllFromSheet')
    .addSeparator()
    .addItem('Mark selected session(s) free', 'toggleSelectedFree')
    .addItem('Mark selected session(s) TBD (price later)', 'toggleSelectedTbd')
    .addItem('Bill selected session(s) at hourly rate', 'billSelectedAtRate')
    .addItem('Delete selected session(s)', 'deleteSelectedLogRows')
    .addItem('Sort Time Log by date', 'sortLogByDate')
    .addSeparator()
    .addItem('Export timesheet PDF…', 'showExportDialog')
    .addItem('Prepare monthly drafts now', 'monthlyEmailJob')
    .addItem('Client views…', 'showClientViewDialog')
    .addSeparator()
    .addSubMenu(
      ui.createMenu('Maintenance')
        .addItem('Update layout (keeps your data)', 'updateLayout')
        .addItem('Quick health check (~1 min)', 'showQuickHealthDialog')
        .addItem('Full test suite (~4 min)', 'showSmokeTestDialog')
        .addItem('Check AI grouping', 'checkAiGrouping')
        .addItem('Load demo data (sample clients + sessions)', 'loadDemoData')
        .addItem('Rebuild tracker (wipes data)', 'rebuildActive')
    )
    .addToUi();
}

function showAddProjectDialog() {
  var html = HtmlService.createHtmlOutputFromFile('add-project-dialog')
    .setWidth(400)
    .setHeight(440);
  SpreadsheetApp.getUi().showModalDialog(html, 'Add project fee');
}

function showAddSessionDialog() {
  var html = HtmlService.createHtmlOutputFromFile('add-session-dialog')
    .setWidth(400)
    .setHeight(440);
  SpreadsheetApp.getUi().showModalDialog(html, 'Add past session');
}

function onOpenInstallable() {
  var ctx = makeCtx_();
  migrateLegacyTimerState_(ctx); // one-time bridge off the old single-timer blob
  paintRunningSurfaces_(ctx);
  try {
    if (getRunningSessions_(ctx).length > 0) {
      showRecoveryDialog_();
    } else {
      showSidebar();
    }
  } catch (e) {
    // No UI surface (mobile app / API open) — the log rows stay authoritative;
    // the prompt simply appears on the next desktop open.
  }
}

function showSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('sidebar').setTitle('⏱ Hours Tracker');
  SpreadsheetApp.getUi().showSidebar(html);
}

function showRecoveryDialog_() {
  var html = HtmlService.createHtmlOutputFromFile('recovery-dialog')
    .setWidth(440)
    .setHeight(460);
  SpreadsheetApp.getUi().showModalDialog(html, 'Timers still running');
}

function showExportDialog() {
  var html = HtmlService.createHtmlOutputFromFile('export-dialog')
    .setWidth(400)
    .setHeight(380);
  SpreadsheetApp.getUi().showModalDialog(html, 'Export timesheet PDF');
}

/** Model for the export dialog: clients + last 12 months + full-year options
 *  (month 0 = whole year). Labels built server-side. */
function getExportModel() {
  var ctx = makeCtx_();
  var tz = ctx.ss.getSpreadsheetTimeZone();
  var periods = [];
  var now = new Date();
  for (var i = 0; i < 12; i++) {
    var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    periods.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      label: Utilities.formatDate(d, tz, 'MMMM yyyy'),
    });
  }
  periods.push({ year: now.getFullYear(), month: 0, label: now.getFullYear() + ' — full year' });
  periods.push({ year: now.getFullYear() - 1, month: 0, label: now.getFullYear() - 1 + ' — full year' });
  return { clients: getClientNames_(ctx), allClients: CFG.allClients, periods: periods };
}

/**
 * Runs the full health-check + stress suite and renders the verdict grouped
 * by section. Expect a ~3-5 minute run — it rebuilds a throwaway tracker and
 * drives every feature end to end. On a slow-Sheets day it self-limits: the
 * tail sections skip (⏭) so cleanup always runs inside the 6-minute ceiling.
 */
function showSmokeTestDialog() {
  renderSuiteDialog_(runSmokeTest(), 'Health check & smoke test');
}

/**
 * Runs ONLY the read-only production health check (~1 min, always finishes) —
 * the everyday "how are things?" instrument. Never writes to the tracker.
 */
function showQuickHealthDialog() {
  renderSuiteDialog_(runQuickHealthCheck(), 'Quick health check');
}

/** Renders a suite verdict (full or quick) into a section-grouped dialog. */
function renderSuiteDialog_(result, title) {
  var esc = function (s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };
  var mins = Math.floor(result.elapsedMs / 60000);
  var secs = Math.round((result.elapsedMs % 60000) / 1000);
  var head = (result.failed === 0 ? '✅ ' : '❌ ') + result.passed + '/' + result.total + ' checks passed';
  if (result.warned) head += ' · ⚠ ' + result.warned + ' warning' + (result.warned === 1 ? '' : 's');
  if (result.skippedSections) head += ' · ⏭ ' + result.skippedSections + ' section(s) skipped (slow Sheets — rerun)';
  head += ' · ' + mins + 'm ' + secs + 's';

  var out = [head, ''];
  result.sections.forEach(function (sec) {
    var mark = sec.failed > 0 ? '✘' : sec.warned > 0 ? '⚠' : '✔';
    out.push(mark + ' ' + sec.name.toUpperCase() + ' — ' + sec.passed + '/' + (sec.passed + sec.failed) +
      (sec.warned ? ' · ' + sec.warned + ' warn' : '') + ' · ' + Math.round(sec.ms / 1000) + 's');
    result.results.forEach(function (r) {
      if (r.section !== sec.name) return;
      if (r.level === 'info') {
        out.push('   ℹ ' + esc(r.name) + ': ' + esc(r.actual));
      } else if (r.level === 'warn') {
        if (!r.ok) out.push('   ⚠ ' + esc(r.name) + ' — ' + esc(r.actual));
      } else {
        out.push('   ' + (r.ok ? '✔ ' : '✘ ') + esc(r.name) + (r.ok ? '' : '  [expected ' + esc(r.expected) + ' | actual ' + esc(r.actual) + ']'));
      }
    });
    out.push('');
  });

  var html = HtmlService.createHtmlOutput(
    '<pre style="font: 12px/1.5 monospace; white-space: pre-wrap;">' + out.join('\n') + '</pre>'
  )
    .setWidth(660)
    .setHeight(480);
  SpreadsheetApp.getUi().showModalDialog(html, title);
}
