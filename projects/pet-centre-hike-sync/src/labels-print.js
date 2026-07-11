/**
 * Print-labels helper: search the product catalog, toggle the items you want, and add
 * them to the LABELS tab. Selected products' BARCODES are written into the LABELS barcode
 * column; the tab's own name/price lookup formulas then fill the rest — so the output
 * always matches the sheet's existing label format. A backup of the LABELS tab is taken
 * before the first write.
 *
 * Search is instant: the whole catalog is loaded ONCE when the dialog opens and filtered
 * in the browser as you type — no per-keystroke server round-trip (which would be far too
 * slow on a catalog of tens of thousands of products).
 */
var LabelsPrint = (function () {
  var CATALOG_MAX = 50000; // payload guard for very large catalogs
  var BACKUP_PREFIX = '_hike_labels_backup_';

  /** The LABELS tab = the non-data, non-hidden tab whose top rows carry Barcode + Name headers. */
  function findLabelsSheet() {
    var dataName = Settings.get('DATA_SHEET_NAME', Settings.DEFAULTS.DATA_SHEET_NAME);
    var sheets = SpreadsheetApp.getActive().getSheets();
    for (var i = 0; i < sheets.length; i++) {
      var sh = sheets[i], n = sh.getName();
      // Skip the data/helper tabs and the tool's OWN visible output tabs (charts / stock overview,
      // including any transient '… 2' duplicate) — they carry Name + Barcode headers too.
      if (n === dataName || /^_hike_/.test(n) || /^(Stock overview|Hike Insights)( \d+)?$/.test(n)) continue;
      if (sh.getLastRow() < 1 || sh.getLastColumn() < 1) continue;
      var scan = sh.getRange(1, 1, Math.min(3, sh.getLastRow()), sh.getLastColumn()).getValues();
      var hasBc = false, hasName = false;
      scan.forEach(function (row) {
        row.forEach(function (cell) {
          var h = ValueUtils.normHeader(cell);
          if (h === 'barcode') hasBc = true;
          if (h === 'name') hasName = true;
        });
      });
      if (hasBc && hasName) return sh;
    }
    return null;
  }

  /** Is the DATA tab's Barcode column stored as NUMBERS? (what the LABELS lookup compares against) */
  function dataBarcodeIsNumeric_() {
    try {
      var sh = SheetIO.dataSheet();
      var lastCol = sh.getLastColumn(), lastRow = sh.getLastRow();
      var scan = sh.getRange(1, 1, Math.min(5, lastRow || 1), lastCol).getValues();
      var hr = MergeEngine.findHeaderRow(scan);
      if (hr === -1) return false;
      var bc = -1;
      scan[hr].forEach(function (h, i) { if (ValueUtils.normHeader(h) === 'barcode' && bc === -1) bc = i; });
      if (bc === -1 || lastRow <= hr + 1) return false;
      var colv = sh.getRange(hr + 2, bc + 1, lastRow - hr - 1, 1).getValues();
      for (var i = 0; i < colv.length; i++) if (colv[i][0] !== '' && colv[i][0] != null) return typeof colv[i][0] === 'number';
      return false;
    } catch (e) { return false; }
  }

  /** Locate the Barcode column + header row on the labels tab (1-based; -1 if absent). */
  function locateCols(sh) {
    var data = sh.getRange(1, 1, Math.min(3, sh.getLastRow()), sh.getLastColumn()).getValues();
    var bcCol = -1, headerRow = -1;
    for (var r = 0; r < data.length && bcCol === -1; r++) {
      for (var c = 0; c < data[r].length; c++) {
        if (ValueUtils.normHeader(data[r][c]) === 'barcode') { bcCol = c + 1; headerRow = r + 1; break; }
      }
    }
    return { bcCol: bcCol, headerRow: headerRow };
  }

  /**
   * Load the whole catalog ONCE for instant client-side search. Returns compact positional
   * rows [name, barcode, price] so the dialog can filter as you type with no server call
   * per keystroke. Capped at CATALOG_MAX to bound the payload on huge catalogs.
   */
  function catalog() {
    var values = SheetIO.readAll();
    var hr = MergeEngine.findHeaderRow(values);
    if (hr === -1) return { rows: [], truncated: false, error: 'No product data found — run Setup and import first.' };
    var norm = values[hr].map(function (h) { return ValueUtils.normHeader(h); });
    var nameCol = norm.indexOf('name'), bcCol = norm.indexOf('barcode');
    var priceCol = norm.indexOf('retail price');
    if (priceCol === -1) for (var i = 0; i < norm.length; i++) if (/_retail price$/.test(norm[i])) { priceCol = i; break; }
    var rows = [], truncated = false;
    for (var r = hr + 1; r < values.length; r++) {
      if (rows.length >= CATALOG_MAX) { truncated = true; break; } // truncated ONLY when we hit the cap
      var name = nameCol !== -1 ? String(values[r][nameCol] == null ? '' : values[r][nameCol]) : '';
      var bc = bcCol !== -1 ? ValueUtils.normString(values[r][bcCol]) : '';
      if (!name && !bc) continue;
      rows.push([name, bc, priceCol !== -1 ? String(values[r][priceCol]) : '']);
    }
    return { rows: rows, truncated: truncated };
  }

  /** Snapshot the labels tab (values + formulas) into a hidden backup; keep the newest 3. */
  function backupLabels_(labels) {
    var ss = SpreadsheetApp.getActive();
    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMdd_HHmmss');
    var name = BACKUP_PREFIX + stamp;
    var old = ss.getSheetByName(name);
    if (old) ss.deleteSheet(old);
    labels.copyTo(ss).setName(name).hideSheet();
    var backups = ss.getSheets().filter(function (s) {
      return new RegExp('^' + BACKUP_PREFIX + '\\d{6}_\\d{6}$').test(s.getName());
    }).sort(function (a, b) { return b.getName().localeCompare(a.getName()); });
    backups.slice(3).forEach(function (s) { ss.deleteSheet(s); });
  }

  /** Add the selected barcodes to the labels tab; its formulas fill in name/price. */
  function addToLabels(barcodes) {
    if (!barcodes || !barcodes.length) throw new Error('No products were selected.');
    var labels = findLabelsSheet();
    if (!labels) throw new Error('Could not find your LABELS tab (it needs Barcode + Name headers in the top rows).');
    var loc = locateCols(labels);
    if (loc.bcCol === -1) throw new Error('Could not find the Barcode column on the LABELS tab.');

    var clean = [], seen = {};
    barcodes.forEach(function (b) { var s = ValueUtils.normString(b); if (s && !seen[s]) { seen[s] = 1; clean.push(s); } });
    if (!clean.length) throw new Error('The selected products have no barcodes to print.');

    var lock = LockService.getDocumentLock();
    if (!lock.tryLock(30000)) throw new Error('Another operation is running — try again in a minute.');
    try {
      backupLabels_(labels);
      var lastRow = labels.getLastRow();
      var start = loc.headerRow + 1, lastNonEmpty = -1;
      if (lastRow >= start) {
        var col = labels.getRange(start, loc.bcCol, lastRow - loc.headerRow, 1).getValues();
        for (var i = 0; i < col.length; i++) if (ValueUtils.normString(col[i][0]) !== '') lastNonEmpty = i;
        if (lastNonEmpty !== -1) start = loc.headerRow + 1 + lastNonEmpty + 1; // append after the last barcode
      }
      var need = start + clean.length - 1;
      if (labels.getMaxRows() < need) labels.insertRowsAfter(labels.getMaxRows(), need - labels.getMaxRows());

      // Copy the lookup formulas (name/price/…) onto the new rows. Template = the last existing
      // barcode row, or (when the barcode column is still empty) the first data row under the
      // header. Skip a column that already auto-extends (ARRAYFORMULA); never overwrite the template.
      var templateRow = lastNonEmpty !== -1 ? start - 1 : (loc.headerRow + 1);
      var fillStart = templateRow === start ? start + 1 : start;
      var fillCount = start + clean.length - fillStart;
      var tf = labels.getRange(templateRow, 1, 1, labels.getLastColumn()).getFormulas()[0];
      for (var c = 0; c < tf.length && fillCount > 0; c++) {
        if (!tf[c] || (c + 1) === loc.bcCol) continue;
        if (labels.getRange(fillStart, c + 1).getFormula()) continue; // already auto-extends
        labels.getRange(templateRow, c + 1).copyTo(labels.getRange(fillStart, c + 1, fillCount, 1));
      }

      // Write barcodes in the storage type the lookup expects. Prefer the labels tab's existing
      // barcode type; if that column is empty, match the DATA tab's barcode type (what the lookup
      // compares against). Numbers for all-digit barcodes; else text (keeps leading zeros).
      var sampleBc = labels.getRange(templateRow, loc.bcCol).getValue();
      var numeric = typeof sampleBc === 'number';
      if (!numeric && ValueUtils.normString(sampleBc) === '') numeric = dataBarcodeIsNumeric_();
      var bcRange = labels.getRange(start, loc.bcCol, clean.length, 1);
      if (numeric) {
        // All-digit barcodes → numbers (what the lookup compares against); a non-digit value is
        // formulaSafe'd so a crafted "barcode" like =HYPERLINK(...) can't land as a live formula.
        bcRange.setValues(clean.map(function (b) { return [/^\d+$/.test(b) ? Number(b) : ValueUtils.formulaSafe(b)]; }));
      } else {
        bcRange.setNumberFormat('@'); // text — preserves leading zeros
        bcRange.setValues(clean.map(function (b) { return [b]; }));
      }
      SpreadsheetApp.flush();
      return clean.length + ' product(s) added to "' + labels.getName() + '" (rows ' + start + '–' + (start + clean.length - 1) +
        '). The tab\'s name/price formulas fill them in. A backup was saved first.';
    } finally {
      lock.releaseLock();
    }
  }

  function openDialog() {
    var ui = SpreadsheetApp.getUi();
    if (!findLabelsSheet()) {
      ui.alert('No labels tab found',
        'This needs a LABELS tab with Barcode + Name headers (the tab your price labels print from).', ui.ButtonSet.OK);
      return;
    }
    var html =
      '<style>' +
      'body{font:13px/1.5 system-ui,Segoe UI,Arial;color:#1a2b3c;margin:0;padding:14px}' +
      'h2{color:#12a5a5;margin:0 0 8px;font-size:16px}' +
      '#q{width:100%;box-sizing:border-box;padding:8px 10px;font:inherit;border:1px solid #bbb;border-radius:6px}' +
      'button{background:#12a5a5;color:#fff;border:0;border-radius:5px;padding:7px 12px;font:inherit;font-weight:600;cursor:pointer}' +
      'button:disabled{opacity:.5;cursor:default}.muted{color:#777;font-size:12px}' +
      '.list{border:1px solid #eee;border-radius:6px;max-height:210px;overflow:auto;margin:8px 0}' +
      '.item{display:flex;align-items:center;gap:8px;padding:5px 8px;border-bottom:1px solid #f2f2f2;cursor:pointer}' +
      '.item:last-child{border-bottom:0}.item:hover{background:#f7fbfb}.item .nm{flex:1}.bc{color:#888;font-size:11px}' +
      '.sel{border-radius:6px;padding:8px;margin-top:6px;max-height:92px;overflow:auto;background:#f3faf9;border:1px solid #d5efec}' +
      '.pill{display:inline-block;background:#12a5a5;color:#fff;border-radius:12px;padding:2px 8px;margin:2px;font-size:12px;cursor:pointer}' +
      '#msg{margin-top:8px;font-size:12px;min-height:15px}' +
      '</style>' +
      '<h2>Print price labels</h2>' +
      '<div class="muted">Start typing — matches appear as you type. Tick the items you want, then add them to the labels tab.</div>' +
      '<input id="q" placeholder="Search by name or barcode…" autocomplete="off" style="margin-top:8px" disabled>' +
      '<div id="results" class="list"><div class="muted" style="padding:8px">Loading catalog…</div></div>' +
      '<div><b>Selected (<span id="cnt">0</span>)</b></div>' +
      '<div id="sel" class="sel muted">Nothing selected yet.</div>' +
      '<div style="margin-top:10px"><button id="add" onclick="addSel()" disabled>Add to labels</button></div>' +
      '<div id="msg"></div>' +
      '<script>' +
      'var all=[],idx=[],sel={};' +
      'var q=document.getElementById("q"),results=document.getElementById("results"),selBox=document.getElementById("sel"),cnt=document.getElementById("cnt"),addBtn=document.getElementById("add"),msg=document.getElementById("msg");' +
      'function esc(s){return String(s==null?"":s).replace(/[&<>\\"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c];});}' +
      'function renderSel(){var k=Object.keys(sel);cnt.textContent=k.length;addBtn.disabled=k.length===0;' +
      'selBox.className=k.length?"sel":"sel muted";' +
      'selBox.innerHTML=k.length?k.map(function(b){return "<span class=\\"pill\\" data-bc=\\""+esc(b)+"\\" title=\\"remove\\">"+esc(sel[b])+" \\u00d7</span>";}).join(""):"Nothing selected yet.";}' +
      'function filter(){var s=q.value.trim().toLowerCase();var out=[],total=0;' +
      'for(var i=0;i<all.length;i++){if(!s||idx[i].indexOf(s)!==-1){total++;if(out.length<50)out.push(all[i]);}}' +
      'if(!out.length){results.innerHTML="<div class=\\"muted\\" style=\\"padding:8px\\">No matches.</div>";return;}' +
      'var h=out.map(function(r){var b=r[1];return "<label class=\\"item\\"><input type=\\"checkbox\\" data-bc=\\""+esc(b)+"\\" data-nm=\\""+esc(r[0])+"\\""+(sel[b]?" checked":"")+"><span class=\\"nm\\">"+esc(r[0])+"<div class=\\"bc\\">"+esc(b)+(r[2]?" \\u00b7 \\u20ac"+esc(r[2]):"")+"</div></span></label>";}).join("");' +
      'if(total>out.length)h+="<div class=\\"muted\\" style=\\"padding:6px 8px\\">Showing "+out.length+" of "+total+" \\u2014 keep typing to narrow.</div>";' +
      'results.innerHTML=h;}' +
      'var t;q.addEventListener("input",function(){clearTimeout(t);t=setTimeout(filter,110);});' +
      'results.addEventListener("change",function(e){var el=e.target;if(el&&el.type==="checkbox"){var b=el.getAttribute("data-bc");if(el.checked)sel[b]=el.getAttribute("data-nm");else delete sel[b];renderSel();}});' +
      'selBox.addEventListener("click",function(e){var p=e.target;if(p&&p.className==="pill"){delete sel[p.getAttribute("data-bc")];renderSel();filter();}});' +
      'function addSel(){addBtn.disabled=true;msg.style.color="#777";msg.textContent="Adding\\u2026";' +
      'google.script.run.withSuccessHandler(function(txt){msg.style.color="#137333";msg.textContent=txt;sel={};renderSel();filter();}).' +
      'withFailureHandler(function(e){msg.style.color="#c5221f";msg.textContent=e.message;addBtn.disabled=false;}).hikeAddToLabels(Object.keys(sel));}' +
      'google.script.run.withSuccessHandler(function(res){if(res.error){results.innerHTML="<div class=\\"muted\\" style=\\"padding:8px\\">"+esc(res.error)+"</div>";return;}' +
      'all=res.rows;idx=all.map(function(r){return (r[0]+" "+r[1]).toLowerCase();});q.disabled=false;q.focus();filter();' +
      'if(res.truncated)msg.textContent="Large catalog — showing the first "+all.length+" products; type to find the rest.";}).' +
      'withFailureHandler(function(e){results.innerHTML="<div class=\\"muted\\" style=\\"padding:8px\\">"+esc(e.message)+"</div>";}).hikeCatalog();' +
      '<\/script>';
    ui.showModalDialog(HtmlService.createHtmlOutput(html).setWidth(520).setHeight(560), 'Print price labels');
  }

  return { findLabelsSheet: findLabelsSheet, locateCols: locateCols, catalog: catalog, addToLabels: addToLabels, openDialog: openDialog };
})();
