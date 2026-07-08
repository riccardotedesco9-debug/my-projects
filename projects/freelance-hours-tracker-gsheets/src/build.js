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
  // A destructive rebuild wipes the log, so drop any leftover legacy timer blob
  // too — otherwise the one-time migration could resurrect a phantom session.
  try { PropertiesService.getScriptProperties().deleteProperty(CFG.props.state); } catch (e) {}
  notify_(makeCtx_(), 'Fresh tracker built.');
}

/**
 * Dev/demo one-tap: fills the tracker with a rich, realistic dataset — three
 * clients, ~5 months of history, clustered task names (so the AI breakdown +
 * pie have something to group), and deliberate amber-day / midnight-crossing
 * rows — so you can see the dashboard, summary, chart, and PDF export in full.
 * Clears any prior demo rows first, so re-running stays clean. Reached via
 * Maintenance → Load demo data (loadDemoData wraps it with a confirm); "Rebuild
 * tracker" (Maintenance menu) wipes it for real use.
 */
function seedDemoData() {
  var ctx = makeCtx_();
  var ss = ctx.ss;
  var HOUR = 3600000;

  // Three demo clients (shows the dynamic, no-cap dashboard + summary) + rates + emails.
  var demoClients = [
    ['Pet Centre', 18, 'petcentre.demo@example.com'],
    ['Splash Store', 15, 'splashstore.demo@example.com'],
    ['Coastline Cafe', 14, 'coastline.demo@example.com'],
  ];
  ss.getSheetByName(CFG.sheets.clients).getRange(2, 1, demoClients.length, 3).setValues(demoClients);

  // Task pools with intentional clusters (same TYPE, different wording) so the
  // export's AI grouping collapses them into a few named slices.
  var pools = {
    'Pet Centre': ['Restock shelves', 'Stock inventory', 'Shelf restocking', 'Inventory count',
      'Grooming assist', 'Dog grooming', 'Reception cover', 'Front desk cover', 'Clean kennels'],
    'Splash Store': ['Cashier duty', 'Till operation', 'Stock check', 'Restock delivery',
      'Float duty', 'Cash handling', 'Store cleaning', 'Closing shift'],
    'Coastline Cafe': ['Barista shift', 'Coffee service', 'Table service', 'Waiting tables',
      'Food prep', 'Morning prep + open', 'Close + clean'],
  };

  // Clear any prior sessions so re-running doesn't stack duplicates.
  var logSh = ss.getSheetByName(CFG.sheets.log);
  if (logSh.getLastRow() >= CFG.log.firstDataRow) {
    logSh.getRange(CFG.log.firstDataRow, 1, logSh.getLastRow() - 1, CFG.log.lastCol).clearContent();
  }

  var now = new Date();
  var rows = [];
  for (var mBack = 0; mBack <= 4; mBack++) {
    demoClients.forEach(function (c) {
      var pool = pools[c[0]];
      var sessions = 3 + Math.floor(Math.random() * 3); // 3–5 per client per month
      for (var i = 0; i < sessions; i++) {
        var day = 1 + Math.floor(Math.random() * 26);
        var startMin = [0, 15, 30][Math.floor(Math.random() * 3)];
        var start = new Date(now.getFullYear(), now.getMonth() - mBack, day, 8 + Math.floor(Math.random() * 8), startMin, 0);
        var end = new Date(start.getTime() + (2 + Math.floor(Math.random() * 5)) * HOUR); // 2–6h
        rows.push({ start: start.getTime(), end: end.getTime(), client: c[0], task: pool[Math.floor(Math.random() * pool.length)] });
      }
    });
  }

  // Two showcase rows this month: an 8h+ single day (amber) and a session
  // crossing midnight (red date).
  var amberDay = new Date(now.getFullYear(), now.getMonth(), Math.min(now.getDate(), 20), 9, 0, 0);
  rows.push({ start: amberDay.getTime(), end: amberDay.getTime() + 4.5 * HOUR, client: 'Pet Centre', task: 'Stock inventory' });
  rows.push({ start: amberDay.getTime() + 5 * HOUR, end: amberDay.getTime() + 9.5 * HOUR, client: 'Pet Centre', task: 'Restock shelves' });
  var lateNight = new Date(now.getFullYear(), now.getMonth(), Math.min(now.getDate(), 18), 22, 0, 0);
  rows.push({ start: lateNight.getTime(), end: lateNight.getTime() + 3.5 * HOUR, client: 'Splash Store', task: 'Closing shift' });

  rows.sort(function (a, b) { return a.start - b.start; });
  rows.forEach(function (r) {
    appendLogRow_(ctx, r.start, r.end, r.client, r.task);
  });
  SpreadsheetApp.flush();
  logSh.activate();
  notify_(ctx, 'Seeded ' + rows.length + ' demo sessions across 3 clients / 5 months. Rebuild tracker to clear.');
}

/**
 * Menu-safe demo loader (Maintenance → Load demo data): confirms first, since
 * seedDemoData replaces the top client rows and clears the Time Log. Undoable
 * via File → Version history.
 */
