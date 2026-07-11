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
    .addItem('Insights charts (build / refresh)', 'menuInsights')
    .addItem('Show column filters', 'menuFilters')
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
function menuPurgeMissing() { guardedMenu_(function () { PurgeMissing.run(); }); }
function menuFilters() {
  guardedMenu_(function () {
    SheetIO.enableFilters();
    SpreadsheetApp.getUi().alert('Column filters added',
      'Click the filter icon on any column header to filter — e.g. by depleted stock or status. ' +
      'Re-run this after adding a lot of products to extend the filter to the new rows.', SpreadsheetApp.getUi().ButtonSet.OK);
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
