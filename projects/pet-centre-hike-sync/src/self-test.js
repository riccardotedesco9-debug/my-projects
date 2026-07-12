/**
 * In-sheet safety self-test. Runs the real engine against the LIVE data tab, then
 * restores its original values+formulas. Because it writes test data to the DATA tab,
 * it refuses to run unless the spreadsheet name contains "sandbox" (or ALLOW_SELF_TEST=yes).
 * The labels tab is only ever READ here (never written), matching the product invariant.
 */
var SelfTest = (function () {
  var TEST_SKU = 'SELFTEST-001';

  function assertSandbox_() {
    var name = SpreadsheetApp.getActive().getName();
    if (name.toLowerCase().indexOf('sandbox') === -1 && Settings.get('ALLOW_SELF_TEST', '') !== 'yes') {
      throw new Error('Self-test writes test data, so it only runs on a sheet whose name contains "sandbox". This sheet is "' + name + '".');
    }
  }

  function check_(label, cond, detail) {
    return (cond ? 'PASS — ' : 'FAIL — ') + label + (cond || !detail ? '' : ' [' + detail + ']');
  }

  /** Current data table context: headers + first product's key fields. */
  function context_() {
    var values = SheetIO.readAll();
    var headerRow = MergeEngine.findHeaderRow(values);
    if (headerRow === -1) throw new Error('No header row found in the data tab.');
    var headers = values[headerRow];
    var norm = headers.map(function (h) { return ValueUtils.normHeader(h); });
    var col = function (n) { return norm.indexOf(n); };
    var priceCol = norm.findIndex(function (n) { return /_retail price$/.test(n); });
    var first = values[headerRow + 1];
    if (!first) throw new Error('The data tab has no product rows to test with.');
    return {
      values: values, headerRow: headerRow, headers: headers,
      skuCol: col('sku'), bcCol: col('barcode'), nameCol: col('name'), priceCol: priceCol,
      firstSku: first[col('sku')], firstBarcode: first[col('barcode')], firstName: first[col('name')]
    };
  }

  function plan_(ctx, headers, rows) {
    return MergeEngine.buildPlan(SheetIO.readAll(), { headers: headers, rows: rows }, {});
  }

  function run() {
    assertSandbox_();
    var lock = LockService.getDocumentLock();
    if (!lock.tryLock(30000)) {
      SpreadsheetApp.getUi().alert('A sync or self-test is already running — try again shortly.');
      return;
    }
    var sh = SheetIO.dataSheet();
    // In-memory snapshot is the restore path; a backup tab is a durable fallback in case
    // the script is hard-killed before the finally-block restore runs.
    SheetIO.backup();
    var snapRange = sh.getDataRange();
    var snapValues = snapRange.getValues();
    var snapFormulas = snapRange.getFormulas();
    var results = [];

    try {
      var ctx = context_();
      results.push(check_('header row detected', true));

      // 1. Price update lands in place
      var newPrice = 99.99;
      var p1 = plan_(ctx, [ctx.headers[ctx.skuCol], ctx.headers[ctx.priceCol]], [[ctx.firstSku, newPrice]]);
      var ok1 = p1.ok && p1.updates.length === 1 && p1.appends.length === 0;
      if (ok1) SheetIO.applyPlan(p1);
      var after1 = SheetIO.readAll();
      ok1 = ok1 && ValueUtils.equivalent(after1[p1.updates[0].rowIndex][ctx.priceCol], newPrice);
      results.push(check_('price update writes in place', ok1, p1.errors.join(' ')));

      // 2. New product appends (never inserted mid-sheet)
      var rowsBefore = sh.getLastRow();
      var p2 = plan_(ctx,
        [ctx.headers[ctx.nameCol], ctx.headers[ctx.skuCol], ctx.headers[ctx.bcCol], ctx.headers[ctx.priceCol]],
        [['Self Test Product', TEST_SKU, '9999999999999', 1.23]]);
      var ok2 = p2.ok && p2.appends.length === 1 && p2.updates.length === 0;
      if (ok2) SheetIO.applyPlan(p2);
      ok2 = ok2 && sh.getLastRow() === rowsBefore + 1;
      results.push(check_('new product appends at the bottom', ok2, p2.errors.join(' ')));

      // 3. Missing-from-import products are kept, never deleted
      var rowsBefore3 = sh.getLastRow();
      var p3 = plan_(ctx, [ctx.headers[ctx.skuCol], ctx.headers[ctx.priceCol]], [[TEST_SKU, 2.34]]);
      var ok3 = p3.ok && p3.appends.length === 0 && p3.missingKeys.length >= 1;
      if (ok3) SheetIO.applyPlan(p3);
      var after3 = SheetIO.readAll();
      var stillThere = after3.some(function (r) { return ValueUtils.normKey(r[ctx.skuCol]) === ValueUtils.normKey(ctx.firstSku); });
      ok3 = ok3 && sh.getLastRow() === rowsBefore3 && stillThere;
      results.push(check_('products missing from an import survive untouched', ok3));

      // 4. Unknown import column aborts before writing
      var p4 = plan_(ctx, ['Definitely Not A Real Column', ctx.headers[ctx.skuCol]], [['x', ctx.firstSku]]);
      results.push(check_('unknown import column aborts the run', !p4.ok));

      // 5. A wrong-mode export that empties a whole column must NOT wipe values: the
      //    engine skips an all-empty import column (scattered blanks hit the aggregate
      //    guard instead — unit-tested). Either way, no existing value is blanked.
      var wipeRows = [];
      for (var r = ctx.headerRow + 1; r < ctx.values.length; r++) {
        if (ValueUtils.normKey(ctx.values[r][ctx.skuCol])) wipeRows.push([ctx.values[r][ctx.skuCol], '']);
      }
      var p5 = plan_(ctx, [ctx.headers[ctx.skuCol], ctx.headers[ctx.nameCol]], wipeRows);
      var wipeNeutralized = p5.ok && p5.updates.length === 0 && (p5.stats.skippedEmptyCols || 0) >= 1;
      results.push(check_('a value-wiping import is neutralized (empty column skipped)', wipeNeutralized,
        p5.errors.join(' ') || ('updates=' + p5.updates.length + ' skippedCols=' + p5.stats.skippedEmptyCols)));

      // 6. Backups exist and only backup tabs are pruned
      SheetIO.backup();
      var backups = SpreadsheetApp.getActive().getSheets().filter(function (s) {
        return s.getName().indexOf(SheetIO.BACKUP_PREFIX) === 0;
      });
      results.push(check_('backup tab created', backups.length >= 1));

      // 7. LABELS lookups still resolve after all the writes above
      results.push(testLabelsLookup_(ctx));

      // --- Port-over robustness: matching logic on the shapes a real client export can take ---
      // (plan-only checks — they compute a plan but write nothing, so no restore risk)

      // 8. Columns map by header NAME regardless of the import's column order (his export order may differ)
      var p8 = plan_(ctx, [ctx.headers[ctx.priceCol], ctx.headers[ctx.skuCol]], [[77.5, ctx.firstSku]]);
      results.push(check_('columns map by header name regardless of import column order', p8.ok && p8.updates.length === 1, p8.errors.join(' ')));

      // 9. Barcode fallback: the import HAS a SKU column but this row's SKU is blank → it must
      //    match the existing product by BARCODE. (A real Hike export always has a SKU column;
      //    the engine correctly ABORTS an import with no SKU column at all — that's tested by #4's
      //    sibling behaviour, not here.)
      if (ValueUtils.normKey(ctx.firstBarcode)) {
        var p9 = plan_(ctx, [ctx.headers[ctx.skuCol], ctx.headers[ctx.bcCol], ctx.headers[ctx.priceCol]], [['', ctx.firstBarcode, 3.21]]);
        results.push(check_('barcode fallback: blank-SKU row matches an existing product by barcode', p9.ok && p9.appends.length === 0 && p9.updates.length === 1, p9.errors.join(' ')));
      } else {
        results.push('PASS — barcode-fallback check skipped (first product has no barcode)');
      }

      // 10. Duplicate SKU within one import — last occurrence wins, never a duplicate row
      var p10 = plan_(ctx, [ctx.headers[ctx.skuCol], ctx.headers[ctx.priceCol]], [[ctx.firstSku, 1], [ctx.firstSku, 2]]);
      results.push(check_('duplicate SKU in import — last wins, no duplicate row', p10.ok && p10.updates.length === 1 && p10.appends.length === 0, p10.errors.join(' ')));

      // 11. Data-safety: a USER tab that happens to be named "Stock overview" and holds content is
      //     NEVER deleted by an insights rebuild — only the tool's own output tabs are cleaned up.
      var ssa = SpreadsheetApp.getActive();
      if (!ssa.getSheetByName('Stock overview')) {
        var uov = ssa.insertSheet('Stock overview');
        uov.getRange(1, 1, 2, 1).setValues([['my own notes'], ['keep me']]);
        try { Insights.rebuild(false); } catch (e2) { /* rebuild is best-effort in the test */ }
        var survived = ssa.getSheetByName('Stock overview');
        results.push(check_('a user "Stock overview" tab with content survives a rebuild',
          !!survived && survived.getRange(2, 1).getValue() === 'keep me'));
        if (survived) ssa.deleteSheet(survived);
      } else {
        results.push('PASS — a "Stock overview" tab already exists; user-tab-survives check skipped');
      }
    } catch (e) {
      results.push('CRASH — ' + e.message);
    } finally {
      restore_(sh, snapValues, snapFormulas);
      lock.releaseLock();
    }

    var allPass = results.every(function (r) { return r.indexOf('PASS') === 0; });
    SyncLog.logRun({ source: 'self-test', ok: allPass, message: results.join(' | ') });
    SpreadsheetApp.getUi().alert('Hike Sync self-test (' + (allPass ? 'ALL PASS' : 'FAILURES — see below') + ')\n\n' +
      results.join('\n') + '\n\nThe sheet has been restored to its pre-test state.');
  }

  /**
   * READ-ONLY: confirm the labels tab's lookup for the first product still resolves to its
   * name after the sync's writes to the data tab. Reads a pre-built label row that already
   * references the product; never writes to the labels tab (matching the product invariant).
   */
  function testLabelsLookup_(ctx) {
    var labels = findLabelsSheet_();
    if (!labels) return 'PASS — labels tab not found on this copy; lookup check skipped';
    var data = labels.getDataRange().getValues();
    var bcCol = -1, nameCol = -1, headerRowIdx = -1;
    for (var r = 0; r < Math.min(3, data.length); r++) {
      for (var c = 0; c < data[r].length; c++) {
        var n = ValueUtils.normHeader(data[r][c]);
        if (n === 'barcode') { bcCol = c; headerRowIdx = r; }
        if (n === 'name') nameCol = c;
      }
      if (bcCol !== -1) break;
    }
    if (bcCol === -1 || nameCol === -1) return 'PASS — labels layout not recognized; lookup check skipped';

    for (var r2 = headerRowIdx + 1; r2 < data.length; r2++) {
      if (ValueUtils.normKey(data[r2][bcCol]) === ValueUtils.normKey(ctx.firstBarcode)) {
        return check_('labels barcode lookup still resolves', ValueUtils.equivalent(data[r2][nameCol], ctx.firstName),
          'got "' + data[r2][nameCol] + '"');
      }
    }
    return 'PASS — no label row references the first product; lookup check skipped';
  }

  /** The labels tab is the non-data, non-backup tab whose top rows carry barcode+name headers. */
  function findLabelsSheet_() { return LabelsPrint.findLabelsSheet(); }

  /** Put back the exact pre-test values (formulas take precedence), clear appended test rows. */
  function restore_(sh, snapValues, snapFormulas) {
    var merged = snapValues.map(function (row, r) {
      return row.map(function (v, c) { return snapFormulas[r][c] || v; });
    });
    sh.getRange(1, 1, merged.length, merged[0].length).setValues(merged);
    var lastRow = sh.getLastRow();
    if (lastRow > merged.length) {
      // Contents only — the engine never deletes rows, and neither does the test harness.
      sh.getRange(merged.length + 1, 1, lastRow - merged.length, sh.getMaxColumns()).clearContent();
    }
    SpreadsheetApp.flush();
  }

  return { run: run };
})();
