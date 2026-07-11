/**
 * Command Center — a single read-only dashboard the operator commands from: current
 * health, recent sync activity, what each menu action does, and the safety rules the
 * sync guarantees. Reads only; every action lives on the Hike Sync menu.
 */
var Dashboard = (function () {
  function ss() { return SpreadsheetApp.getActive(); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /** Gather a health snapshot without mutating anything. */
  function gather_() {
    var dataName = Settings.get('DATA_SHEET_NAME', Settings.DEFAULTS.DATA_SHEET_NAME);
    var sh = ss().getSheetByName(dataName);
    var headerOk = false, productCount = 0;
    if (sh) {
      var values = sh.getDataRange().getValues();
      var hr = MergeEngine.findHeaderRow(values);
      headerOk = hr !== -1;
      if (headerOk) {
        var skuCol = -1;
        values[hr].forEach(function (h, i) { if (ValueUtils.normHeader(h) === 'sku' && skuCol === -1) skuCol = i; });
        for (var r = hr + 1; skuCol !== -1 && r < values.length; r++) {
          if (ValueUtils.normKey(values[r][skuCol])) productCount++;
        }
      }
    }
    var backups = ss().getSheets().filter(function (s) { return s.getName().indexOf(SheetIO.BACKUP_PREFIX) === 0; });
    return {
      dataName: dataName, dataFound: !!sh, headerOk: headerOk, productCount: productCount,
      lastRun: Settings.get('LAST_RUN', 'never'),
      firstApply: Settings.get('FIRST_APPLY_DONE', '') === 'yes',
      watchFolder: Settings.get('WATCH_FOLDER_ID', ''),
      alertEmail: Settings.get('ALERT_EMAIL', ''),
      apiConnected: !!Settings.get('HIKE_CLIENT_ID', ''),
      apiWatermark: Settings.get('HIKE_SYNC_FROM', ''),
      backups: backups.length,
      recent: recentLog_(6)
    };
  }

  function recentLog_(n) {
    var sh = ss().getSheetByName(SyncLog.LOG_SHEET);
    if (!sh || sh.getLastRow() < 2) return [];
    var count = Math.min(n, sh.getLastRow() - 1);
    return sh.getRange(sh.getLastRow() - count + 1, 1, count, 8).getValues().reverse().map(function (row) {
      return { when: row[0], source: row[1], result: row[2], upd: row[3], add: row[4], missing: row[6], msg: row[7] };
    });
  }

  function chip_(label, ok, detail) {
    var color = ok === null ? '#777' : ok ? '#137333' : '#c5221f';
    return '<div class="chip"><span class="dot" style="background:' + color + '"></span><b>' + esc(label) +
      '</b><span class="muted"> ' + esc(detail) + '</span></div>';
  }

  function show() {
    var h = gather_();
    var rows = h.recent.map(function (e) {
      var when = e.when instanceof Date ? Utilities.formatDate(e.when, Session.getScriptTimeZone(), 'dd MMM HH:mm') : esc(e.when);
      var rc = e.result === 'OK' ? '#137333' : '#c5221f';
      return '<tr><td>' + when + '</td><td>' + esc(e.source) + '</td><td style="color:' + rc + '">' + esc(e.result) +
        '</td><td>' + esc(e.upd) + '/' + esc(e.add) + '</td><td class="muted">' + esc(String(e.msg).slice(0, 80)) + '</td></tr>';
    }).join('') || '<tr><td colspan="5" class="muted">No sync runs yet.</td></tr>';

    var html =
      '<style>' +
      'body{font:13px/1.5 system-ui,Segoe UI,Arial;color:#1a2b3c;margin:0;padding:14px}' +
      'h2{color:#12a5a5;margin:2px 0 10px;font-size:16px}h3{margin:16px 0 6px;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#556}' +
      '.chips{display:flex;flex-wrap:wrap;gap:10px 22px;margin:10px 0 2px}.chip{display:flex;align-items:center;min-width:230px}.chip b{margin-right:6px}.dot{width:9px;height:9px;border-radius:50%;display:inline-block;margin-right:7px;flex:0 0 auto}' +
      '.muted{color:#777}table{border-collapse:collapse;width:100%;font-size:12px}td,th{text-align:left;padding:3px 6px;border-bottom:1px solid #eee}th{color:#556}' +
      'ul{margin:4px 0;padding-left:18px}li{margin:2px 0}.rule{background:#f3faf9;border-left:3px solid #12a5a5;padding:8px 10px;border-radius:4px;margin-top:6px}' +
      '</style>' +
      '<h2>Hike Sync — Command Center</h2>' +
      '<div class="chips">' +
        chip_('Data tab', h.dataFound && h.headerOk, h.dataFound ? (h.headerOk ? h.dataName + ' · ' + h.productCount + ' products' : h.dataName + ' (headers not found)') : 'not found — run Setup') +
        chip_('First sync confirmed', h.firstApply, h.firstApply ? 'yes' : 'not yet — run one import from the menu') +
        chip_('Auto API sync', h.apiConnected ? true : null, h.apiConnected ? 'Hike connected' + (h.apiWatermark ? ' · since ' + esc(String(h.apiWatermark).slice(0, 16)) : '') : 'not connected (manual export still works)') +
        chip_('Watch folder', h.watchFolder ? true : null, h.watchFolder ? 'on' : 'off') +
        chip_('Failure alerts', h.alertEmail ? true : null, h.alertEmail ? esc(h.alertEmail) : 'off') +
        chip_('Backups kept', h.backups > 0 ? true : null, h.backups + ' snapshot(s)') +
        chip_('Last run', h.lastRun !== 'never' ? true : null, esc(String(h.lastRun).slice(0, 60))) +
      '</div>' +
      '<h3>Recent activity</h3>' +
      '<table><tr><th>When</th><th>Source</th><th>Result</th><th>upd/add</th><th>Note</th></tr>' + rows + '</table>' +
      '<h3>What each menu action does</h3><ul>' +
        '<li><b>Import Hike export file…</b> — pick a Hike "Export all details" file; preview then apply.</li>' +
        '<li><b>Import newest from watch folder</b> — import the latest export dropped in the watched Drive folder.</li>' +
        '<li><b>Sync from Hike API now</b> — pull changed products from Hike (needs Connect Hike API + a Plus plan).</li>' +
        '<li><b>Turn ON/OFF API auto-sync</b> — schedule the API pull every 15 minutes.</li>' +
        '<li><b>Print price labels…</b> — search products, tick the ones you want, add their barcodes to the labels tab.</li>' +
        '<li><b>Insights charts</b> — build/refresh the summary charts shown to the right of your data.</li>' +
        '<li><b>Show column filters</b> — add filter dropdowns to every column (filter by depleted stock, status, …).</li>' +
        '<li><b>Setup…</b> — set the data tab, optional watch folder, and failure-alert email.</li>' +
        '<li><b>Delete products no longer in Hike…</b> — remove rows flagged "not in last import" (backup + typed DELETE confirm).</li>' +
        '<li><b>Run self-test</b> — sandbox-only safety gauntlet (restores the sheet after).</li>' +
      '</ul>' +
      '<h3>What is guaranteed</h3><div class="rule">' +
        'Hike is the source of truth; this only ever <b>reads</b> Hike and writes into the data tab. ' +
        'It <b>never deletes rows automatically</b> — deletion happens only via the opt-in "Delete products no longer ' +
        'in Hike" action (backup + typed confirmation). The labels tab is written only <b>additively</b> (barcodes ' +
        'appended, backed up first). Every change is previewed on the first run and backed up (hidden ' +
        '<code>_hike_backup_…</code> tabs) before writing. Products missing from an import are kept and flagged, ' +
        'never auto-deleted. On any layout/row mismatch the sync aborts before writing.' +
      '</div>';

    SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(660).setHeight(600), 'Hike Sync — Command Center');
  }

  return { show: show };
})();
