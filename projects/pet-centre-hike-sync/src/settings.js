/**
 * Per-spreadsheet settings stored in DocumentProperties, plus the Setup wizard.
 * NOTE: properties are readable by anyone with EDIT access to the spreadsheet —
 * keep the sheet's editor list tight (documented in the install guide).
 */
var Settings = (function () {
  function props_() { return PropertiesService.getDocumentProperties(); }

  function get(key, dflt) {
    var v = props_().getProperty(key);
    return v === null ? (dflt === undefined ? '' : dflt) : v;
  }
  function set(key, value) { props_().setProperty(key, String(value)); }
  function remove(key) { props_().deleteProperty(key); }

  var DEFAULTS = {
    DATA_SHEET_NAME: 'DATA SHEET',
    BACKUP_KEEP: '3',
    NOTE_COLUMN_HEADER: 'Hike Sync Note',
    IGNORE_UNMATCHED: 'no',
    WATCH_FOLDER_ID: '',
    ALERT_EMAIL: '',
    FIRST_APPLY_DONE: '' // set to 'yes' after the first human-confirmed apply
  };

  /** Detect which tab looks like the Hike product data tab (has Name/SKU/Barcode headers). */
  function detectDataTab() {
    var sheets = SpreadsheetApp.getActive().getSheets();
    for (var i = 0; i < sheets.length; i++) {
      var name = sheets[i].getName();
      if (/^_hike_/.test(name)) continue;
      var rows = Math.min(5, sheets[i].getLastRow());
      var cols = sheets[i].getLastColumn();
      if (rows < 1 || cols < 3) continue;
      var values = sheets[i].getRange(1, 1, rows, cols).getValues();
      if (MergeEngine.findHeaderRow(values) !== -1) return name;
    }
    return null;
  }

  /**
   * Setup: one self-explaining form (HTML modal) for the three preferences the sync needs —
   * which tab holds the product data, an optional auto-import Drive folder, and an optional
   * failure-alert email. It only SAVES preferences; it never touches product data. Saving is
   * done by hikeSaveSetup -> applySetup via google.script.run.
   */
  function setupWizard() {
    var active = SpreadsheetApp.getActive();
    function esc(v) {
      return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    }
    var detected = detectDataTab();
    var chosen = get('DATA_SHEET_NAME', '') || detected || DEFAULTS.DATA_SHEET_NAME;
    var options = active.getSheets().map(function (s) { return s.getName(); })
      .filter(function (n) { return !/^_hike_/.test(n); })
      .map(function (n) {
        return '<option value="' + esc(n) + '"' + (n === chosen ? ' selected' : '') + '>' +
          esc(n) + (n === detected ? ' — looks like your data tab' : '') + '</option>';
      }).join('');

    // Show the watch folder as a clickable link (round-trips through parseFileId on save).
    var folderPrefill = '';
    var savedFolder = get('WATCH_FOLDER_ID', '');
    if (savedFolder) {
      try { folderPrefill = DriveApp.getFolderById(savedFolder).getUrl(); }
      catch (e) { folderPrefill = savedFolder; }
    }

    var html =
      '<style>' +
      'body{font:13px/1.55 system-ui,Segoe UI,Arial;color:#1a2b3c;margin:0;padding:16px}' +
      'h2{color:#12a5a5;margin:0 0 8px;font-size:16px}' +
      '.lead{background:#f3faf9;border-left:3px solid #12a5a5;padding:9px 11px;border-radius:4px;margin:0 0 4px}' +
      'label{display:block;font-weight:600;margin:16px 0 4px}.opt{font-weight:400;color:#888}' +
      'select,input{width:100%;box-sizing:border-box;padding:6px 8px;font:inherit;border:1px solid #bbb;border-radius:4px}' +
      '.help{color:#777;margin:5px 0 0;font-size:12px}' +
      'button{margin-top:18px;background:#12a5a5;color:#fff;border:0;border-radius:5px;padding:9px 16px;font:inherit;font-weight:600;cursor:pointer}' +
      'button:disabled{opacity:.6;cursor:default}.msg{margin-top:12px;font-size:12px;min-height:16px}' +
      '</style>' +
      '<h2>Hike Sync — Setup</h2>' +
      '<div class="lead">Setup just saves <b>three preferences</b> so the sync knows where to work. ' +
      'It does <b>not</b> change your products — the first real sync still shows you a preview to approve.</div>' +

      '<label>1. Which tab holds your product data?</label>' +
      '<select id="tab">' + options + '</select>' +
      '<p class="help">The tab the sync keeps up to date from Hike (your catalog). Your price-label ' +
      'lookup reads from this tab. Normally the one marked above.</p>' +

      '<label>2. Auto-import folder <span class="opt">— optional</span></label>' +
      '<input id="folder" type="text" value="' + esc(folderPrefill) + '" ' +
      'placeholder="Paste a Google Drive folder link — or leave blank">' +
      '<p class="help">Drop Hike export files into this Drive folder and the newest is imported ' +
      'automatically every few minutes. Leave blank to import by hand from the menu whenever you like.</p>' +

      '<label>3. Failure-alert email <span class="opt">— optional</span></label>' +
      '<input id="email" type="text" value="' + esc(get('ALERT_EMAIL', '')) + '" ' +
      'placeholder="you@example.com — or leave blank">' +
      '<p class="help">Emailed only if a sync ever fails or is stopped for safety. Leave blank for none.</p>' +

      '<button id="save" onclick="save()">Save setup</button>' +
      '<div id="msg" class="msg"></div>' +

      '<script>' +
      'function save(){var b=document.getElementById("save");b.disabled=true;' +
      'var m=document.getElementById("msg");m.style.color="#777";m.textContent="Saving\\u2026";' +
      'google.script.run.withSuccessHandler(function(t){m.style.color="#137333";m.textContent=t;' +
      'b.textContent="Saved \\u2713";}).withFailureHandler(function(e){m.style.color="#c5221f";' +
      'm.textContent=e.message;b.disabled=false;}).hikeSaveSetup({' +
      'tab:document.getElementById("tab").value,folder:document.getElementById("folder").value,' +
      'email:document.getElementById("email").value});}' +
      '<\/script>';

    SpreadsheetApp.getUi().showModalDialog(
      HtmlService.createHtmlOutput(html).setWidth(520).setHeight(600), 'Hike Sync — Setup');
  }

  /** Persist the Setup form (called from the dialog via google.script.run -> hikeSaveSetup). */
  function applySetup(form) {
    form = form || {};
    var tab = ValueUtils.normString(form.tab);
    if (!tab || !SpreadsheetApp.getActive().getSheetByName(tab)) {
      throw new Error('Tab "' + tab + '" was not found — nothing was saved.');
    }
    set('DATA_SHEET_NAME', tab);
    // Ensure a stock column exists (additive placeholder if missing) so stock-based insights /
    // low-stock highlighting can work — now if Hike stock is already there, or later. Additive
    // and guarded: it never blocks setup and never touches existing data.
    var stockAdded = false;
    try { stockAdded = SheetIO.ensureStockColumn(); } catch (e) { /* additive — best-effort */ }
    var folderId = form.folder ? CsvImport.parseFileId(form.folder) : '';
    set('WATCH_FOLDER_ID', folderId || '');
    set('ALERT_EMAIL', ValueUtils.normString(form.email));
    ensureTrigger_('folderWatchTick', folderId ? 5 : 0);
    return 'Saved. Data tab: "' + tab + '"' +
      (folderId ? ', auto-import folder ON (checked every 5 min)' : ', auto-import folder off') +
      (ValueUtils.normString(form.email) ? ', failure alerts on' : '') +
      (stockAdded ? '. Added a "Stock on hand" placeholder column for future stock tracking' : '') +
      '. Next: run "Import Hike export file…" — the first run always previews before writing.';
  }

  /**
   * Create (or remove, when everyMinutes=0) the time trigger for a handler,
   * replacing any existing trigger for the same handler to avoid duplicates.
   */
  function ensureTrigger_(handler, everyMinutes) {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === handler) ScriptApp.deleteTrigger(t);
    });
    if (everyMinutes > 0) {
      ScriptApp.newTrigger(handler).timeBased().everyMinutes(everyMinutes).create();
    }
  }

  return {
    get: get,
    set: set,
    remove: remove,
    DEFAULTS: DEFAULTS,
    setupWizard: setupWizard,
    applySetup: applySetup,
    ensureTrigger: ensureTrigger_
  };
})();
