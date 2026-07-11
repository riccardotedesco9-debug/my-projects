/**
 * Sync history on a hidden log tab + failure email alerts (deduped per day).
 */
var SyncLog = (function () {
  var LOG_SHEET = '_hike_sync_log';
  var MAX_ROWS = 1000;

  function sheet_() {
    var spreadsheet = SpreadsheetApp.getActive();
    var sh = spreadsheet.getSheetByName(LOG_SHEET);
    if (!sh) {
      sh = spreadsheet.insertSheet(LOG_SHEET, spreadsheet.getSheets().length);
      sh.appendRow(['When', 'Source', 'Result', 'Rows updated', 'Rows added', 'Cells changed', 'Missing from import', 'Message']);
      sh.setFrozenRows(1);
      sh.hideSheet();
    }
    return sh;
  }

  /** @param {{source:string, ok:boolean, stats?:Object, message?:string}} entry */
  function logRun(entry) {
    var sh = sheet_();
    var s = entry.stats || {};
    sh.appendRow([
      new Date(), entry.source, entry.ok ? 'OK' : 'FAILED',
      s.updatedRows || 0, s.appendedRows || 0, s.updatedCells || 0,
      s.missing !== undefined ? s.missing : '',
      entry.message || ''
    ]);
    var extra = sh.getLastRow() - 1 - MAX_ROWS;
    if (extra > 0) sh.deleteRows(2, extra); // trimming OUR log tab only
    Settings.set('LAST_RUN', new Date().toISOString() + ' | ' + entry.source + ' | ' + (entry.ok ? 'OK' : 'FAILED'));
  }

  /** Email the configured alert address about a failure — at most once per reason per day. */
  function alertFailure(reason, detail) {
    var email = Settings.get('ALERT_EMAIL', '');
    logRun({ source: 'alert', ok: false, message: reason + ' — ' + detail });
    if (!email) return;
    var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd');
    var dedupKey = 'ALERTED_' + today + '_' + reason.replace(/\W+/g, '_').slice(0, 40);
    if (Settings.get(dedupKey, '') === 'yes') return;
    Settings.set(dedupKey, 'yes');
    if (MailApp.getRemainingDailyQuota() < 2) return;
    MailApp.sendEmail(email, '[Hike Sync] ' + reason,
      detail + '\n\nSheet: ' + SpreadsheetApp.getActive().getUrl() +
      '\nNothing destructive happened — the sync aborts before writing when it detects a problem.');
  }

  return { logRun: logRun, alertFailure: alertFailure, LOG_SHEET: LOG_SHEET };
})();
