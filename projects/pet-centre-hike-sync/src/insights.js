/**
 * Insights: at-a-glance charts on their own "Hike Insights" tab (pies top row, bars below,
 * colour legend underneath), plus the live stock colour-grading on the DATA SHEET's stock
 * column. The charts read LIVE aggregate formulas on a hidden helper tab (_hike_insights),
 * so they update by themselves as data changes — a rebuild is only needed when columns
 * physically move. The only marks made on the data tab are the conditional-format bands +
 * number format on the stock/reorder columns and a hover note on the stock header — no
 * data cells are ever written. Rebuilt on demand from the menu and after each sync.
 */
var Insights = (function () {
  var HELPER = '_hike_insights';
  var CHART_IDS_KEY = 'INSIGHTS_CHART_IDS';
  var OVERVIEW_ID_KEY = 'OVERVIEW_SHEET_ID'; // obsolete "Stock overview" tab id — used once to remove it
  var CHARTS_ID_KEY = 'CHARTS_SHEET_ID';     // stored sheetId of our "Hike Insights" tab
  // LIVE low-stock heat on the STOCK ON HAND column: conditional-format bands keyed to how much
  // stock is left as a share of the reorder level (on-hand ÷ reorder). Live — they recolour the
  // instant a value changes. The reorder level is the point where you SHOULD reorder (set above
  // zero for lead time), so nothing colours while stock is ABOVE it (healthy); colour starts AT
  // the reorder point and deepens as stock falls toward empty, using FEW strongly-contrasting
  // shades so each severity reads at a glance. `mul` = ratio ceiling: cell coloured when
  // on-hand ≤ reorder × mul. Most-severe (lowest %) FIRST — Google applies the first match.
  // Anchor meanings — green healthy / yellow reorder-now / orange running-low / red almost-out /
  // dark-red out — with blended in-between shades so one colour transitions subtly into the next
  // instead of flat blanket bands. Still few enough steps that each severity reads at a glance.
  var STOCK_TIERS = [
    { bg: '#7f0000', mul: 0 },        // OUT of stock (0) — dark red
    { bg: '#a32317', mul: 0.15 },     //   ↓ dark-red → red blend
    { bg: '#cc4125', mul: 0.3 },      // ALMOST OUT — red
    { bg: '#e06666', mul: 0.45 },     //   ↓ red → orange blend (soft red)
    { bg: '#ec8e59', mul: 0.6 },      //   ↓ orange-red
    { bg: '#f6b26b', mul: 0.75 },     // RUNNING LOW — orange
    { bg: '#fbcf82', mul: 0.9 },      //   ↓ orange → yellow blend
    { bg: '#ffe599', mul: 1.0 },      // REORDER NOW — at/below the reorder level — yellow
    { bg: '#dbe5a2', mul: 1.25 },     //   ↓ yellow → green blend (just above reorder)
    { bg: '#b6d7a8', catchAll: true } // HEALTHY — comfortably above the reorder level — green
  ];                                  // (no reorder level set → left blank; can't judge health)
  var CHARTS_TAB = 'Hike Insights'; // visible tab that holds the charts (never overlaps the data)
  var LEGEND_ROW = 30; // first row of the colour legend on the charts tab (charts float over ~rows 1–28)

  function num_(v) { var n = ValueUtils.parseNumeric(v); return n === null ? 0 : n; }

  function findCol_(norm, exact, rx) {
    for (var i = 0; i < exact.length; i++) { var k = norm.indexOf(exact[i]); if (k !== -1) return k; }
    if (rx) for (var j = 0; j < norm.length; j++) if (rx.test(norm[j])) return j;
    return -1;
  }

  /** One pass over the data tab → column positions, which charts apply, and the alert stats.
   *  (The chart DATA itself is live formulas — see writeHelper_ — not these snapshots.) */
  function compute_() {
    var values = SheetIO.readAll();
    var hr = MergeEngine.findHeaderRow(values);
    if (hr === -1) throw new Error('Could not find the header row — run Setup and import once first.');
    var norm = values[hr].map(function (h) { return ValueUtils.normHeader(h); });

    var catCol = findCol_(norm, ['category', 'product type', 'type', 'brand'], null);
    var retailCol = findCol_(norm, ['retail price', 'price'], /_retail price$/);
    var costCol = findCol_(norm, ['cost price', 'cost'], /_cost price$/);
    var stockCol = findCol_(norm, ['stock on hand', 'on hand', 'stock'], /_stock on hand$/);
    var reorderCol = findCol_(norm, ['reorder level'], /_reorder level$/);
    var valueBasisCol = costCol !== -1 ? costCol : retailCol; // asset value = stock × cost (fallback retail)

    var byCount = {}, health = { out: 0, low: 0, ok: 0 };
    var bands = [0, 0, 0, 0, 0]; // €0-5, 5-10, 10-20, 20-50, 50+
    var products = 0, totalValue = 0, stockHasData = false;

    for (var r = hr + 1; r < values.length; r++) {
      var row = values[r];
      if (catCol !== -1 && !ValueUtils.normString(row[catCol]) &&
        (norm.indexOf('sku') === -1 || !ValueUtils.normKey(row[norm.indexOf('sku')]))) continue;
      products++;
      var cat = catCol !== -1 ? (ValueUtils.normString(row[catCol]) || '(uncategorised)') : '(all products)';
      byCount[cat] = (byCount[cat] || 0) + 1;

      if (valueBasisCol !== -1 && stockCol !== -1) {
        totalValue += num_(row[stockCol]) * num_(row[valueBasisCol]);
      }
      if (stockCol !== -1) {
        if (ValueUtils.normString(row[stockCol]) !== '') stockHasData = true;
        var onHand = num_(row[stockCol]);
        var reorder = reorderCol !== -1 ? num_(row[reorderCol]) : 0;
        if (onHand <= 0) health.out++;
        else if (reorder > 0 && onHand <= reorder) health.low++; // <= matches the red CF highlight
        else health.ok++;
      }
      if (retailCol !== -1) {
        var p = num_(row[retailCol]);
        bands[p < 5 ? 0 : p < 10 ? 1 : p < 20 ? 2 : p < 50 ? 3 : 4]++;
      }
    }

    return {
      products: products, totalValue: totalValue,
      costBasis: costCol !== -1,
      headerRow: hr,
      cols: { cat: catCol, retail: retailCol, valueBasis: valueBasisCol, stock: stockCol, reorder: reorderCol },
      // An empty placeholder stock column (no data yet) must NOT drive the value/health charts —
      // blanks would read as zero stock. Require the stock column to actually contain values.
      have: { cat: catCol !== -1, value: valueBasisCol !== -1 && stockCol !== -1 && stockHasData, health: stockCol !== -1 && stockHasData, price: retailCol !== -1 },
      mixCount: Object.keys(byCount).length,
      health: health, bands: bands
    };
  }

  /**
   * Plant LIVE aggregate formulas on the hidden helper tab; return each table's range. The
   * charts read these ranges, and because the cells are formulas over the data tab (QUERY /
   * SUMPRODUCT / COUNTIFS), the charts update BY THEMSELVES as values change — no refresh
   * needed. A rebuild is only required when columns physically move (it re-derives the
   * references). Category text arrives as QUERY RESULTS (evaluated values, never entered as
   * cell input), so a product name starting with '=' cannot become a formula here.
   */
  function writeHelper_(agg) {
    var ss = SpreadsheetApp.getActive();
    var sh = ss.getSheetByName(HELPER);
    if (!sh) { sh = ss.insertSheet(HELPER, ss.getSheets().length); sh.hideSheet(); }
    sh.clearContents();
    var dataName = "'" + Settings.get('DATA_SHEET_NAME', Settings.DEFAULTS.DATA_SHEET_NAME).replace(/'/g, "''") + "'";
    var fr = agg.headerRow + 2; // first data row, 1-based; ranges are open-ended so new rows count
    var colRange = function (i) { var L = colLetter_(i + 1); return dataName + '!' + L + fr + ':' + L; };
    var ranges = {};

    // Inventory value by category: top 10 by stock × cost (fallback retail). Array literal +
    // ARRAYFORMULA does the per-row multiply QUERY can't; N() coerces blanks/text to 0.
    if (agg.have.value) {
      sh.getRange(1, 1, 1, 2).setValues([['Category', 'Inventory value (€)']]);
      sh.getRange(2, 1).setFormula(
        '=IFERROR(QUERY({' + colRange(agg.cols.cat) + ',ARRAYFORMULA(N(' + colRange(agg.cols.stock) + ')*N(' + colRange(agg.cols.valueBasis) + '))},' +
        '"select Col1, sum(Col2) where Col1 <> \'\' group by Col1 order by sum(Col2) desc limit 10", 0),)');
      ranges.value = sh.getRange(2, 1, 10, 2);
    }
    // Product mix: top 8 categories by product count.
    if (agg.have.cat) {
      sh.getRange(1, 4, 1, 2).setValues([['Type', 'Products']]);
      sh.getRange(2, 4).setFormula(
        '=IFERROR(QUERY({' + colRange(agg.cols.cat) + '},' +
        '"select Col1, count(Col1) where Col1 <> \'\' group by Col1 order by count(Col1) desc limit 8", 0),)');
      ranges.mix = sh.getRange(2, 4, 8, 2);
    }
    // Stock health: out (numeric ≤ 0) / at-below reorder / healthy — mirrors the cell colours.
    if (agg.have.health) {
      var S = colRange(agg.cols.stock);
      var R = agg.cols.reorder !== -1 ? colRange(agg.cols.reorder) : null;
      sh.getRange(1, 7, 4, 1).setValues([['Stock status'], ['Out of stock'], ['At/below reorder'], ['Healthy']]);
      sh.getRange(1, 8).setValue('Products');
      sh.getRange(2, 8).setFormula('=SUMPRODUCT(ISNUMBER(' + S + ')*(' + S + '<=0))');
      sh.getRange(3, 8).setFormula(R
        ? '=SUMPRODUCT(ISNUMBER(' + S + ')*(' + S + '>0)*ISNUMBER(' + R + ')*(' + R + '>0)*(' + S + '<=' + R + '))'
        : '=0');
      sh.getRange(4, 8).setFormula('=SUMPRODUCT(ISNUMBER(' + S + ')*(' + S + '>0))-H3');
      ranges.health = sh.getRange(2, 7, 3, 2);
    }
    // Price bands: live COUNTIFS on the retail column (blank/text cells aren't counted).
    if (agg.have.price) {
      var P = colRange(agg.cols.retail);
      sh.getRange(1, 10, 6, 1).setValues([['Price band'], ['€0–5'], ['€5–10'], ['€10–20'], ['€20–50'], ['€50+']]);
      sh.getRange(1, 11).setValue('Products');
      sh.getRange(2, 11).setFormula('=COUNTIF(' + P + ',"<5")');
      sh.getRange(3, 11).setFormula('=COUNTIFS(' + P + ',">=5",' + P + ',"<10")');
      sh.getRange(4, 11).setFormula('=COUNTIFS(' + P + ',">=10",' + P + ',"<20")');
      sh.getRange(5, 11).setFormula('=COUNTIFS(' + P + ',">=20",' + P + ',"<50")');
      sh.getRange(6, 11).setFormula('=COUNTIF(' + P + ',">=50")');
      ranges.bands = sh.getRange(2, 10, 5, 2);
    }
    SpreadsheetApp.flush();
    return ranges;
  }

  function sheetById_(ss, id) {
    id = String(id);
    var arr = ss.getSheets();
    for (var i = 0; i < arr.length; i++) if (String(arr[i].getSheetId()) === id) return arr[i];
    return null;
  }

  /** Does an existing same-named tab clearly belong to THIS tool (a leftover from an older
   *  version), vs. a user tab that merely shares the name? Our charts tab is floating charts
   *  over an empty grid — or over nothing but our own legend block. */
  function isOurTab_(sheet) {
    if (sheet.getCharts().length === 0) return false;
    if (sheet.getLastRow() <= 1) return true;
    var marker = sheet.getMaxRows() >= LEGEND_ROW ? String(sheet.getRange(LEGEND_ROW, 1).getValue()) : '';
    return marker.indexOf('Stock colour legend') === 0;
  }

  /**
   * Get (or create) one of the tool's own visible output tabs. Reuse is keyed on a STORED sheetId
   * so refresh reuses the SAME tab in place (never spawns duplicates). If the id is gone but a
   * same-named tab exists, we reuse it only when it's recognizably ours (isOurTab_) — a user tab
   * that merely shares the name is left untouched and a distinctly-suffixed tab is created
   * instead, so we never clear someone's data (invariant #1). Never adopts the data/helper tab.
   */
  function ownTab_(name, idKey) {
    var ss = SpreadsheetApp.getActive();
    var dataName = Settings.get('DATA_SHEET_NAME', Settings.DEFAULTS.DATA_SHEET_NAME);
    var reserved = function (sh) { return sh.getName() === dataName || /^_hike_/.test(sh.getName()); };
    var stored = Settings.get(idKey, '');
    if (stored) { var byId = sheetById_(ss, stored); if (byId && !reserved(byId)) return byId; }
    var same = ss.getSheetByName(name), sh;
    if (same && !reserved(same) && isOurTab_(same)) {
      sh = same; // reclaim our own tab from an older (untracked) version — reset happens by caller
    } else {
      var nm = name, n = 2;
      while (ss.getSheetByName(nm)) { nm = name + ' ' + n; n++; }
      sh = ss.insertSheet(nm, ss.getSheets().length);
    }
    Settings.set(idKey, String(sh.getSheetId()));
    return sh;
  }
  function chartsTab_() { return ownTab_(CHARTS_TAB, CHARTS_ID_KEY); }

  /**
   * Housekeeping before a rebuild: remove the now-retired "Stock overview" tab (inventory lives
   * on the DATA SHEET itself now) and any leftover numbered "Hike Insights N" duplicate from an
   * older version. Never touches the data tab or our currently-tracked charts tab.
   */
  function cleanupDuplicateTabs_() {
    var ss = SpreadsheetApp.getActive();
    var dataName = Settings.get('DATA_SHEET_NAME', Settings.DEFAULTS.DATA_SHEET_NAME);
    var trackedCharts = String(Settings.get(CHARTS_ID_KEY, ''));
    var removed = false;
    ss.getSheets().forEach(function (s) {
      var id = String(s.getSheetId());
      if (s.getName() === dataName || id === trackedCharts) return;
      if (/^Stock overview( \d+)?$/.test(s.getName()) || /^Hike Insights \d+$/.test(s.getName())) {
        try { ss.deleteSheet(s); removed = true; } catch (e) { /* ignore */ }
      }
    });
    if (removed) Settings.remove(OVERVIEW_ID_KEY);
  }

  /** Make the DATA SHEET the inventory home: freeze the header row + the Name column so the key
   *  product name stays visible while scanning the (wide) export. View-only, non-destructive. */
  function focusDataSheet_(sh) {
    try {
      var lastCol = sh.getLastColumn(), lastRow = sh.getLastRow();
      if (lastCol < 1 || lastRow < 1) return;
      var hr = MergeEngine.findHeaderRow(sh.getRange(1, 1, Math.min(5, lastRow), lastCol).getValues());
      if (hr === -1) return;
      if (sh.getFrozenRows() < hr + 1) sh.setFrozenRows(hr + 1);
      if (sh.getFrozenColumns() < 1) sh.setFrozenColumns(1);
    } catch (e) { /* view convenience — best effort */ }
  }

  function addChart_(sheet, type, range, title, offX, offY) {
    var isPie = type === Charts.ChartType.PIE;
    var b = sheet.newChart().setChartType(type).addRange(range)
      .setPosition(1, 1, offX, offY) // anchor A1 + pixel offset → exact tiling, independent of col widths
      .setOption('title', title) // tab is already named "Hike Insights" — no redundant prefix, less truncation
      .setOption('titleTextStyle', { fontSize: 13 })
      .setOption('width', 440).setOption('height', 280)
      .setOption('legend', { position: isPie ? 'right' : 'none' });
    if (isPie) b.setOption('pieSliceText', 'percentage'); // % on each slice — more info, no clutter
    else b.setOption('annotations', { alwaysOutside: true }).setOption('bar', { groupWidth: '72%' });
    sheet.insertChart(b.build());
  }

  function colLetter_(n) { // 1-based column index → A1 letters (handles AA, AB, …)
    var s = '';
    while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }

  /**
   * LIVE low-stock heat on the STOCK ON HAND column: conditional-format bands (they recolour the
   * instant a value changes) keyed to how much stock is left as a share of the REORDER LEVEL
   * (on-hand ÷ reorder). Few strongly-contrasting shades so each severity is obvious at a glance —
   * yellow "getting low" → orange "running low" → red "almost out" → dark red "out". Products with
   * no reorder level set are left clean (no threshold to judge "low" against); most-severe band
   * first so the deeper one wins; blank cells stay clean. Also forces the stock + reorder-level
   * count columns to a plain integer format (kills a stray currency format showing counts as
   * money), clears any cell fill a prior (non-live) version painted, and strips any conditional-
   * format rule an earlier version left on the stock columns. No-op if there's no stock column.
   */
  function applyLowStockRule_(dataSheet) {
    var lastCol = dataSheet.getLastColumn(), lastRow = dataSheet.getLastRow();
    if (lastCol < 1 || lastRow < 2) return;
    var scan = dataSheet.getRange(1, 1, Math.min(5, lastRow), lastCol).getValues();
    var hr = MergeEngine.findHeaderRow(scan);
    if (hr === -1) return;
    var norm = scan[hr].map(function (h) { return ValueUtils.normHeader(h); });
    // Highlight the STOCK ON HAND column; also locate the plain Stock (Available) column so any
    // highlight an earlier version left on it can be cleared.
    var onHandCol = findCol_(norm, ['stock on hand', 'on hand'], /_stock on hand$/);
    var availCol = findCol_(norm, ['stock'], /_stock$/);
    var target = onHandCol !== -1 ? onHandCol : availCol; // fall back to Available if no on-hand column
    if (target === -1) return;
    var reorderCol = findCol_(norm, ['reorder level'], /_reorder level$/);
    var firstRow = hr + 2, maxRows = dataSheet.getMaxRows();
    if (lastRow < firstRow) return;
    var nRows = lastRow - firstRow + 1;

    // Count columns → plain number format (kills a stray currency format showing counts as €).
    // '0.###' renders integers as integers but PRESERVES fractional counts — pet stores sell
    // loose goods by weight, so a stock of 2.5 kg must not display rounded to "3".
    var toInt = function (col) {
      if (col !== -1) dataSheet.getRange(firstRow, col + 1, maxRows - firstRow + 1, 1).setNumberFormat('0.###');
    };
    toInt(target); toInt(reorderCol);

    // Clear any cell fill a prior (non-live) version painted on the stock columns, so it can't
    // show through where the live rules don't match.
    dataSheet.getRange(firstRow, target + 1, nRows, 1).setBackground(null);
    if (availCol !== -1 && availCol !== target) dataSheet.getRange(firstRow, availCol + 1, nRows, 1).setBackground(null);

    // Strip ONLY rules confined to the stock/on-hand columns so re-runs don't stack and leftovers
    // from earlier versions are cleared. Everything is scoped to those columns — several of our
    // palette hexes are standard Google swatches, so an unscoped palette/gradient match would
    // silently delete a USER's own rule on some other column (e.g. their expiry-date red).
    // The tool owns all formatting on the stock columns (documented in the header note + guide).
    var stockA1s = {};
    if (onHandCol !== -1) stockA1s[onHandCol + 1] = 1;
    if (availCol !== -1) stockA1s[availCol + 1] = 1;
    var kept = dataSheet.getConditionalFormatRules().filter(function (r) {
      var rs = r.getRanges();
      var single = rs.length === 1 && rs[0].getNumColumns() === 1;
      return !(single && stockA1s[rs[0].getColumn()]);
    });

    // Add the LIVE bands on the on-hand column, gated on reorder > 0 (no threshold → no colour).
    if (reorderCol !== -1) {
      var tCell = '$' + colLetter_(target + 1) + firstRow;
      var rCell = '$' + colLetter_(reorderCol + 1) + firstRow;
      var range = dataSheet.getRange(firstRow, target + 1, maxRows - firstRow + 1, 1);
      STOCK_TIERS.forEach(function (t) {
        // catchAll (green) = any NUMERIC cell with a reorder level that no worse band matched
        // (i.e. stock above reorder). Placed last, so first-match leaves it only the healthy rows.
        // ISNUMBER keeps text like "n/a" (which fails every <= band) from grading green.
        var formula = t.catchAll
          ? '=AND(ISNUMBER(' + tCell + '),' + rCell + '>0)'
          : '=AND(' + tCell + '<>"",' + rCell + '>0,' + tCell + '<=' + rCell + '*' + t.mul + ')';
        kept.push(SpreadsheetApp.newConditionalFormatRule()
          .whenFormulaSatisfied(formula).setBackground(t.bg).setRanges([range]).build());
      });
      // Hover note on the column header: what the colours mean, right where they appear.
      dataSheet.getRange(hr + 1, target + 1).setNote(
        'Colour = stock left vs this product\'s reorder level (live):\n' +
        'green healthy · yellow at/below reorder · orange running low · red almost out · dark red out of stock.\n' +
        'Shades blend between these. Rows with no reorder level are not coloured.\n' +
        'Full legend: bottom of the "Hike Insights" tab. (Set by Hike Sync.)');
    }
    dataSheet.setConditionalFormatRules(kept);
  }

  /** Build/refresh the charts. interactive=true shows a confirmation alert at the end. */
  function rebuild(interactive) {
    cleanupDuplicateTabs_();
    var agg = compute_();
    var ranges = writeHelper_(agg);
    var dataSheet = SheetIO.dataSheet();
    var chartsTab = chartsTab_();
    // One-time migration: the earliest version embedded charts in the DATA tab — remove those
    // (by the ids stored then) exactly once.
    if (Settings.get('INSIGHTS_MIGRATED', '') !== 'yes') {
      var stored = {};
      try { JSON.parse(Settings.get(CHART_IDS_KEY, '[]')).forEach(function (id) { stored[id] = 1; }); } catch (e) { /* ignore */ }
      dataSheet.getCharts().forEach(function (c) { if (stored[c.getChartId()]) dataSheet.removeChart(c); });
      Settings.set('INSIGHTS_MIGRATED', 'yes');
    }
    // The charts tab is entirely ours — clear ALL its charts, then rebuild fresh (no id tracking).
    chartsTab.getCharts().forEach(function (c) { chartsTab.removeChart(c); });

    var specs = [];
    if (ranges.value) specs.push([Charts.ChartType.BAR, ranges.value, 'Inventory value by category' + (agg.costBasis ? ' (at cost)' : ' (at retail)')]);
    if (ranges.mix) specs.push([agg.mixCount <= 6 ? Charts.ChartType.PIE : Charts.ChartType.BAR, ranges.mix, 'Product mix by type']);
    if (ranges.health) specs.push([Charts.ChartType.PIE, ranges.health, 'Stock health']);
    if (ranges.bands) specs.push([Charts.ChartType.COLUMN, ranges.bands, 'Price-band distribution']);

    // 2×2 grid anchored at A1 with pixel offsets (chart 440×280 + a 10px gap). Pie charts fill
    // the TOP row, bar/column charts the BOTTOM row (slots run left→right, top→bottom).
    var slots = [[0, 0], [450, 0], [0, 290], [450, 290]];
    var pies = [], bars = [];
    specs.forEach(function (s) { (s[0] === Charts.ChartType.PIE ? pies : bars).push(s); });
    var ordered = pies.concat(bars);
    ordered.forEach(function (s, i) { var p = slots[i] || [0, i * 290]; addChart_(chartsTab, s[0], s[1], s[2], p[0], p[1]); });
    var built = ordered.length;

    writeLegend_(chartsTab);
    // The charts float over the grid; keep just enough rows for them + the legend below — but
    // only trim when nothing sits beneath (if a user typed notes below the legend, leave them).
    var keepRows = LEGEND_ROW + 8;
    if (chartsTab.getMaxRows() > keepRows && chartsTab.getLastRow() <= keepRows) {
      chartsTab.deleteRows(keepRows + 1, chartsTab.getMaxRows() - keepRows);
    }
    try { applyLowStockRule_(dataSheet); } catch (e) { /* highlight is best-effort */ }
    try { focusDataSheet_(dataSheet); } catch (e) { /* freeze is best-effort */ }

    if (interactive) {
      var skipped = [];
      if (!agg.have.value) skipped.push('inventory value (needs a Cost/Retail price + Stock column)');
      if (!agg.have.cat) skipped.push('product mix (needs a Category/Type column)');
      SpreadsheetApp.getUi().alert('Insights updated',
        built + ' chart(s) in the "' + CHARTS_TAB + '" tab (' + agg.products + ' products' +
        (agg.have.value ? ', ~€' + Math.round(agg.totalValue).toLocaleString() + ' inventory value' : '') + ').' +
        '\nStock on hand is colour-graded on the DATA SHEET — green (healthy) through yellow (reorder now) to dark red (out), by each product\'s reorder level. Legend: bottom of the "' + CHARTS_TAB + '" tab.' +
        (skipped.length ? '\n\nSkipped: ' + skipped.join('; ') + '.' : ''), SpreadsheetApp.getUi().ButtonSet.OK);
    }
  }

  /**
   * Small colour legend under the charts: what each DATA-SHEET stock shade means. Written to a
   * fixed block (LEGEND_ROW..+7) that is cleared and rewritten every rebuild; the title doubles
   * as the isOurTab_ marker. Shows the anchor colours only — the in-between blends are implied.
   */
  function writeLegend_(sheet) {
    if (sheet.getMaxRows() < LEGEND_ROW + 7) sheet.insertRowsAfter(sheet.getMaxRows(), LEGEND_ROW + 7 - sheet.getMaxRows());
    if (sheet.getMaxColumns() < 2) sheet.insertColumnsAfter(sheet.getMaxColumns(), 2 - sheet.getMaxColumns());
    var block = sheet.getRange(LEGEND_ROW, 1, 8, 2);
    try { block.breakApart(); } catch (e) { /* not merged yet */ }
    block.clearContent().setBackground(null);
    sheet.getRange(LEGEND_ROW, 1, 1, 2).merge().setValue('Stock colour legend — Stock on hand vs reorder level').setFontWeight('bold');
    var anchor = function (m) { // anchor colour for a ratio ceiling (null = the healthy catch-all)
      for (var i = 0; i < STOCK_TIERS.length; i++) {
        if (m === null ? STOCK_TIERS[i].catchAll : STOCK_TIERS[i].mul === m) return STOCK_TIERS[i].bg;
      }
      return null;
    };
    var rows = [
      [anchor(null), 'Healthy — above the reorder level'],
      [anchor(1.0), 'Reorder now — at/below the reorder level'],
      [anchor(0.75), 'Running low — under ~¾ of the reorder level'],
      [anchor(0.3), 'Almost out — under ~⅓ of the reorder level'],
      [anchor(0), 'Out of stock — none left']
    ];
    rows.forEach(function (r, i) {
      if (r[0]) sheet.getRange(LEGEND_ROW + 1 + i, 1).setBackground(r[0]);
      sheet.getRange(LEGEND_ROW + 1 + i, 2).setValue(r[1]);
    });
    sheet.getRange(LEGEND_ROW + 6, 2)
      .setValue('Shades blend smoothly between these anchors. Products with no reorder level set are not coloured.')
      .setFontColor('#777777');
  }

  return { rebuild: rebuild };
})();
