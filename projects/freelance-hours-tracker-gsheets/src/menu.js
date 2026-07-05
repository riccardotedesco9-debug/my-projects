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
    .addSeparator()
    .addItem('▶ Start (Dashboard client/task)', 'startWorkFromSheet')
    .addItem('■ Stop & log', 'stopAndLogFromSheet')
    .addSeparator()
    .addItem('Export timesheet PDF…', 'showExportDialog')
    .addItem('Prepare monthly drafts now', 'monthlyEmailJob')
    .addItem('Create client view…', 'createClientViewerPrompt')
    .addSeparator()
    .addSubMenu(
      ui.createMenu('Maintenance')
        .addItem('Run smoke test', 'showSmokeTestDialog')
        .addItem('Rebuild tracker (destructive)', 'rebuildActive')
    )
    .addToUi();
}

function showAddSessionDialog() {
  var html = HtmlService.createHtmlOutputFromFile('add-session-dialog')
    .setWidth(400)
    .setHeight(440);
  SpreadsheetApp.getUi().showModalDialog(html, 'Add past session');
}

function onOpenInstallable() {
  var ctx = makeCtx_();
  var state = getTimerState_(ctx);
  refreshStatusBanner_(ctx, state);
  try {
    if (state.status === 'RUNNING') {
      showRecoveryDialog_();
    } else {
      showSidebar();
    }
  } catch (e) {
    // No UI surface (mobile app / API open) — state stays authoritative;
    // the prompt simply appears on the next desktop open.
  }
}

function showSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('sidebar').setTitle('⏱ Hours Tracker');
  SpreadsheetApp.getUi().showSidebar(html);
}

function showRecoveryDialog_() {
  var html = HtmlService.createHtmlOutputFromFile('recovery-dialog')
    .setWidth(420)
    .setHeight(260);
  SpreadsheetApp.getUi().showModalDialog(html, 'Timer still running');
}

function showExportDialog() {
  var html = HtmlService.createHtmlOutputFromFile('export-dialog')
    .setWidth(400)
    .setHeight(380);
  SpreadsheetApp.getUi().showModalDialog(html, 'Export timesheet PDF');
}

/** Model for the export dialog: clients + last 12 months (labels built server-side). */
function getExportModel() {
  var ctx = makeCtx_();
  var tz = ctx.ss.getSpreadsheetTimeZone();
  var months = [];
  var now = new Date();
  for (var i = 0; i < 12; i++) {
    var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      label: Utilities.formatDate(d, tz, 'MMMM yyyy'),
    });
  }
  return { clients: getClientNames_(ctx), allClients: CFG.allClients, months: months };
}

/** Runs the full smoke suite and shows the JSON verdict in a dialog. */
function showSmokeTestDialog() {
  var result = runSmokeTest();
  var esc = function (s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };
  var summary = (result.failed === 0 ? '✅ ' : '❌ ') + result.passed + '/' + result.total + ' assertions passed';
  var lines = result.results
    .map(function (r) {
      return (r.ok ? '✔ ' : '✘ ') + esc(r.name) + (r.ok ? '' : '  [expected ' + esc(r.expected) + ' | actual ' + esc(r.actual) + ']');
    })
    .join('\n');
  var html = HtmlService.createHtmlOutput(
    '<pre style="font: 12px/1.5 monospace; white-space: pre-wrap;">' + summary + '\n\n' + lines + '</pre>'
  )
    .setWidth(560)
    .setHeight(420);
  SpreadsheetApp.getUi().showModalDialog(html, 'Smoke test');
}
