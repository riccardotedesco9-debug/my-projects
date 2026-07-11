/**
 * Insights: at-a-glance charts embedded on the DATA SHEET, anchored just to the right of
 * the product columns. The aggregates are computed in one pass over the data and written
 * to a hidden helper tab (_hike_insights); the charts read from there. Nothing is written
 * into the data columns themselves, so the sync's row-appends / note column never collide
 * with the charts (which are floating objects) or their source cells (a separate tab).
 * Rebuilt on demand from the menu and refreshed after each successful sync.
 */
var Insights = (function () {
  var HELPER = '_hike_insights';
  var CHART_IDS_KEY = 'INSIGHTS_CHART_IDS';
  var OVERVIEW_ID_KEY = 'OVERVIEW_SHEET_ID'; // obsolete "Stock overview" tab id — used once to remove it
  var CHARTS_ID_KEY = 'CHARTS_SHEET_ID';     // stored sheetId of our "Hike Insights" tab
  // Low-stock heat on the STOCK ON HAND column: a computed, continuous red gradient whose
  // intensity tracks how much stock is left as a share of the product's reorder level
  // (on-hand ÷ reorder). Reddest at 0% (out of stock), fading to no fill at/above LOW_STOCK_CAP.
  // Painted as cell backgrounds because a per-row two-column ratio can't drive Sheets' native
  // colour-scale. Recomputed on each refresh.
  var STOCK_DARK = [153, 0, 0]; // RGB at 0% stock (darkest red); fades to white as the ratio rises
  var LOW_STOCK_CAP = 1.5;      // ratio (on-hand ÷ reorder) at/above which a cell gets no fill
  // Legacy conditional-format colours from earlier versions — recognized so a rebuild strips them.
  var STOCK_REDS = ['#990000', '#cc0000', '#e06666', '#ea9999', '#f4c7c3', '#f9dcd9', '#fce5cd', '#f4cccc'];
  var CHARTS_TAB = 'Hike Insights'; // visible tab that holds the charts (never overlaps the data)

  function num_(v) { var n = ValueUtils.parseNumeric(v); return n === null ? 0 : n; }

  function findCol_(norm, exact, rx) {
    for (var i = 0; i < exact.length; i++) { var k = norm.indexOf(exact[i]); if (k !== -1) return k; }
    if (rx) for (var j = 0; j < norm.length; j++) if (rx.test(norm[j])) return j;
    return -1;
  }

  /** One pass over the data tab → the aggregate tables the charts need. */
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

    var byValue = {}, byCount = {}, health = { out: 0, low: 0, ok: 0 };
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
        var v = num_(row[stockCol]) * num_(row[valueBasisCol]);
        byValue[cat] = (byValue[cat] || 0) + v;
        totalValue += v;
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
      // An empty placeholder stock column (no data yet) must NOT drive the value/health charts —
      // blanks would read as zero stock. Require the stock column to actually contain values.
      have: { cat: catCol !== -1, value: valueBasisCol !== -1 && stockCol !== -1 && stockHasData, health: stockCol !== -1 && stockHasData, price: retailCol !== -1 },
      valueByCat: topN_(byValue, 10), mixByType: topN_(byCount, 8),
      health: health, bands: bands
    };
  }

  /** Sort a {key:number} map desc, keep top n, roll the rest into "Other (k)". */
  function topN_(map, n) {
    var arr = Object.keys(map).map(function (k) { return [k, map[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
    if (arr.length <= n) return arr;
    var head = arr.slice(0, n);
    var rest = arr.slice(n).reduce(function (s, x) { return s + x[1]; }, 0);
    head.push(['Other (' + (arr.length - n) + ')', rest]);
    return head;
  }

  /** Write the aggregate tables to the hidden helper tab; return each table's A1 range. */
  function writeHelper_(agg) {
    var ss = SpreadsheetApp.getActive();
    var sh = ss.getSheetByName(HELPER);
    if (!sh) { sh = ss.insertSheet(HELPER, ss.getSheets().length); sh.hideSheet(); }
    sh.clearContents();
    var ranges = {};
    function put(col, header, rows) {
      var table = [header].concat(rows);
      // Category/type labels are product text from Hike — formulaSafe the label column so a name
      // beginning with =/+/-/@ can't become a live formula in this (auto-evaluated) helper tab.
      var safe = table.map(function (t) { return [ValueUtils.formulaSafe(t[0]), t[1]]; });
      sh.getRange(1, col, safe.length, 2).setValues(safe);
      return sh.getRange(2, col, rows.length, 2); // DATA rows only — keeps the header text out of the chart categories
    }
    if (agg.have.value) ranges.value = put(1, ['Category', 'Inventory value (€)'], agg.valueByCat.length ? agg.valueByCat : [['(no data)', 0]]);
    if (agg.have.cat) ranges.mix = put(4, ['Type', 'Products'], agg.mixByType.length ? agg.mixByType : [['(no data)', 0]]);
    if (agg.have.health) ranges.health = put(7, ['Stock status', 'Products'],
      [['Out of stock', agg.health.out], ['Below reorder', agg.health.low], ['Healthy', agg.health.ok]]);
    if (agg.have.price) ranges.bands = put(10, ['Price band', 'Products'],
      [['€0–5', agg.bands[0]], ['€5–10', agg.bands[1]], ['€10–20', agg.bands[2]], ['€20–50', agg.bands[3]], ['€50+', agg.bands[4]]]);
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
   *  over an empty grid. */
  function isOurTab_(sheet) {
    return sheet.getCharts().length > 0 && sheet.getLastRow() <= 1;
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
   * Low-stock heat on the STOCK ON HAND column: a computed, continuous red gradient whose depth
   * tracks how much stock is left as a share of the product's REORDER LEVEL (on-hand ÷ reorder) —
   * reddest at 0% (out of stock), fading to no fill at/above LOW_STOCK_CAP× reorder. Products with
   * no reorder level set are left clean (no threshold to judge "low" against). Painted as cell
   * backgrounds (a per-row two-column ratio can't drive Sheets' native colour-scale), recomputed
   * each refresh — so it updates on sync/refresh rather than instantly as you type. Also forces the
   * stock + reorder-level count columns to a plain integer format (kills a stray currency format
   * showing counts as money), strips any conditional-format rule an earlier version left on the
   * stock columns, and clears any stale fill on the Available-stock column. No-op if there's no
   * stock column.
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
    var firstRow = hr + 2;
    if (lastRow < firstRow) return;
    var nRows = lastRow - firstRow + 1;

    // Count columns → plain integer format (cosmetic; kills a stray currency format on counts).
    var toInt = function (col) {
      if (col !== -1) dataSheet.getRange(firstRow, col + 1, dataSheet.getMaxRows() - firstRow + 1, 1).setNumberFormat('0');
    };
    toInt(target); toInt(reorderCol);

    // Strip conditional-format rules an earlier version left on the stock columns: any boolean
    // rule in our reserved palette, any single-column gradient, or any single-column rule on the
    // stock / on-hand columns. A user's own multi-column / other-coloured rules are left alone.
    var reds = {}; STOCK_REDS.forEach(function (c) { reds[c] = 1; });
    var stockA1s = {};
    if (onHandCol !== -1) stockA1s[onHandCol + 1] = 1;
    if (availCol !== -1) stockA1s[availCol + 1] = 1;
    var kept = dataSheet.getConditionalFormatRules().filter(function (r) {
      var rs = r.getRanges();
      var single = rs.length === 1 && rs[0].getNumColumns() === 1;
      var b = r.getBooleanCondition();
      if (b && b.getBackground() && reds[b.getBackground()]) return false;
      if (r.getGradientCondition() && single) return false;
      if (single && stockA1s[rs[0].getColumn()]) return false;
      return true;
    });
    dataSheet.setConditionalFormatRules(kept);

    // Clear any stale fill on the Available-stock column (we only paint the target now).
    if (availCol !== -1 && availCol !== target) {
      dataSheet.getRange(firstRow, availCol + 1, nRows, 1).setBackground(null);
    }

    // Paint the target column by ratio (null = no fill).
    var onVals = dataSheet.getRange(firstRow, target + 1, nRows, 1).getValues();
    var reVals = reorderCol !== -1 ? dataSheet.getRange(firstRow, reorderCol + 1, nRows, 1).getValues() : null;
    var bg = [];
    for (var i = 0; i < nRows; i++) bg.push([ratioColor_(onVals[i][0], reVals ? reVals[i][0] : 0)]);
    dataSheet.getRange(firstRow, target + 1, nRows, 1).setBackgrounds(bg);
  }

  /**
   * Red shade for a stock-on-hand cell by how much stock is left vs its reorder level. Returns null
   * (no fill) when there's no reorder level, the cell is blank/non-numeric, or stock is at/above
   * LOW_STOCK_CAP× the reorder level. Otherwise interpolates STOCK_DARK (at 0%) → white (at the cap).
   */
  function ratioColor_(onHand, reorder) {
    var re = ValueUtils.parseNumeric(reorder);
    if (re === null || re <= 0) return null;
    var on = ValueUtils.parseNumeric(onHand);
    if (on === null) return null;
    var ratio = on / re;
    if (ratio >= LOW_STOCK_CAP) return null;
    var f = Math.max(0, Math.min(1, ratio / LOW_STOCK_CAP)); // 0 (empty) → 1 (at cap)
    var chan = function (dark) { return Math.round(dark + (255 - dark) * f); };
    return '#' + hex2_(chan(STOCK_DARK[0])) + hex2_(chan(STOCK_DARK[1])) + hex2_(chan(STOCK_DARK[2]));
  }
  function hex2_(n) { var s = n.toString(16); return s.length < 2 ? '0' + s : s; }

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
    if (ranges.mix) specs.push([agg.mixByType.length <= 6 ? Charts.ChartType.PIE : Charts.ChartType.BAR, ranges.mix, 'Product mix by type']);
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

    // The charts float over the grid, so the Insights tab needs no big empty grid behind them.
    if (chartsTab.getMaxRows() > 34) chartsTab.deleteRows(35, chartsTab.getMaxRows() - 34);
    try { applyLowStockRule_(dataSheet); } catch (e) { /* highlight is best-effort */ }
    try { focusDataSheet_(dataSheet); } catch (e) { /* freeze is best-effort */ }

    if (interactive) {
      var skipped = [];
      if (!agg.have.value) skipped.push('inventory value (needs a Cost/Retail price + Stock column)');
      if (!agg.have.cat) skipped.push('product mix (needs a Category/Type column)');
      SpreadsheetApp.getUi().alert('Insights updated',
        built + ' chart(s) in the "' + CHARTS_TAB + '" tab (' + agg.products + ' products' +
        (agg.have.value ? ', ~€' + Math.round(agg.totalValue).toLocaleString() + ' inventory value' : '') + ').' +
        '\nLow-stock cells are highlighted red on the DATA SHEET.' +
        (skipped.length ? '\n\nSkipped: ' + skipped.join('; ') + '.' : ''), SpreadsheetApp.getUi().ButtonSet.OK);
    }
  }

  return { rebuild: rebuild, HELPER: HELPER };
})();
