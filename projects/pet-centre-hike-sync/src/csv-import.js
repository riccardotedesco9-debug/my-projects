/**
 * Lane B: read Hike "Export all details" files (.csv or .xlsx) from Drive and feed
 * the sync — via a menu prompt or a watched Drive folder scanned every 5 minutes.
 */
var CsvImport = (function () {
  var FILE_RE = /\.(csv|xlsx|xls)$/i;

  /** Extract a Drive file/folder ID from a raw ID or any Drive URL. */
  function parseFileId(input) {
    var s = ValueUtils.normString(input);
    if (!s) return '';
    var m = s.match(/[-\w]{25,}/);
    return m ? m[0] : '';
  }

  /** Read an export file into {headers, rows} using its own detected header row. */
  function readExport(fileId) {
    var file = DriveApp.getFileById(fileId);
    var name = file.getName();
    var table = (/\.csv$/i.test(name) || /^text\//.test(file.getMimeType()))
      ? readCsv_(file)
      : readViaConversion_(file);
    var headerRow = MergeEngine.findHeaderRow(table);
    if (headerRow === -1) {
      throw new Error('"' + name + '" does not look like a Hike product export (no Name/SKU/Barcode header row found).');
    }
    return { headers: table[headerRow], rows: table.slice(headerRow + 1), fileName: name };
  }

  function readCsv_(file) {
    var text = file.getBlob().getDataAsString('UTF-8').replace(/^﻿/, '');
    return Utilities.parseCsv(text);
  }

  /** Convert xlsx → temporary Google Sheet (Drive advanced service), read it, trash the temp. */
  function readViaConversion_(file) {
    var created = Drive.Files.create(
      { name: '[tmp] hike import — auto-deleted', mimeType: 'application/vnd.google-apps.spreadsheet' },
      file.getBlob()
    );
    try {
      return SpreadsheetApp.openById(created.id).getSheets()[0].getDataRange().getValues();
    } finally {
      DriveApp.getFileById(created.id).setTrashed(true); // our own temp artifact
    }
  }

  /**
   * After a settled FULL file import, seed the API watermark (only when none exists yet) so a
   * later "Sync from Hike API" starts INCREMENTALLY instead of re-downloading the whole catalog
   * (which can exceed the 6-minute limit on a big store). The file's creation time approximates
   * when the export was made; 24h of slack is subtracted so products edited around export time
   * can't slip through the gap — over-fetching is harmless because the merge is idempotent.
   */
  function seedApiWatermark_(file, result) {
    if (!result || (result.reason !== 'applied' && result.reason !== 'nothing-to-do')) return;
    if (Settings.get('HIKE_SYNC_FROM', '')) return; // API lane already has its own watermark
    var t = file.getDateCreated().getTime() - 24 * 3600 * 1000;
    Settings.set('HIKE_SYNC_FROM', new Date(t).toISOString());
  }

  /** Menu: paste a file link/ID → interactive sync with preview. */
  function importFilePrompt() {
    var ui = SpreadsheetApp.getUi();
    var ans = ui.prompt('Import Hike export',
      'Paste the Drive link (or file ID) of the Hike export file (.csv / .xlsx):', ui.ButtonSet.OK_CANCEL);
    if (ans.getSelectedButton() !== ui.Button.OK) return;
    var id = parseFileId(ans.getResponseText());
    if (!id) { ui.alert('Could not find a Drive file ID in that text.'); return; }
    var data = readExport(id);
    var result = SyncRunner.run('file: ' + data.fileName, data, true);
    seedApiWatermark_(DriveApp.getFileById(id), result);
  }

  /** Menu: import the newest export file from the watch folder, interactively. */
  function importLatestFromFolder() {
    var ui = SpreadsheetApp.getUi();
    var folderId = Settings.get('WATCH_FOLDER_ID', '');
    if (!folderId) { ui.alert('No watch folder configured — run Hike Sync → Setup first.'); return; }
    var newest = null;
    var it = DriveApp.getFolderById(folderId).getFiles();
    while (it.hasNext()) {
      var f = it.next();
      if (!FILE_RE.test(f.getName())) continue;
      if (!newest || f.getDateCreated().getTime() > newest.getDateCreated().getTime()) newest = f;
    }
    if (!newest) { ui.alert('No export files (.csv/.xlsx) found in the watch folder.'); return; }
    var data = readExport(newest.getId());
    var result = SyncRunner.run('folder: ' + data.fileName, data, true);
    seedApiWatermark_(newest, result);
  }

  /** Time-trigger handler: process not-yet-imported files, oldest first. */
  function folderWatchTick() {
    var folderId = Settings.get('WATCH_FOLDER_ID', '');
    if (!folderId) return;
    var processed = JSON.parse(Settings.get('PROCESSED_FILES', '[]'));
    var pending = [];
    var it = DriveApp.getFolderById(folderId).getFiles();
    while (it.hasNext()) {
      var f = it.next();
      if (FILE_RE.test(f.getName()) && processed.indexOf(f.getId()) === -1) pending.push(f);
    }
    if (!pending.length) return;
    pending.sort(function (a, b) { return a.getDateCreated().getTime() - b.getDateCreated().getTime(); });

    pending.forEach(function (f) {
      // Mark as processed even on failure so a broken file can't alert-loop every 5 min.
      processed.push(f.getId());
      try {
        var data = readExport(f.getId());
        var result = SyncRunner.run('watch: ' + data.fileName, data, false);
        seedApiWatermark_(f, result);
      } catch (e) {
        SyncLog.alertFailure('Watch-folder import failed', f.getName() + ': ' + e.message);
      }
    });
    Settings.set('PROCESSED_FILES', JSON.stringify(processed.slice(-100)));
  }

  return {
    parseFileId: parseFileId,
    importFilePrompt: importFilePrompt,
    importLatestFromFolder: importLatestFromFolder,
    folderWatchTick: folderWatchTick
  };
})();
