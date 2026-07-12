/**
 * Pure merge planner for the Hike → DATA SHEET sync.
 * Input: the sheet's current values + an incoming product table (Hike export or API
 * pull). Output: a plan of in-place cell updates and row appends. A plan NEVER
 * contains a deletion — products missing from the import are only reported.
 * No Apps Script services here — this file also runs under Node for unit tests.
 */
var MergeEngine = (function () {
  // Lazy cross-file lookup: Apps Script loads files in an order we don't control,
  // and under Node this file is require()d standalone.
  function U() {
    return typeof ValueUtils !== 'undefined' ? ValueUtils : require('./value-utils.js');
  }

  var HEADER_SCAN_ROWS = 5;
  var REQUIRED_HEADERS = ['name', 'sku', 'barcode'];

  /** Find the header row (contains Name+SKU+Barcode) in the first few rows. -1 if absent. */
  function findHeaderRow(values) {
    for (var r = 0; r < Math.min(HEADER_SCAN_ROWS, values.length); r++) {
      var seen = {};
      for (var c = 0; c < values[r].length; c++) seen[U().normHeader(values[r][c])] = true;
      var ok = REQUIRED_HEADERS.every(function (h) { return seen[h]; });
      if (ok) return r;
    }
    return -1;
  }

  /** Map incoming header positions onto sheet column indexes by normalized name. */
  function mapHeaders(sheetHeaders, incomingHeaders) {
    var sheetIndex = {};
    sheetHeaders.forEach(function (h, i) {
      var n = U().normHeader(h);
      if (n && !(n in sheetIndex)) sheetIndex[n] = i;
    });
    var map = [], unmatched = [];
    incomingHeaders.forEach(function (h, i) {
      var n = U().normHeader(h);
      if (!n) { map[i] = -1; return; }
      if (n in sheetIndex) map[i] = sheetIndex[n];
      else { map[i] = -1; unmatched.push(String(h).trim()); }
    });
    return { map: map, unmatched: unmatched, sheetIndex: sheetIndex };
  }

  /** Normalized SKU key (lowercased) or ''. */
  function skuKey(v) { var s = U().normKey(v); return s ? s.toLowerCase() : ''; }
  /** Normalized Barcode key (lowercased) or ''. */
  function bcKey(v) { var s = U().normKey(v); return s ? s.toLowerCase() : ''; }

  /** Combined identity used for de-duplication/reporting: SKU first, Barcode fallback. */
  function rowKey(sku, barcode) {
    var s = skuKey(sku);
    if (s) return 'sku:' + s;
    var b = bcKey(barcode);
    if (b) return 'bc:' + b;
    return '';
  }

  /**
   * Stable signature of a header row for the pre-write layout check: normalized and
   * newline-joined, keeping INTERIOR empties but trimming TRAILING ones. Trailing empties
   * are dropped because getDataRange's trailing-empty width can wobble between reads;
   * interior empties are kept because a mid-sheet blank-header column inserted/removed
   * between the plan build and the write shifts real columns — the write would then land
   * on the wrong column and silently overwrite a user value. Keeping interior positions
   * makes that shift change the signature, so the pre-write guard aborts.
   */
  function headerSignature(headerRow) {
    var norm = (headerRow || []).map(function (h) { return U().normHeader(h); });
    var last = -1;
    for (var i = 0; i < norm.length; i++) if (norm[i] !== '') last = i;
    return norm.slice(0, last + 1).join('\n');
  }

  /** Dominant type of each mapped sheet column, used to type values for new rows. */
  function columnTypes(sheetValues, headerRow, sheetIndex) {
    var types = {};
    Object.keys(sheetIndex).forEach(function (name) {
      var c = sheetIndex[name], num = 0, bool = 0, str = 0;
      for (var r = headerRow + 1; r < sheetValues.length; r++) {
        var v = sheetValues[r][c];
        if (v === '' || v === null || v === undefined) continue;
        if (typeof v === 'number') num++;
        else if (typeof v === 'boolean') bool++;
        else str++;
      }
      types[c] = num > str && num >= bool ? 'number' : bool > str ? 'boolean' : 'string';
    });
    return types;
  }

  /**
   * Build the upsert plan.
   * @param {Array<Array>} sheetValues  full getValues() of the data tab
   * @param {{headers:Array, rows:Array<Array>}} incoming  cells === null/undefined mean
   *        "leave the sheet's value alone" (used by the API lane's partial mapping)
   * @param {{ignoreUnmatched?:boolean, maxBlankingRatio?:number, reportMissing?:boolean}} opts
   *        reportMissing (default true): set false for incremental API pulls, which only
   *        carry changed products — otherwise every unchanged product looks "missing".
   */
  function buildPlan(sheetValues, incoming, opts) {
    opts = opts || {};
    var reportMissing = opts.reportMissing !== false;
    var plan = {
      ok: false, errors: [], warnings: [], headerRow: -1,
      updates: [], appends: [], missingKeys: [],
      stats: { sheetRows: 0, importRows: 0, updatedRows: 0, updatedCells: 0, appendedRows: 0, unchangedCells: 0, blankedCells: 0, skippedEmptyCols: 0 }
    };

    var headerRow = findHeaderRow(sheetValues);
    if (headerRow === -1) {
      plan.errors.push('Could not find the header row (Name / SKU / Barcode) in the data tab. Nothing was written.');
      return plan;
    }
    plan.headerRow = headerRow;
    var sheetHeaders = sheetValues[headerRow];

    var hm = mapHeaders(sheetHeaders, incoming.headers);
    if (hm.unmatched.length && !opts.ignoreUnmatched) {
      plan.errors.push('The import has columns the sheet does not have: ' + hm.unmatched.join(', ') +
        '. Nothing was written. (Sheet layout may be out of date — align it once manually, or enable "ignore extra columns".)');
      return plan;
    }
    if (hm.unmatched.length) plan.warnings.push('Ignored import-only columns: ' + hm.unmatched.join(', '));

    var skuInc = -1, bcInc = -1;
    incoming.headers.forEach(function (h, i) {
      var n = U().normHeader(h);
      if (n === 'sku' && skuInc === -1) skuInc = i;
      if (n === 'barcode' && bcInc === -1) bcInc = i;
    });
    if (skuInc === -1) {
      plan.errors.push('The import has no SKU column — products cannot be matched safely. Nothing was written.');
      return plan;
    }
    var skuSheet = hm.sheetIndex['sku'];
    var bcSheet = hm.sheetIndex['barcode'];
    // Exposed so the applier can re-verify row identity and layout just before writing.
    plan.keyCols = { sku: skuSheet, barcode: bcSheet === undefined ? -1 : bcSheet };
    plan.headerSignature = headerSignature(sheetHeaders);
    // Exposed so writeSyncNotes can PRESERVE existing flags on an incremental pull (which
    // carries only changed products) instead of blanking the whole note column.
    plan.reportMissing = reportMissing;

    // Index existing rows by BOTH keys so a product that gains/loses a SKU between
    // syncs still matches on barcode instead of being duplicated (first row wins).
    var bySku = {}, byBc = {}, rowMeta = {};
    var seenPrimary = {};
    for (var r = headerRow + 1; r < sheetValues.length; r++) {
      var sK = skuKey(sheetValues[r][skuSheet]);
      var bK = bcSheet !== undefined ? bcKey(sheetValues[r][bcSheet]) : '';
      if (!sK && !bK) continue;
      plan.stats.sheetRows++;
      var primary = sK ? 'sku:' + sK : 'bc:' + bK;
      if (primary in seenPrimary) {
        plan.warnings.push('Duplicate product (' + primary + ') in the sheet at row ' + (r + 1) + ' — the first occurrence is used.');
        continue;
      }
      seenPrimary[primary] = r;
      rowMeta[r] = { matched: false, primary: primary };
      if (sK && !(sK in bySku)) bySku[sK] = r;
      if (bK && !(bK in byBc)) byBc[bK] = r;
    }

    var colType = columnTypes(sheetValues, headerRow, hm.sheetIndex);

    // De-duplicate incoming rows by identity — last occurrence wins.
    var dedup = {}, order = [];
    incoming.rows.forEach(function (inRow, idx) {
      var key = rowKey(inRow[skuInc], bcInc !== -1 ? inRow[bcInc] : '');
      if (!key) { plan.warnings.push('Import row ' + (idx + 2) + ' has no SKU or Barcode — skipped.'); return; }
      if (key in dedup) plan.warnings.push('Duplicate product (' + key + ') in the import — the last occurrence wins.');
      else order.push(key);
      dedup[key] = inRow;
    });
    plan.stats.importRows = order.length;

    // A column that is empty for EVERY import row is treated as "not maintained in this
    // export" and left untouched — a wrong/partial export can never wipe a whole column.
    var skipCol = {};
    hm.map.forEach(function (sc, ic) {
      if (sc === -1) return;
      var allEmpty = order.every(function (key) {
        var v = dedup[key][ic];
        return v === null || v === undefined || U().normString(v) === '';
      });
      if (order.length && allEmpty) { skipCol[ic] = true; plan.stats.skippedEmptyCols++; }
    });
    if (plan.stats.skippedEmptyCols) {
      plan.warnings.push(plan.stats.skippedEmptyCols + ' column(s) were empty across the whole import and were left unchanged.');
    }

    var width = sheetHeaders.length;
    var nonEmptyCompared = 0;

    order.forEach(function (key) {
      var inRow = dedup[key];
      var sK = skuKey(inRow[skuInc]);
      var bK = bcInc !== -1 ? bcKey(inRow[bcInc]) : '';
      var sheetRow = (sK && sK in bySku) ? bySku[sK] : (bK && bK in byBc) ? byBc[bK] : undefined;

      if (sheetRow === undefined) {
        var newRow = [];
        for (var c = 0; c < width; c++) newRow.push('');
        hm.map.forEach(function (sc, ic) {
          if (sc === -1 || skipCol[ic]) return;
          var v = inRow[ic];
          if (v === null || v === undefined) return;
          newRow[sc] = U().coerceForColumn(v, colType[sc]);
        });
        plan.appends.push(newRow);
        return;
      }

      if (rowMeta[sheetRow]) rowMeta[sheetRow].matched = true;
      var changes = [];
      hm.map.forEach(function (sc, ic) {
        if (sc === -1 || skipCol[ic]) return;
        var v = inRow[ic];
        if (v === null || v === undefined) return; // "leave alone" marker
        var existing = sheetValues[sheetRow][sc];
        if (U().normString(existing) !== '') nonEmptyCompared++;
        if (U().equivalent(existing, v)) { plan.stats.unchangedCells++; return; }
        var newValue = U().coerceLike(existing, v, colType[sc]);
        if (U().normString(newValue) === '' && U().normString(existing) !== '') plan.stats.blankedCells++;
        changes.push({ col: sc, header: String(sheetHeaders[sc]), oldValue: existing, newValue: newValue });
      });
      if (changes.length) {
        plan.updates.push({
          rowIndex: sheetRow, key: key,
          sheetKey: rowMeta[sheetRow] ? rowMeta[sheetRow].primary : key,
          changes: changes
        });
        plan.stats.updatedCells += changes.length;
      }
    });

    plan.stats.updatedRows = plan.updates.length;
    plan.stats.appendedRows = plan.appends.length;

    // Products in the sheet but not in this import — reported, never deleted.
    // Suppressed for incremental pulls, which legitimately omit unchanged products.
    if (reportMissing) {
      Object.keys(rowMeta).forEach(function (r) {
        if (!rowMeta[r].matched) plan.missingKeys.push({ key: rowMeta[r].primary, rowIndex: parseInt(r, 10) });
      });
    }

    // Blanking guard backstop: even spread across columns, a large blanking share aborts.
    var maxRatio = opts.maxBlankingRatio === undefined ? 0.3 : opts.maxBlankingRatio;
    if (nonEmptyCompared > 0 && plan.stats.blankedCells / nonEmptyCompared > maxRatio) {
      plan.errors.push('This import would blank ' + plan.stats.blankedCells + ' of ' + nonEmptyCompared +
        ' existing values — it looks like a partial or wrong-mode export (use "Export all details"). Nothing was written.');
      return plan;
    }

    plan.ok = true;
    return plan;
  }

  return {
    findHeaderRow: findHeaderRow,
    rowKey: rowKey,
    headerSignature: headerSignature,
    buildPlan: buildPlan
  };
})();

if (typeof module !== 'undefined') module.exports = MergeEngine;
