/**
 * Preflight: a READ-ONLY "what did the tool detect on this sheet?" report. Writes nothing.
 * It exists so the sheet can be verified before any sync — especially on a client's richer,
 * multi-tab sheet where Claude/clasp aren't available to catch a misfire. Every line is produced
 * by the SAME detectors the real code uses (Settings.dataTabCandidates, MergeEngine.findHeaderRow,
 * Insights.detectColumns, HikeFieldMap.detectOutletPrefix, LabelsPrint.*), so the report equals
 * reality. Verdicts: PASS (fine) · WARN (works, but eyeball it) · CHECK (fix before syncing).
 */
var Preflight = (function () {
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  /** A1 column letter for a 1-based column on a sheet (no letter math). */
  function letter_(sh, col1) { return col1 < 1 ? '—' : sh.getRange(1, col1).getA1Notation().replace(/\d+$/, ''); }

  function row_(verdict, label, detail) {
    var color = verdict === 'PASS' ? '#137333' : verdict === 'WARN' ? '#e8871e' : verdict === 'CHECK' ? '#c5221f' : '#777';
    return '<tr><td style="color:' + color + ';font-weight:700;white-space:nowrap">' + verdict + '</td>' +
      '<td><b>' + esc(label) + '</b></td><td class="muted">' + detail + '</td></tr>';
  }

  function show() {
    var ss = SpreadsheetApp.getActive();
    var rows = [];

    // 1. Manifest / services (a manifest-less paste is otherwise a silent failure).
    var hasDrive = (typeof Drive !== 'undefined'); // advanced service — xlsx conversion
    var hasOAuth = (typeof OAuth2 !== 'undefined'); // library — Hike API OAuth
    var tz = Session.getScriptTimeZone();
    rows.push(row_(hasDrive ? 'PASS' : 'CHECK', 'Drive service (.xlsx import)',
      hasDrive ? 'enabled' : 'MISSING — paste appsscript.json. .xlsx imports fail without it (.csv still works).'));
    rows.push(row_(hasOAuth ? 'PASS' : 'CHECK', 'OAuth2 library (Hike API)',
      hasOAuth ? 'present' : 'MISSING — paste appsscript.json. The API auto-sync lane fails without it (file import still works).'));
    rows.push(row_(tz === 'Europe/Malta' ? 'PASS' : 'WARN', 'Timezone',
      esc(tz) + (tz === 'Europe/Malta' ? '' : ' — expected Europe/Malta (paste appsscript.json). Cosmetic: affects stamp times only.')));

    // 2. DATA tab (+ multi-candidate warning).
    var candidates = Settings.dataTabCandidates();
    var stored = Settings.get('DATA_SHEET_NAME', '');
    var effName = (stored && ss.getSheetByName(stored)) ? stored : (candidates[0] || '');
    if (!effName) {
      rows.push(row_('CHECK', 'Data tab', 'No tab has a Name+SKU+Barcode header in its top ' +
        MergeEngine.HEADER_SCAN_ROWS + ' rows. Pick/fix it in Setup.'));
    } else {
      rows.push(row_(candidates.length > 1 ? 'WARN' : 'PASS', 'Data tab',
        '"' + esc(effName) + '"' + (stored ? ' (chosen in Setup)' : ' (auto-detected)') +
        (candidates.length > 1 ? ' — but ' + candidates.length + ' tabs look like product data: ' +
          esc(candidates.join(', ')) + '. Confirm the right one in Setup — writes go only to this tab.' : '')));

      // 3 + 4. Header row + columns on the effective data tab.
      var sh = ss.getSheetByName(effName);
      var lastCol = sh.getLastColumn(), lastRow = sh.getLastRow();
      var scan = sh.getRange(1, 1, Math.min(MergeEngine.HEADER_SCAN_ROWS, lastRow || 1), lastCol).getValues();
      var hr = MergeEngine.findHeaderRow(scan);
      if (hr === -1) {
        rows.push(row_('CHECK', '· Header row', 'not found in the top ' + MergeEngine.HEADER_SCAN_ROWS +
          ' rows of "' + esc(effName) + '". Move the header up or pick the right tab.'));
      } else {
        var headers = scan[hr];
        var norm = headers.map(function (h) { return ValueUtils.normHeader(h); });
        rows.push(row_('PASS', '· Header row', 'row ' + (hr + 1)));
        var cols = Insights.detectColumns(norm);
        var fields = [
          ['Name', norm.indexOf('name'), true], ['SKU', norm.indexOf('sku'), true], ['Barcode', norm.indexOf('barcode'), true],
          ['Retail price', cols.retail, false], ['Cost price', cols.cost, false],
          ['Stock on hand', cols.onHand, false], ['Stock (available)', cols.avail, false], ['Reorder level', cols.reorder, false]
        ];
        fields.forEach(function (f) {
          var i = f[1], required = f[2];
          rows.push(row_(i !== -1 ? 'PASS' : (required ? 'CHECK' : 'WARN'), '· ' + f[0],
            i !== -1 ? 'col ' + letter_(sh, i + 1) + ' — "' + esc(headers[i]) + '"'
              : (required ? 'NOT FOUND — required; imports abort without it' : 'not found — related colour/chart feature is off')));
        });
        var prefix = HikeFieldMap.detectOutletPrefix(headers);
        rows.push(row_(prefix ? 'PASS' : 'WARN', '· Outlet prefix',
          prefix ? '"' + esc(prefix) + '"' + (candidates.length ? '' : '') : 'none — plain (single-outlet) column names'));
      }
    }

    // 5. LABELS tab (+ multi-candidate warning + which columns "Set up label scanning" would touch).
    var labelsCands = LabelsPrint.labelsCandidates();
    var labels = LabelsPrint.findLabelsSheet();
    if (!labels) {
      rows.push(row_('WARN', 'Labels tab', 'none found (needs Barcode + Name headers). Print labels / scanning are unavailable until one is set in Setup.'));
    } else {
      var loc = LabelsPrint.locateCols(labels);
      rows.push(row_(labelsCands.length > 1 ? 'WARN' : 'PASS', 'Labels tab',
        '"' + esc(labels.getName()) + '"' +
        (labelsCands.length > 1 ? ' — ' + labelsCands.length + ' candidates: ' + esc(labelsCands.join(', ')) + '. Pin the right one in Setup.' : '') +
        '. "Set up label scanning" overwrites this tab\'s Name/Price columns (backed up first).'));
      rows.push(row_('PASS', '· Labels columns', 'Barcode ' + letter_(labels, loc.bcCol) +
        ', Name ' + letter_(labels, loc.nameCol) + ', Price ' + letter_(labels, loc.priceCol)));
    }

    // 6. Pre-existing tool tabs (namespace check).
    var hikeTabs = ss.getSheets().map(function (s) { return s.getName(); }).filter(function (n) { return /^_hike_/.test(n); });
    if (hikeTabs.length) rows.push(row_('PASS', 'Tool tabs', esc(hikeTabs.join(', ')) + ' (hidden; created by the tool)'));

    // 7. State.
    var applied = Settings.get('FIRST_APPLY_DONE', '') === 'yes';
    rows.push(row_(applied ? 'PASS' : 'WARN', 'First sync confirmed',
      applied ? 'yes' : 'not yet — the first import shows a preview before writing anything'));

    var html =
      '<style>' +
      'body{font:13px/1.5 system-ui,Segoe UI,Arial;color:#1a2b3c;margin:0;padding:14px}' +
      'h2{color:#12a5a5;margin:0 0 8px;font-size:16px}' +
      '.lead{background:#f3faf9;border-left:3px solid #12a5a5;padding:9px 11px;border-radius:4px;margin:0 0 10px}' +
      'table{border-collapse:collapse;width:100%;font-size:12px}td{text-align:left;padding:4px 8px;border-bottom:1px solid #eee;vertical-align:top}' +
      '.muted{color:#555}' +
      '</style>' +
      '<h2>Hike Sync — Preflight (read-only)</h2>' +
      '<div class="lead">Nothing is written. This is what the tool detected on <b>this</b> sheet — check each line before you sync. ' +
      'The only column the tool ever adds is the "Hike Sync Note" status column; your stock/price columns are updated in place, never duplicated.</div>' +
      '<table>' + rows.join('') + '</table>';
    SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(640).setHeight(620), 'Hike Sync — Preflight');
  }

  return { show: show };
})();
