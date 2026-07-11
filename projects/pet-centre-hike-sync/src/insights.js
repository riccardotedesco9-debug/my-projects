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
  var TITLE = 'Hike Insights: ';
  var LOW_STOCK_RED = '#f4c7c3'; // reserved tint: marks OUR low-stock rule so re-runs don't stack
  var CHARTS_TAB = 'Hike Insights'; // visible tab that holds the charts (never overlaps the data)
  var OVERVIEW_TAB = 'Stock overview'; // visible tab: key columns (name/barcode/price/stock) up front

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
        else if (reorder > 0 && onHand < reorder) health.low++;
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
      sh.getRange(1, col, table.length, 2).setValues(table);
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

  /** Get (or create) the dedicated, visible tab that holds the charts. */
  function chartsTab_() {
    var ss = SpreadsheetApp.getActive();
    return ss.getSheetByName(CHARTS_TAB) || ss.insertSheet(CHARTS_TAB, ss.getSheets().length);
  }

  function clearOurCharts_(dataSheet) {
    var stored = {};
    try { JSON.parse(Settings.get(CHART_IDS_KEY, '[]')).forEach(function (id) { stored[id] = 1; }); } catch (e) { /* ignore */ }
    dataSheet.getCharts().forEach(function (c) { if (stored[c.getChartId()]) dataSheet.removeChart(c); });
  }

  function addChart_(sheet, type, range, title, offX, offY) {
    var chart = sheet.newChart().setChartType(type).addRange(range)
      .setPosition(1, 1, offX, offY) // anchor A1 + pixel offset → exact tiling, independent of col widths
      .setOption('title', TITLE + title)
      .setOption('width', 380).setOption('height', 240)
      .setOption('legend', { position: type === Charts.ChartType.PIE ? 'right' : 'none' })
      .build();
    sheet.insertChart(chart);
  }

  /**
   * Build/refresh the "Stock overview" tab — the key columns (Name, Barcode, Retail price,
   * Stock on hand, Reorder level) pulled LIVE from the data tab via QUERY, so inventory is at
   * the forefront instead of buried among the ~40 export columns. Additive and safe: it only
   * reads the data tab and writes its own tab; it never reorders or touches the data columns
   * (so the LABELS lookups can't break). Red-highlights stock at/below reorder (when stock has data).
   */
  function buildOverview_(agg) {
    var ss = SpreadsheetApp.getActive();
    var dataName = Settings.get('DATA_SHEET_NAME', Settings.DEFAULTS.DATA_SHEET_NAME);
    var data = ss.getSheetByName(dataName);
    if (!data) return;
    var lastCol = data.getLastColumn();
    var scan = data.getRange(1, 1, Math.min(5, data.getLastRow() || 1), lastCol).getValues();
    var hr = MergeEngine.findHeaderRow(scan);
    if (hr === -1) return;
    var norm = scan[hr].map(function (h) { return ValueUtils.normHeader(h); });
    var want = [
      { label: 'Name', idx: findCol_(norm, ['name'], null) },
      { label: 'Barcode', idx: findCol_(norm, ['barcode'], null) },
      { label: 'Retail price', idx: findCol_(norm, ['retail price'], /_retail price$/) },
      { label: 'Stock on hand', idx: findCol_(norm, ['stock on hand', 'on hand', 'stock'], /_stock on hand$/) },
      { label: 'Reorder level', idx: findCol_(norm, ['reorder level'], /_reorder level$/) }
    ].filter(function (c) { return c.idx !== -1; });
    var keyIdx = findCol_(norm, ['sku'], null);
    if (keyIdx === -1) keyIdx = findCol_(norm, ['barcode'], null);
    if (keyIdx === -1 || !want.length) return;

    var ov = ss.getSheetByName(OVERVIEW_TAB) || ss.insertSheet(OVERVIEW_TAB, ss.getSheets().length);
    ov.clearConditionalFormatRules();
    ov.clear();
    // Grow the grid to fit the header + QUERY spill BEFORE writing it, so a catalog that grew
    // since last refresh can't overflow the grid (#REF!). Excess is trimmed after it spills.
    var needRows = ((agg && agg.products) ? agg.products : 0) + 5;
    if (ov.getMaxRows() < needRows) ov.insertRowsAfter(ov.getMaxRows(), needRows - ov.getMaxRows());
    if (ov.getMaxColumns() < want.length) ov.insertColumnsAfter(ov.getMaxColumns(), want.length - ov.getMaxColumns());
    ov.getRange(1, 1, 1, want.length).setValues([want.map(function (c) { return c.label; })]).setFontWeight('bold');
    var sel = want.map(function (c) { return colLetter_(c.idx + 1); }).join(', ');
    var rng = "'" + dataName + "'!A" + (hr + 2) + ':' + colLetter_(lastCol);
    ov.getRange(2, 1).setFormula('=IFERROR(QUERY(' + rng + ', "select ' + sel + ' where ' +
      colLetter_(keyIdx + 1) + ' is not null", 0), "No products yet.")');
    ov.setFrozenRows(1);
    // Size the tab to its real content (Google gives new tabs 1000 rows). Flush first so the
    // QUERY has spilled and getLastRow reflects the true result size.
    SpreadsheetApp.flush();
    var used = Math.max(ov.getLastRow(), 2);
    if (ov.getMaxRows() > used) ov.deleteRows(used + 1, ov.getMaxRows() - used);
    if (ov.getMaxColumns() > want.length) ov.deleteColumns(want.length + 1, ov.getMaxColumns() - want.length);

    // Red low-stock highlight on the overview's own Stock/Reorder columns — only when stock has data.
    var sPos = -1, rPos = -1;
    want.forEach(function (c, i) { if (c.label === 'Stock on hand') sPos = i + 1; if (c.label === 'Reorder level') rPos = i + 1; });
    if (agg && agg.have.health && sPos !== -1 && rPos !== -1) {
      ov.setConditionalFormatRules([SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=AND($' + colLetter_(sPos) + '2<=$' + colLetter_(rPos) + '2,$' + colLetter_(rPos) + '2>0)')
        .setBackground(LOW_STOCK_RED)
        .setRanges([ov.getRange(2, sPos, ov.getMaxRows() - 1, 1)]).build()]);
    }
  }

  function colLetter_(n) { // 1-based column index → A1 letters (handles AA, AB, …)
    var s = '';
    while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }

  /**
   * Live red highlight on the stock column when on-hand ≤ reorder level (both come from Hike).
   * A conditional-format rule (not a per-sync tint) so it updates by itself as values change.
   * Re-applied each rebuild over the full column so later-added rows are covered; identified by
   * its reserved red so re-runs replace rather than stack. No-op if either column is absent.
   */
  function applyLowStockRule_(dataSheet) {
    var lastCol = dataSheet.getLastColumn(), lastRow = dataSheet.getLastRow();
    if (lastCol < 1 || lastRow < 2) return;
    var scan = dataSheet.getRange(1, 1, Math.min(5, lastRow), lastCol).getValues();
    var hr = MergeEngine.findHeaderRow(scan);
    if (hr === -1) return;
    var norm = scan[hr].map(function (h) { return ValueUtils.normHeader(h); });
    var stockCol = findCol_(norm, ['stock on hand', 'on hand', 'stock'], /_stock on hand$/);
    var reorderCol = findCol_(norm, ['reorder level'], /_reorder level$/);
    var kept = dataSheet.getConditionalFormatRules().filter(function (r) {
      var b = r.getBooleanCondition();
      return !b || b.getBackground() !== LOW_STOCK_RED;
    });
    if (stockCol !== -1 && reorderCol !== -1) {
      var firstRow = hr + 2, s = colLetter_(stockCol + 1), rc = colLetter_(reorderCol + 1);
      var range = dataSheet.getRange(firstRow, stockCol + 1, dataSheet.getMaxRows() - firstRow + 1, 1);
      kept.push(SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=AND($' + s + firstRow + '<=$' + rc + firstRow + ',$' + rc + firstRow + '>0)')
        .setBackground(LOW_STOCK_RED).setRanges([range]).build());
    }
    dataSheet.setConditionalFormatRules(kept);
  }

  /** Build/refresh the charts. interactive=true shows a confirmation alert at the end. */
  function rebuild(interactive) {
    var agg = compute_();
    var ranges = writeHelper_(agg);
    var dataSheet = SheetIO.dataSheet();
    var chartsTab = chartsTab_();
    var pre = chartsTab.getCharts().map(function (c) { return c.getChartId(); });
    // One-time migration: earlier versions embedded the charts in the data tab — remove those once.
    if (Settings.get('INSIGHTS_MIGRATED', '') !== 'yes') { clearOurCharts_(dataSheet); Settings.set('INSIGHTS_MIGRATED', 'yes'); }
    clearOurCharts_(chartsTab);

    var specs = [];
    if (ranges.value) specs.push([Charts.ChartType.BAR, ranges.value, 'Inventory value by category' + (agg.costBasis ? ' (at cost)' : ' (at retail)')]);
    if (ranges.mix) specs.push([agg.mixByType.length <= 6 ? Charts.ChartType.PIE : Charts.ChartType.BAR, ranges.mix, 'Product mix by type']);
    if (ranges.health) specs.push([Charts.ChartType.PIE, ranges.health, 'Stock health']);
    if (ranges.bands) specs.push([Charts.ChartType.COLUMN, ranges.bands, 'Price-band distribution']);

    // Tight 2×2 grid anchored at A1 with pixel offsets (chart 380×240 + a 10px gap).
    var slots = [[0, 0], [390, 0], [0, 250], [390, 250]];
    specs.forEach(function (s, i) { var p = slots[i] || [0, i * 250]; addChart_(chartsTab, s[0], s[1], s[2], p[0], p[1]); });
    var built = specs.length;

    var post = chartsTab.getCharts();
    var ours = post.filter(function (c) { return pre.indexOf(c.getChartId()) === -1; }).map(function (c) { return c.getChartId(); });
    Settings.set(CHART_IDS_KEY, JSON.stringify(ours));
    // The charts float over the grid, so the Insights tab needs no big empty grid behind them.
    if (chartsTab.getMaxRows() > 30) chartsTab.deleteRows(31, chartsTab.getMaxRows() - 30);
    try { applyLowStockRule_(dataSheet); } catch (e) { /* highlight is best-effort */ }
    try { buildOverview_(agg); } catch (e) { /* overview is best-effort */ }

    if (interactive) {
      var skipped = [];
      if (!agg.have.value) skipped.push('inventory value (needs a Cost/Retail price + Stock column)');
      if (!agg.have.cat) skipped.push('product mix (needs a Category/Type column)');
      SpreadsheetApp.getUi().alert('Insights updated',
        built + ' chart(s) in the "' + CHARTS_TAB + '" tab + a live "' + OVERVIEW_TAB + '" tab (' + agg.products + ' products' +
        (agg.have.value ? ', ~€' + Math.round(agg.totalValue).toLocaleString() + ' inventory value' : '') + ').' +
        (skipped.length ? '\n\nSkipped: ' + skipped.join('; ') + '.' : ''), SpreadsheetApp.getUi().ButtonSet.OK);
    }
  }

  return { rebuild: rebuild, HELPER: HELPER };
})();
