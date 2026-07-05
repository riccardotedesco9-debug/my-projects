// build.js — the authoritative layout spec (same role the Excel build script
// had): rebuild_() produces the entire tracker from a blank spreadsheet.
// Also owns one-time setup(), the destructive-rebuild guard, triggers, and
// the Drive folder tree. The API key, once installed, lives only in Script
// Properties (Project Settings → Script Properties).

/**
 * ONE-TIME first run (from the Apps Script editor): builds the active
 * spreadsheet, installs triggers, creates/moves into the Drive folder tree.
 * Running it is what raises the single OAuth consent screen.
 */
function setup() {
  var ss = SpreadsheetApp.getActive();
  rebuild_(ss);
  ensureTriggers_(ss);
  ensureDriveTree_(ss);
  installLocalSecrets_();
  notify_(makeCtx_(), 'Tracker built. Fill rates + emails on the Clients sheet, then start timing.');
}

/**
 * Editor-runnable one-tap: writes any present src/_local-secrets.js values
 * (owner identity + API key) into Script Properties, no rebuild. Run once after
 * dropping the gitignored file; it's a harmless no-op when the file is absent.
 */
function installSecrets() {
  installLocalSecrets_();
}

/**
 * If a gitignored src/_local-secrets.js is present (a drop-in so personal data
 * and keys never touch the public repo), copy its values into Script
 * Properties. A no-op when absent — each typeof guard turns an undefined global
 * into nothing. The file is deleted after, so this quietly does nothing later.
 */
function installLocalSecrets_() {
  var props = PropertiesService.getScriptProperties();
  if (typeof LOCAL_ANTHROPIC_KEY !== 'undefined' && LOCAL_ANTHROPIC_KEY) props.setProperty('ANTHROPIC_API_KEY', LOCAL_ANTHROPIC_KEY);
  if (typeof LOCAL_OWNER_NAME !== 'undefined' && LOCAL_OWNER_NAME) props.setProperty('OWNER_NAME', LOCAL_OWNER_NAME);
  if (typeof LOCAL_OWNER_EMAIL !== 'undefined' && LOCAL_OWNER_EMAIL) props.setProperty('OWNER_EMAIL', LOCAL_OWNER_EMAIL);
  if (typeof LOCAL_OWNER_ID !== 'undefined' && LOCAL_OWNER_ID) props.setProperty('OWNER_ID', LOCAL_OWNER_ID);
}

/** Menu entry — destructive, so it demands a typed confirmation when data exists. */
function rebuildActive() {
  var ss = SpreadsheetApp.getActive();
  var ui = SpreadsheetApp.getUi();
  var log = ss.getSheetByName(CFG.sheets.log);
  var hasData = log && log.getLastRow() >= CFG.log.firstDataRow;
  if (hasData) {
    var resp = ui.prompt(
      'Rebuild tracker',
      'This wipes EVERY sheet — including logged hours. Type REBUILD to confirm.',
      ui.ButtonSet.OK_CANCEL
    );
    if (resp.getSelectedButton() !== ui.Button.OK || resp.getResponseText().trim() !== 'REBUILD') {
      return;
    }
  }
  rebuild_(ss);
  notify_(makeCtx_(), 'Fresh tracker built.');
}

/** Builds a throwaway tracker for the smoke test. Caller must trash it. */
function buildThrowawaySpreadsheet_() {
  var stamp = Utilities.formatDate(new Date(), 'Europe/Malta', 'yyyyMMdd-HHmmss');
  var ss = SpreadsheetApp.create('TEST HoursTracker ' + stamp);
  try {
    rebuild_(ss);
  } catch (e) {
    // Don't leak half-built TEST spreadsheets into Drive on a build failure.
    DriveApp.getFileById(ss.getId()).setTrashed(true);
    throw e;
  }
  return ss;
}

/**
 * Rebuilds the full tracker inside `ss` (production OR throwaway).
 * Deterministic: same input → identical output; safe to run twice.
 * Wrapped in a flush-and-retry: tearing down a heavily-formatted old workbook
 * can trip Google's transient "Service Spreadsheets failed while accessing
 * document" on the first pass. rebuildOnce_ starts by wiping to a clean slate,
 * so a retry is idempotent — the user no longer has to run it twice.
 */
function rebuild_(ss) {
  withSpreadsheetRetry_(function () {
    rebuildOnce_(ss);
  });
}

