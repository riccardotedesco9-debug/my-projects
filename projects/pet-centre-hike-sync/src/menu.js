/**
 * Container-bound entry points: the Hike Sync menu, trigger handlers, and the
 * OAuth callback. These must be global functions (menus and triggers call by name).
 */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Hike Sync')
    .addItem('Command center', 'menuDashboard')
    .addSeparator()
    .addItem('Import Hike export file…', 'menuImportFile')
    .addItem('Import newest from watch folder', 'menuImportLatest')
    .addSeparator()
    .addItem('Sync from Hike API now', 'menuApiSync')
    .addItem('Connect Hike API…', 'menuConnectHike')
    .addItem('Turn ON API auto-sync (every 15 min)', 'menuEnableAutoSync')
    .addItem('Turn OFF API auto-sync', 'menuDisableAutoSync')
    .addSeparator()
    .addItem('Print price labels…', 'menuPrintLabels')
    .addItem('Refresh charts + stock colours', 'menuInsights')
    .addItem('Show column filters', 'menuFilters')
    .addItem('Fit columns to content', 'menuFitColumns')
    .addItem('Trim empty rows', 'menuTrim')
    .addSeparator()
    .addItem('Setup…', 'menuSetup')
    .addItem('Delete products no longer in Hike…', 'menuPurgeMissing')
    .addSeparator()
    .addItem('Run self-test (sandbox only)', 'menuSelfTest')
    .addToUi();
}

function menuImportFile() { guardedMenu_(function () { CsvImport.importFilePrompt(); }); }
function menuImportLatest() { guardedMenu_(function () { CsvImport.importLatestFromFolder(); }); }
function menuApiSync() { guardedMenu_(function () { HikeApi.syncNow(true); }); }
function menuConnectHike() { guardedMenu_(function () { HikeApi.connectPrompt(); }); }
function menuSetup() { guardedMenu_(function () { Settings.setupWizard(); }); }
function menuDashboard() { guardedMenu_(function () { Dashboard.show(); }); }
function menuSelfTest() { guardedMenu_(function () { SelfTest.run(); }); }
function menuPrintLabels() { guardedMenu_(function () { LabelsPrint.openDialog(); }); }
function menuInsights() { guardedMenu_(function () { Insights.rebuild(true); }); }
function menuFitColumns() {
  guardedMenu_(function () {
    var capped = SheetIO.fitColumns();
    SpreadsheetApp.getUi().alert('Columns fitted',
      'Each column on the DATA SHEET was resized to fit its content' +
      (capped > 0 ? ' (' + capped + ' very wide column(s), e.g. Description, were capped so they don\'t dominate).' : '.') +
      '\n\nRun this again any time after the data changes.', SpreadsheetApp.getUi().ButtonSet.OK);
  });
}
function menuPurgeMissing() { guardedMenu_(function () { PurgeMissing.run(); }); }
function menuFilters() {
  guardedMenu_(function () {
    SheetIO.enableFilters();
    SpreadsheetApp.getUi().alert('Column filters added',
      'Click the filter icon on any column header to filter — including the "Hike Sync Note" column ' +
      '(in Hike / not) and the stock column. Re-run this after new columns or lots of new rows appear.',
      SpreadsheetApp.getUi().ButtonSet.OK);
  });
}
function menuTrim() {
  guardedMenu_(function () {
    var sh = SheetIO.dataSheet();
    var gridBefore = sh.getMaxRows(), content = sh.getLastRow();
    var removed = SheetIO.trimToData();
    SpreadsheetApp.getUi().alert('Trim empty rows',
      'Data tab: ' + content + ' row(s) have content; the grid had ' + gridBefore + ' row(s).\n\n' +
      (removed > 0
        ? 'Removed ' + removed + ' empty trailing row(s) — only blank rows below your data, no data touched.'
        : 'Nothing to remove — the grid already matches the content. If a low row still holds a stray value or formula, Google counts it as "used" and keeps the rows above it.') +
      '\n\nThis trims the DATA tab only; the Hike Insights charts tab sizes itself.',
      SpreadsheetApp.getUi().ButtonSet.OK);
  });
}

function menuEnableAutoSync() {
  guardedMenu_(function () {
    Settings.ensureTrigger('apiSyncTick', 15);
    SpreadsheetApp.getUi().alert('API auto-sync is ON (every 15 minutes, under your account).\n' +
      'It will not write anything until one manual sync has been confirmed.');
  });
}
function menuDisableAutoSync() {
  guardedMenu_(function () {
    Settings.ensureTrigger('apiSyncTick', 0);
    SpreadsheetApp.getUi().alert('API auto-sync is OFF.');
  });
}

/** OAuth2 library redirect target (name referenced by setCallbackFunction). */
function hikeAuthCallback(request) { return HikeApi.handleCallback(request); }

/** Setup form save handler (called from the Setup dialog via google.script.run).
 *  Not guarded — it must throw so the dialog's failure handler can show the error. */
function hikeSaveSetup(form) { return Settings.applySetup(form); }

/** Print-labels dialog handlers (called via google.script.run — must throw on error). */
function hikeCatalog() { return LabelsPrint.catalog(); }
function hikeAddToLabels(barcodes) { return LabelsPrint.addToLabels(barcodes); }

/** Time-trigger handlers — never throw (a crash-loop would spam failure emails). */
function folderWatchTick() {
  try { CsvImport.folderWatchTick(); }
  catch (e) { SyncLog.alertFailure('Watch-folder scan failed', e.message); }
}
function apiSyncTick() {
  try { HikeApi.syncNow(false); }
  catch (e) { SyncLog.alertFailure('API sync failed', e.message); }
}

function guardedMenu_(fn) {
  try { fn(); }
  catch (e) { SpreadsheetApp.getUi().alert('Hike Sync error:\n\n' + e.message); }
}
