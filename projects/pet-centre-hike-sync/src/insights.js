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
  // Progressive low-stock heat: bands on the STOCK column (the "…_Stock" level, NOT Stock on hand)
  // that get redder as stock falls toward/below each product's REORDER LEVEL. Ordered most-severe
  // FIRST — Google applies the first matching rule, so a deeper band wins. Each reserved colour
  // marks the rule as OURS so re-runs replace rather than stack.
  var STOCK_TIERS = [
    { bg: '#cc0000', abs: 0 },   // out of stock (≤ 0): darkest
    { bg: '#e06666', mul: 0.5 }, // ≤ 50% of reorder: deep red
    { bg: '#f4c7c3', mul: 1 },   // at/below reorder: red
    { bg: '#fce5cd', mul: 1.5 }  // approaching reorder (≤ 1.5×): amber
  ];
  // Colours from this + earlier versions (incl. an old gradient) — recognized so a rebuild removes ours cleanly.
  var STOCK_REDS = ['#cc0000', '#e06666', '#f4c7c3', '#f4cccc', '#fce5cd'];
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
   * Progressive low-stock heat on the STOCK column ONLY (Hike's "…_Stock" = Available stock, NOT
   * "…_Stock on hand"), graded by how far stock has fallen toward/below that product's REORDER
   * LEVEL: amber approaching it (≤1.5×), red at/below, deeper red under half, darkest when out of
   * stock (≤0). EVERY band requires a reorder level > 0 — a product with no reorder level set is
   * never coloured (there's no threshold to judge "low" against). Boolean conditional-format rules
   * (live — they recolour by themselves); most-severe first so the deeper band wins; blank cells
   * stay clean. Also forces the stock + reorder-level columns to a plain integer format so a
   * sheet-applied currency format can't show these unit counts as money (e.g. reorder €3.00), and
   * clears any highlight left on the on-hand column by an earlier version. Removes our previous
   * rules first so re-runs replace rather than stack; user rules are untouched. No-op if there is
   * no stock column.
   */
  function applyLowStockRule_(dataSheet) {
    var lastCol = dataSheet.getLastColumn(), lastRow = dataSheet.getLastRow();
    if (lastCol < 1 || lastRow < 2) return;
    var scan = dataSheet.getRange(1, 1, Math.min(5, lastRow), lastCol).getValues();
    var hr = MergeEngine.findHeaderRow(scan);
    if (hr === -1) return;
    var norm = scan[hr].map(function (h) { return ValueUtils.normHeader(h); });
    // Colour the plain Stock (Available) column — NOT Stock on hand. Detect both: the on-hand
    // column is only located so we can strip any highlight off it (owner wants Stock only).
    var stockCol = findCol_(norm, ['stock'], /_stock$/);
    var onHandCol = findCol_(norm, ['stock on hand', 'on hand'], /_stock on hand$/);
    if (stockCol === -1) stockCol = onHandCol; // fall back only if there's no plain Stock column
    if (stockCol === -1) return;               // no stock column at all → leave existing rules untouched
    var reorderCol = findCol_(norm, ['reorder level'], /_reorder level$/);
    var firstRow = hr + 2, stockA1 = stockCol + 1;
    var sCell = '$' + colLetter_(stockA1) + firstRow;
    var rCell = reorderCol !== -1 ? '$' + colLetter_(reorderCol + 1) + firstRow : null;

    // Count columns → plain integer format (cosmetic; kills a stray currency format on counts).
    var toInt = function (col) {
      if (col !== -1) dataSheet.getRange(firstRow, col + 1, dataSheet.getMaxRows() - firstRow + 1, 1).setNumberFormat('0');
    };
    toInt(stockCol); toInt(reorderCol);

    // Strip our previous rules so re-runs don't stack AND so nothing lingers on the on-hand
    // column from earlier versions: drop (a) any boolean rule in our reserved palette, (b) any
    // single-column gradient (ours), and (c) any single-column rule sitting on the on-hand
    // column. A user's own multi-column / differently-coloured rules are left alone.
    var reds = {}; STOCK_REDS.forEach(function (c) { reds[c] = 1; });
    var onHandA1 = onHandCol !== -1 ? onHandCol + 1 : -1;
    var kept = dataSheet.getConditionalFormatRules().filter(function (r) {
      var rs = r.getRanges();
      var single = rs.length === 1 && rs[0].getNumColumns() === 1;
      var b = r.getBooleanCondition();
      if (b && b.getBackground() && reds[b.getBackground()]) return false;
      if (r.getGradientCondition() && single) return false;
      if (single && onHandA1 !== -1 && rs[0].getColumn() === onHandA1) return false;
      return true;
    });

    // Graded bands on the Stock column, keyed to the reorder level — most-severe FIRST (Google
    // applies the first matching rule, so a deeper band wins). EVERY band needs reorder > 0, so a
    // product with no reorder level set is never coloured (nothing to measure "low" against).
    if (rCell) {
      var range = dataSheet.getRange(firstRow, stockA1, dataSheet.getMaxRows() - firstRow + 1, 1);
      STOCK_TIERS.forEach(function (t) {
        var cond = t.abs !== undefined ? sCell + '<=' + t.abs : sCell + '<=' + rCell + '*' + t.mul;
        var formula = '=AND(' + sCell + '<>"",' + rCell + '>0,' + cond + ')';
        kept.push(SpreadsheetApp.newConditionalFormatRule()
          .whenFormulaSatisfied(formula).setBackground(t.bg).setRanges([range]).build());
      });
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