function rebuildOnce_(ss) {
  ss.setSpreadsheetLocale('en_GB'); // dd/mm/yyyy
  ss.setSpreadsheetTimeZone('Europe/Malta');
  wipeWorkbook_(ss);

  buildClientsSheet_(ss); // first — log validation & dropdowns reference it
  buildLogSheet_(ss);
  buildSettingsSheet_(ss);
  buildReportShell_(ss);
  buildDashboardSheet_(ss);
  buildSummarySheet_(ss);

  refreshStatusBanner_({ ss: ss, prefix: '', silent: true }, idleState_());
  SpreadsheetApp.flush();
}

/**
 * Tears the workbook down to six fresh empty sheets. Removing named ranges and
 * charts BEFORE deleting their host sheets avoids operating on references that
 * dangle off a just-deleted sheet; flushes between phases let the document
 * model settle. Reuses a leftover '__rebuild__' from a crashed run so a retry
 * never hits a duplicate-name insert.
 */
function wipeWorkbook_(ss) {
  ss.getNamedRanges().forEach(function (nr) {
    nr.remove();
  });
  ss.getSheets().forEach(function (sh) {
    sh.getCharts().forEach(function (ch) {
      sh.removeChart(ch);
    });
  });
  var tmp = ss.getSheetByName('__rebuild__') || ss.insertSheet('__rebuild__');
  ss.getSheets().forEach(function (sh) {
    if (sh.getSheetId() !== tmp.getSheetId()) ss.deleteSheet(sh);
  });
  SpreadsheetApp.flush();

  [
    [CFG.sheets.dashboard, CFG.colors.navy],
    [CFG.sheets.log, CFG.colors.teal],
    [CFG.sheets.report, CFG.colors.gold],
    [CFG.sheets.summary, CFG.colors.teal],
    [CFG.sheets.clients, CFG.colors.gray],
    [CFG.sheets.settings, CFG.colors.gray],
  ].forEach(function (t, i) {
    ss.insertSheet(t[0], i).setTabColor(t[1]);
  });
  ss.deleteSheet(tmp);
  SpreadsheetApp.flush();
}

/** Runs fn; on the transient Spreadsheets access error, flush + retry once. */
function withSpreadsheetRetry_(fn) {
  try {
    return fn();
  } catch (e) {
    SpreadsheetApp.flush();
    Utilities.sleep(1500);
    return fn();
  }
}

// ---------- Triggers ----------

/** Idempotent: removes this project's managed triggers, then recreates them. */
function ensureTriggers_(ss) {
  var managed = { onOpenInstallable: true, onEditInstallable: true, monthlyEmailJob: true };
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (managed[t.getHandlerFunction()]) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onOpenInstallable').forSpreadsheet(ss).onOpen().create();
  ScriptApp.newTrigger('onEditInstallable').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('monthlyEmailJob').timeBased().onMonthDay(1).atHour(6).create();
}

// ---------- Drive folder tree ----------
// My Drive/Freelance Hours Tracker/  ← spreadsheet lives here
//   ├── Timesheets/<Client>/         ← exported PDFs
//   └── Client Views/                ← live view-only spreadsheets

function ensureDriveTree_(ss) {
  var root = getOrCreateTopFolder_(CFG.folders.root);
  getOrCreateSubfolder_(root, CFG.folders.timesheets);
  getOrCreateSubfolder_(root, CFG.folders.viewers);
  var file = DriveApp.getFileById(ss.getId());
  var parents = file.getParents();
  var inside = false;
  while (parents.hasNext()) {
    if (parents.next().getId() === root.getId()) inside = true;
  }
  if (!inside) file.moveTo(root);
  return root;
}

function getOrCreateTopFolder_(name) {
  var it = DriveApp.getRootFolder().getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.getRootFolder().createFolder(name);
}

function getOrCreateSubfolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/** Folder that receives a given client's PDFs: …/Timesheets/<Client>/ */
function getTimesheetFolder_(clientLabel) {
  var root = getOrCreateTopFolder_(CFG.folders.root);
  var ts = getOrCreateSubfolder_(root, CFG.folders.timesheets);
  return getOrCreateSubfolder_(ts, clientLabel);
}

function getViewersFolder_() {
  var root = getOrCreateTopFolder_(CFG.folders.root);
  return getOrCreateSubfolder_(root, CFG.folders.viewers);
}
