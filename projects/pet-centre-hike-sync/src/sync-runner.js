/**
 * Orchestrates one sync run: plan → preview/gate → backup → apply → notes → log.
 * The first-ever apply on a sheet must be human-confirmed (dry-run preview); after
 * that, trigger-driven runs may apply automatically. Aborts never write anything.
 */
var SyncRunner = (function () {
  var PREVIEW_LINES = 12;

  /**
   * @param {string} source label for the log, e.g. 'file: export.xlsx'
   * @param {{headers:Array, rows:Array<Array>}} incoming
   * @param {boolean} interactive true when a person triggered it from the menu
   * @param {{incremental?:boolean}} opts incremental pulls carry only changed products,
   *        so absent products must NOT be flagged "missing"
   * @returns {{ok:boolean, applied:boolean, reason:string}}
   *          reason ∈ busy|error|aborted|gated|nothing-to-do|cancelled|applied
   */
  function run(source, incoming, interactive, opts) {
    opts = opts || {};
    var lock = LockService.getDocumentLock();
    if (!lock.tryLock(30000)) {
      if (interactive) SpreadsheetApp.getUi().alert('Another sync is running right now — try again in a minute.');
      return { ok: false, applied: false, reason: 'busy' };
    }
    try {
      return runLocked_(source, incoming, interactive, opts);
    } catch (e) {
      SyncLog.logRun({ source: source, ok: false, message: 'Error: ' + e.message });
      if (interactive) SpreadsheetApp.getUi().alert('Sync failed — nothing may be partially written; check the log.\n\n' + e.message);
      else SyncLog.alertFailure('Sync failed (' + source + ')', e.message);
      return { ok: false, applied: false, reason: 'error' };
    } finally {
      lock.releaseLock();
    }
  }

  function runLocked_(source, incoming, interactive, opts) {
    var before = SheetIO.readAll();
    var plan = MergeEngine.buildPlan(before, incoming, {
      ignoreUnmatched: Settings.get('IGNORE_UNMATCHED', 'no') === 'yes',
      reportMissing: !opts.incremental
    });

    if (!plan.ok) {
      var err = plan.errors.join(' ');
      SyncLog.logRun({ source: source, ok: false, message: err });
      if (interactive) SpreadsheetApp.getUi().alert('Sync aborted — nothing was written.\n\n' + err);
      else SyncLog.alertFailure('Sync aborted (' + source + ')', err);
      return { ok: false, applied: false, reason: 'aborted' };
    }

    plan.stats.missing = plan.missingKeys.length;
    var nothingToDo = !plan.updates.length && !plan.appends.length;

    if (!interactive && Settings.get('FIRST_APPLY_DONE', '') !== 'yes') {
      var gateMsg = 'The first-ever sync must be confirmed by a person: open the sheet and run one import from the Hike Sync menu.';
      SyncLog.logRun({ source: source, ok: false, message: gateMsg });
      SyncLog.alertFailure('First sync needs a manual confirmation', gateMsg);
      return { ok: false, applied: false, reason: 'gated' };
    }

    if (nothingToDo) {
      SyncLog.logRun({ source: source, ok: true, stats: plan.stats, message: 'Already up to date.' });
      if (interactive) {
        SpreadsheetApp.getUi().alert('Everything is already up to date — nothing to write.' + missingNote_(plan));
      }
      return { ok: true, applied: false, reason: 'nothing-to-do' };
    }

    if (interactive) {
      var ui = SpreadsheetApp.getUi();
      var answer = ui.alert('Hike Sync preview — NOTHING written yet', previewText_(plan), ui.ButtonSet.YES_NO);
      if (answer !== ui.Button.YES) {
        SyncLog.logRun({ source: source, ok: true, stats: plan.stats, message: 'Preview shown, apply cancelled by user.' });
        return { ok: true, applied: false, reason: 'cancelled' };
      }
    }

    // Back up before writing on human-initiated, first-ever, or large changes. Small scheduled
    // incremental syncs (few changed products, idempotent, Hike-sourced) rely on Google's
    // Version History instead — so we don't clone the whole catalog every 15 minutes, which
    // would also pile up toward the per-spreadsheet cell cap on a large catalog.
    var changeSize = plan.stats.updatedRows + plan.stats.appendedRows;
    if (interactive || Settings.get('FIRST_APPLY_DONE', '') !== 'yes' || changeSize >= 50) {
      SheetIO.backup();
    }
    var appendInfo = SheetIO.applyPlan(plan);
    assertApplied_(plan, before.length);
    SheetIO.writeSyncNotes(plan, appendInfo);
    Settings.set('FIRST_APPLY_DONE', 'yes');
    SyncLog.logRun({ source: source, ok: true, stats: plan.stats, message: plan.warnings.slice(0, 3).join(' | ') });
    // Tidy trailing empty rows, then refresh the insight charts. Both are best-effort —
    // a failure here must never fail an already-applied sync.
    try { SheetIO.trimToData(); } catch (e) { /* tidy-only */ }
    try { Insights.rebuild(false); } catch (e) { /* charts are best-effort */ }

    if (interactive) {
      SpreadsheetApp.getUi().alert('Done. Updated ' + plan.stats.updatedRows + ' product(s), added ' +
        plan.stats.appendedRows + ' new.' + missingNote_(plan) +
        '\n\nA backup of the previous values was saved (hidden tab).');
    }
    return { ok: true, applied: true, reason: 'applied' };
  }

  /** Post-apply sanity: rows never shrink, and the first planned change actually landed.
   *  Uses getLastRow + a single-cell read (not a full-sheet read) so it stays cheap at scale. */
  function assertApplied_(plan, rowsBefore) {
    var sh = SheetIO.dataSheet();
    if (sh.getLastRow() < rowsBefore) {
      throw new Error('Row count decreased after apply (' + rowsBefore + ' → ' + sh.getLastRow() + ') — investigate before running again.');
    }
    if (plan.updates.length) {
      var u = plan.updates[0], ch = u.changes[0];
      if (!ValueUtils.equivalent(sh.getRange(u.rowIndex + 1, ch.col + 1).getValue(), ch.newValue)) {
        throw new Error('Verification failed: updated cell did not take the new value. Check the backup tab.');
      }
    }
  }

  function missingNote_(plan) {
    if (!plan.missingKeys.length) return '';
    return '\n\nNote: ' + plan.missingKeys.length + ' product(s) in the sheet were NOT in this import. ' +
      'They were kept (never deleted) and flagged in the "' +
      Settings.get('NOTE_COLUMN_HEADER', Settings.DEFAULTS.NOTE_COLUMN_HEADER) + '" column.';
  }

  var PREVIEW_NOTES = 6;

  /**
   * Human-readable preview text, organised into clear sections (Summary / Sample changes /
   * Notes) with one note per line — rather than a single blob with pipe-joined warnings.
   */
  function previewText_(plan) {
    var s = plan.stats;
    var out = [];
    out.push('NOTHING has been written yet — this is a preview.');
    out.push('');
    out.push('SUMMARY');
    out.push('   Update   ' + s.updatedRows + ' product(s)  (' + s.updatedCells + ' cell change(s))');
    out.push('   Add      ' + plan.appends.length + ' new product(s), at the bottom');
    out.push('   Keep     ' + plan.missingKeys.length + ' product(s) not in this import — left untouched');

    var changes = [];
    for (var i = 0; i < plan.updates.length && changes.length < PREVIEW_LINES; i++) {
      var u = plan.updates[i];
      for (var j = 0; j < u.changes.length && changes.length < PREVIEW_LINES; j++) {
        var ch = u.changes[j];
        changes.push('   • ' + u.key + ' — ' + ch.header + ':  "' + ch.oldValue + '"  →  "' + ch.newValue + '"');
      }
    }
    if (changes.length) {
      out.push('');
      out.push('SAMPLE CHANGES  (first ' + changes.length + ')');
      out = out.concat(changes);
      var more = s.updatedCells - changes.length;
      if (more > 0) out.push('   …and ' + more + ' more change(s)');
    }

    if (plan.warnings.length) {
      out.push('');
      out.push('NOTES  (' + plan.warnings.length + ')');
      plan.warnings.slice(0, PREVIEW_NOTES).forEach(function (w) { out.push('   • ' + w); });
      if (plan.warnings.length > PREVIEW_NOTES) {
        out.push('   …and ' + (plan.warnings.length - PREVIEW_NOTES) + ' more note(s) — see the _hike_sync_log tab');
      }
    }

    out.push('');
    out.push('Apply these changes?  A backup of the current values is taken first.');
    return out.join('\n');
  }

  return { run: run };
})();