function loadDemoData() {
  var ui = SpreadsheetApp.getUi();
  var log = SpreadsheetApp.getActive().getSheetByName(CFG.sheets.log);
  var hasData = log && log.getLastRow() >= CFG.log.firstDataRow;
  var resp = ui.alert(
    'Load demo data',
    'Fills the tracker with 3 sample clients and ~5 months of placeholder sessions so you can see the dashboard, summary charts, PDF export and client views in action.\n\n' +
      'It REPLACES the top client rows and ' + (hasData ? 'CLEARS the current Time Log' : 'fills the empty log') +
      '. Undo anytime via File → Version history.\n\nContinue?',
    ui.ButtonSet.OK_CANCEL
  );
  if (resp === ui.Button.OK) {
    seedDemoData();
    // Demo adds a 3rd client — rebuild the derived sheets so the Summary's
    // client-filter checklist + by-client cards include it (a client added
    // after the sheet was built otherwise has no checkbox until Update layout).
    updateLayout_(SpreadsheetApp.getActive());
  }
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
  trimDerivedGrids_(ss); // shrink the 1000-row default down to content

  paintRunningSurfaces_(makeCtx_({ ss: ss, silent: true }));
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
    [CFG.sheets.summary, CFG.colors.teal],
    [CFG.sheets.clients, CFG.colors.gray],
    [CFG.sheets.report, CFG.colors.gold],
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

/**
 * NON-DESTRUCTIVE update: re-applies the latest layout/formatting WITHOUT
 * wiping your logged data. The Dashboard, Summary, Report and Settings sheets
 * hold no user data, so they're recreated wholesale; the Time Log and Clients
 * sheets (your data) are only reformatted in place. Run this after a code
 * update that changes the sheet layout — your sessions/rates/emails stay put.
 */
function updateLayout() {
  var ss = SpreadsheetApp.getActive();
  updateLayout_(ss);
  ensureTriggers_(ss);
  ensureDriveTree_(ss);
  notify_(makeCtx_(), 'Layout updated to the latest version — your logged data is untouched.');
}

function updateLayout_(ss) {
  ss.setSpreadsheetLocale('en_GB');
  ss.setSpreadsheetTimeZone('Europe/Malta');

  // ORDER MATTERS — the DATA sheets (Clients, Log) are reformatted in place
  // FIRST, before the derived sheets are rebuilt against them. buildLogSheet_
  // performs the one-time v1→v2 column-insert migration (Status@G, Rate→H,
  // Amount→I), and inserting a Log column shifts EVERY cross-sheet reference to
  // the Log. If the Dashboard/Summary were built first (referencing Log Amount
  // at col I), that insert would shift their references onto the empty next
  // column and every earnings figure would read €0. Building the Log to its
  // final v2 shape first — exactly as rebuild_ does — keeps every derived
  // reference correct. Delete the derived sheets before the migration too, so
  // the insert only touches the Log's own per-row formulas.
  ['dashboard', 'summary', 'report', 'settings'].forEach(function (key) {
    var old = ss.getSheetByName(CFG.sheets[key]);
    if (old) ss.deleteSheet(old);
  });

  // buildLogSheet_ clears prior banding first so it's safe to re-run;
  // buildClientsSheet_ only seeds starter clients when the sheet is empty, so
  // real clients are kept. Clients before Log — the Log's client dropdown
  // validation references the Clients sheet.
  buildClientsSheet_(ss);
  buildLogSheet_(ss);

  ss.insertSheet(CFG.sheets.settings);
  buildSettingsSheet_(ss);
  ss.insertSheet(CFG.sheets.report);
  buildReportShell_(ss);
  ss.insertSheet(CFG.sheets.dashboard);
  buildDashboardSheet_(ss);
  ss.insertSheet(CFG.sheets.summary);
  buildSummarySheet_(ss);
  trimDerivedGrids_(ss); // shrink the 1000-row default down to content

  applyTabColorsAndOrder_(ss);
  var ctx = makeCtx_({ ss: ss });
  // Migrate the legacy single-timer blob only for the REAL bound tracker — never
  // when a smoke test drives updateLayout_ on a throwaway (which shares the
  // global Script Properties and would otherwise consume the prod blob).
  if (ss.getId() === SpreadsheetApp.getActive().getId()) migrateLegacyTimerState_(ctx);
  paintRunningSurfaces_(ctx); // repaint the banner + RUNNING NOW from the live rows
  SpreadsheetApp.flush();
}

/** Sets the canonical tab colours + left-to-right order for all six sheets. */
function applyTabColorsAndOrder_(ss) {
  [
    [CFG.sheets.dashboard, CFG.colors.navy],
    [CFG.sheets.log, CFG.colors.teal],
    [CFG.sheets.summary, CFG.colors.teal],
    [CFG.sheets.clients, CFG.colors.gray],
    [CFG.sheets.report, CFG.colors.gold],
    [CFG.sheets.settings, CFG.colors.gray],
  ].forEach(function (t, i) {
    var sh = ss.getSheetByName(t[0]);
    if (!sh) return;
    sh.setTabColor(t[1]);
    ss.setActiveSheet(sh);
    ss.moveActiveSheet(i + 1);
  });
  // Reordering activates each sheet in turn, which un-hides the internal
  // Settings mirror. Re-hide it, and land the user on the Dashboard rather
  // than on Settings (the last sheet the loop left active).
  var dash = ss.getSheetByName(CFG.sheets.dashboard);
  if (dash) ss.setActiveSheet(dash);
  var settings = ss.getSheetByName(CFG.sheets.settings);
  if (settings) settings.hideSheet();
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
