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
    LABELS_SHEET_NAME: '', // '' = auto-detect the labels tab; set in Setup to pin it explicitly
    BACKUP_KEEP: '3',
    NOTE_COLUMN_HEADER: 'Hike Sync Note',
    IGNORE_UNMATCHED: 'no',
    WATCH_FOLDER_ID: '',
    ALERT_EMAIL: '',
    FIRST_APPLY_DONE: '' // set to 'yes' after the first human-confirmed apply
  };

  /** Every non-_hike_ tab whose top rows carry a Name/SKU/Barcode header row — i.e. every tab that
   *  looks like Hike product data. On a multi-tab sheet there may be more than one; the caller/UI
   *  surfaces that so the right one is chosen deliberately rather than silently taking the first. */
  function dataTabCandidates() {
    var out = [];
    SpreadsheetApp.getActive().getSheets().forEach(function (sh) {
      var name = sh.getName();
      if (/^_hike_/.test(name)) return;
      var rows = Math.min(MergeEngine.HEADER_SCAN_ROWS, sh.getLastRow());
      var cols = sh.getLastColumn();
      if (rows < 1 || cols < 3) return;
      if (MergeEngine.findHeaderRow(sh.getRange(1, 1, rows, cols).getValues()) !== -1) out.push(name);
    });
    return out;
  }

  /**
   * Setup: one self-explaining form (HTML modal) for the preferences the sync needs — which tab
   * holds the product data, which tab is the price-label sheet, an optional auto-import Drive
   * folder, and an optional failure-alert email. It only SAVES preferences; the only structural
   * change the tool ever makes is the additive "Hike Sync Note" status column (added by the sync
   * itself, not here). Saving is done by hikeSaveSetup -> applySetup via google.script.run.
   */
  function setupWizard() {
    var active = SpreadsheetApp.getActive();
    function esc(v) {
      return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    }
    var candidates = dataTabCandidates();          // every tab that looks like product data
    var isCand = {}; candidates.forEach(function (n) { isCand[n] = 1; });
    var detected = candidates[0] || null;
    var chosenData = get('DATA_SHEET_NAME', '') || detected || DEFAULTS.DATA_SHEET_NAME;
    var allTabs = active.getSheets().map(function (s) { return s.getName(); })
      .filter(function (n) { return !/^_hike_/.test(n); });
    var dataOptions = allTabs.map(function (n) {
      return '<option value="' + esc(n) + '"' + (n === chosenData ? ' selected' : '') + '>' +
        esc(n) + (isCand[n] ? ' — looks like product data' : '') + '</option>';
    }).join('');
    var multiWarn = candidates.length > 1
      ? '<p class="warn">' + candidates.length + ' tabs look like product data (' + esc(candidates.join(', ')) +
        '). Pick the real catalog — the sync only ever writes to the one chosen here.</p>' : '';

    // Labels tab: auto-detected suggestion + a chosen/stored value (blank = auto-detect).
    var autoLabels = ''; try { var ls = LabelsPrint.findLabelsSheet(); autoLabels = ls ? ls.getName() : ''; } catch (e) { }
    var chosenLabels = get('LABELS_SHEET_NAME', '');
    var labelsOptions = '<option value=""' + (chosenLabels ? '' : ' selected') + '>(auto-detect' +
      (autoLabels ? ': ' + esc(autoLabels) : '') + ')</option>' +
      allTabs.filter(function (n) { return n !== chosenData; }).map(function (n) {
        return '<option value="' + esc(n) + '"' + (n === chosenLabels ? ' selected' : '') + '>' +
          esc(n) + (n === autoLabels ? ' — looks like your labels tab' : '') + '</option>';
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
      '.warn{background:#fff4e5;border-left:3px solid #e8871e;padding:7px 10px;border-radius:4px;margin:6px 0 0;font-size:12px}' +
      'label{display:block;font-weight:600;margin:16px 0 4px}.opt{font-weight:400;color:#888}' +
      'select,input{width:100%;box-sizing:border-box;padding:6px 8px;font:inherit;border:1px solid #bbb;border-radius:4px}' +
      '.help{color:#777;margin:5px 0 0;font-size:12px}' +
      'button{margin-top:18px;background:#12a5a5;color:#fff;border:0;border-radius:5px;padding:9px 16px;font:inherit;font-weight:600;cursor:pointer}' +
      'button:disabled{opacity:.6;cursor:default}.msg{margin-top:12px;font-size:12px;min-height:16px}' +
      '</style>' +
      '<h2>Hike Sync — Setup</h2>' +
      '<div class="lead">Setup just saves <b>where to work</b>. It does <b>not</b> change your products — ' +
      'the only column the tool ever adds is a "Hike Sync Note" status column, and the first real sync ' +
      'always shows a preview to approve first. Tip: run <b>Preflight check</b> to see what the tool detected.</div>' +

      '<label>1. Which tab holds your product data?</label>' +
      '<select id="tab">' + dataOptions + '</select>' + multiWarn +
      '<p class="help">The tab the sync keeps up to date from Hike (your catalog). Your price-label ' +
      'lookup reads from this tab. Writes only ever go to this tab (plus the tool\'s own hidden tabs).</p>' +

      '<label>2. Which tab is your price-label sheet? <span class="opt">— for Print labels / scanning</span></label>' +
      '<select id="labels">' + labelsOptions + '</select>' +
      '<p class="help">The tab you print price labels from (Barcode + Name/Price). Leave on auto-detect ' +
      'unless the wrong tab is picked. "Set up label scanning" replaces this tab\'s Name/Price columns.</p>' +

      '<label>3. Auto-import folder <span class="opt">— optional</span></label>' +
      '<input id="folder" type="text" value="' + esc(folderPrefill) + '" ' +
      'placeholder="Paste a Google Drive folder link — or leave blank">' +
      '<p class="help">Drop Hike export files into this Drive folder and the newest is imported ' +
      'automatically every few minutes. Leave blank to import by hand from the menu whenever you like.</p>' +

      '<label>4. Failure-alert email <span class="opt">— optional</span></label>' +
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
      'tab:document.getElementById("tab").value,labels:document.getElementById("labels").value,' +
      'folder:document.getElementById("folder").value,' +
      'email:document.getElementById("email").value});}' +
      '<\/script>';

    SpreadsheetApp.getUi().showModalDialog(
      HtmlService.createHtmlOutput(html).setWidth(540).setHeight(660), 'Hike Sync — Setup');
  }

  /** Persist the Setup form (called from the dialog via google.script.run -> hikeSaveSetup). */
  function applySetup(form) {
    form = form || {};
    var tab = ValueUtils.normString(form.tab);
    if (!tab || !SpreadsheetApp.getActive().getSheetByName(tab)) {
      throw new Error('Tab "' + tab + '" was not found — nothing was saved.');
    }
    set('DATA_SHEET_NAME', tab);
    // Optional explicit labels tab ('' = auto-detect). If the owner pinned one, it must exist AND
    // look like a labels tab (Barcode + Name headers) — otherwise the pin would be silently ignored.
    var labels = ValueUtils.normString(form.labels);
    if (labels) {
      if (!SpreadsheetApp.getActive().getSheetByName(labels)) {
        throw new Error('Labels tab "' + labels + '" was not found — nothing was saved.');
      }
      if (LabelsPrint.labelsCandidates().indexOf(labels) === -1) {
        throw new Error('Tab "' + labels + '" doesn\'t look like a labels tab (needs Barcode + Name headers in its top rows) — nothing was saved.');
      }
    }
    set('LABELS_SHEET_NAME', labels);
    var folderId = form.folder ? CsvImport.parseFileId(form.folder) : '';
    set('WATCH_FOLDER_ID', folderId || '');
    set('ALERT_EMAIL', ValueUtils.normString(form.email));
    ensureTrigger_('folderWatchTick', folderId ? 5 : 0);
    return 'Saved. Data tab: "' + tab + '"' +
      (labels ? ', labels tab: "' + labels + '"' : ', labels tab: auto-detect') +
      (folderId ? ', auto-import folder ON (checked every 5 min)' : ', auto-import folder off') +
      (ValueUtils.normString(form.email) ? ', failure alerts on' : '') +
      '. The tool adds only a "Hike Sync Note" status column (your stock/price columns are updated in place). ' +
      'Next: run "Import Hike export file…" — the first run always previews before writing.';
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
    dataTabCandidates: dataTabCandidates,
    setupWizard: setupWizard,
    applySetup: applySetup,
    ensureTrigger: ensureTrigger_
  };
})();
