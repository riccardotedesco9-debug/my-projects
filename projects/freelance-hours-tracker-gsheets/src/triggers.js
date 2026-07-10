// triggers.js — the two installable-trigger features:
//  1. Mobile checkboxes: the Sheets mobile app runs NO menus/buttons/sidebars,
//     so two Dashboard checkboxes drive the same timer core via installable
//     onEdit (a simple onEdit would silently no-op — it can't use services
//     that need authorization).
//  2. Monthly Gmail drafts: 1st of month, one draft per client with activity.

function onEditInstallable(e) {
  // Only fresh ticks act; our own resets write FALSE. Sheets delivers checkbox
  // values as the string 'TRUE' today — accept boolean true too, defensively.
  if (!e || !e.range || (e.value !== 'TRUE' && e.value !== true)) return;
  var sheet = e.range.getSheet();
  if (sheet.getName() !== CFG.sheets.dashboard) return;

  var ss = e.source || SpreadsheetApp.getActive();
  // A real trigger always fires on the bound spreadsheet. A foreign source means
  // the smoke test is driving this against its throwaway copy — with log-as-truth
  // the throwaway's own Time Log isolates state, so just run silently there.
  var foreign = ss.getId() !== SpreadsheetApp.getActive().getId();
  var ctx = makeCtx_({ ss: ss, prefix: foreign ? 'test:' : '', silent: foreign });
  var a1 = e.range.getA1Notation();
  var startCell = ss.getRangeByName(CFG.named.chkStart);
  var stopBlock = ss.getRangeByName(CFG.named.chkStopBlock);
  var isStart = startCell && a1 === startCell.getA1Notation();
  var stopIdx = stopBlock ? blockIndexOf_(stopBlock, e.range) : -1;
  // Only START and the RUNNING NOW stop boxes act. Anything else that happens to
  // equal "TRUE" (e.g. typed into the free-text Task cell) is left untouched —
  // never reset a cell we didn't handle.
  if (!isStart && stopIdx < 0) return;

  try {
    if (isStart) {
      var client = String(getNamedValue_(ctx, CFG.named.dbClient) || '').trim();
      var task = String(getNamedValue_(ctx, CFG.named.dbTask) || '').trim();
      // No dialogs on mobile → a deliberate tick ADDS a clock (never replaces a
      // running one) and proceeds even with no rate set (the live Rate formula
      // back-fills once you add it). The Billing dropdown flags it Free (no
      // charge) or TBD (price agreed later). Stamped with server time at run, so
      // an offline tap logs at sync time.
      var bill = billingFromNamed_(ctx);
      startWorkCtx_(ctx, client, task, { confirmNoRate: true, free: bill.free, tbd: bill.tbd });
    } else {
      // Map the ticked row to its session via the hidden startedAtMs column.
      var idRange = ss.getRangeByName(CFG.named.dbRunIds);
      var id = idRange
        ? Number(idRange.getSheet().getRange(idRange.getRow() + stopIdx, idRange.getColumn()).getValue())
        : 0;
      if (id) stopSessionCtx_(ctx, id); // stale/blank id → idempotent no-op inside
    }
  } finally {
    // Reset only the checkbox we handled (double-fire guard), then repaint so
    // the remaining cards shift up after a stop.
    e.range.setValue(false);
    try { paintRunningSurfaces_(ctx); } catch (e2) {}
  }
}

/**
 * 0-based index of an edited single cell within a named single-column block
 * (the RUNNING NOW stop checkboxes), or -1 if the cell is outside it.
 */
function blockIndexOf_(block, cell) {
  if (cell.getSheet().getName() !== block.getSheet().getName()) return -1;
  if (cell.getColumn() !== block.getColumn()) return -1;
  var idx = cell.getRow() - block.getRow();
  return (idx >= 0 && idx < block.getNumRows()) ? idx : -1;
}

/**
 * Monthly trigger (1st, 06:00 Europe/Malta) + menu item "Prepare monthly
 * drafts now": builds last month's PDF per client with logged hours and an
 * email address, and leaves a Gmail DRAFT for review — never auto-sends.
 */
function monthlyEmailJob() {
  return monthlyEmailJobCtx_(makeCtx_({ silent: true }), {});
}

function monthlyEmailJobCtx_(ctx, opts) {
  var tz = ctx.ss.getSpreadsheetTimeZone();
  var now = new Date();
  var period = opts.year && opts.month
    ? new Date(opts.year, opts.month - 1, 1)
    : new Date(now.getFullYear(), now.getMonth() - 1, 1);
  var year = period.getFullYear();
  var month = period.getMonth() + 1;
  var monthLabel = Utilities.formatDate(period, tz, 'MMMM yyyy');
  var nextMonthStart = new Date(year, month, 1);

  var emails = {};
  getClientsWithEmail_(ctx).forEach(function (c) {
    emails[c.name] = c.email;
  });

  var drafted = [];
  var skippedNoEmail = [];
  var failed = [];
  getClientNames_(ctx).forEach(function (name) {
    // Per-client isolation: one client's export/Gmail failure must not abort the
    // whole unattended batch — collect it and keep going.
    try {
      var sessions = collectReportRows_(ctx, name, period, nextMonthStart);
      if (sessions.length === 0) return;
      if (!emails[name]) {
        skippedNoEmail.push(name);
        return;
      }
      var res = exportPdfCtx_(ctx, {
        client: name,
        year: year,
        month: month,
        includeMoney: true,
        save: opts.save !== false,
        forceFallback: !!opts.forceFallback, // tests: deterministic grouping
      });
      var subject = 'Timesheet ' + monthLabel + ' — ' + CFG.ownerName;
      // The draft carries the PDF as an attachment only — never a link.
      var draft = GmailApp.createDraft(emails[name], subject, draftBody_(name, monthLabel, res.meta), {
        attachments: [res.blob],
      });
      // attachmentName/Bytes let the smoke suite verify the attachment contract
      // without needing a Gmail read scope.
      drafted.push({
        client: name, email: emails[name], subject: subject, draft: draft,
        attachmentName: res.name, attachmentBytes: res.sizeBytes,
      });
    } catch (err) {
      failed.push({ client: name, error: String((err && err.message) || err) });
    }
  });

  // Nudge the owner once if any client needs an email or errored (prod only —
  // test contexts must not send real mail).
  if ((skippedNoEmail.length > 0 || failed.length > 0) && !ctx.prefix) {
    MailApp.sendEmail(
      CFG.ownerEmail,
      'Hours Tracker: monthly drafts need attention',
      'Drafts prepared for: ' + (drafted.map(function (d) { return d.client; }).join(', ') || 'none') +
        '.\n\nNo email on the Clients sheet for: ' + (skippedNoEmail.join(', ') || 'none') +
        '.\n\nFailed (retry via "Prepare monthly drafts now"): ' +
        (failed.map(function (f) { return f.client + ' — ' + f.error; }).join('; ') || 'none')
    );
  }

  return { drafted: drafted, skippedNoEmail: skippedNoEmail, failed: failed, period: monthLabel };
}

/** Draft email body — plain text, PDF attached, deliberately no link. */
function draftBody_(name, monthLabel, meta) {
  return (
    'Hi ' + name + ',\n\n' +
    'Please find attached my timesheet for ' + monthLabel +
    ' (' + meta.totalHours.toFixed(2) + ' h across ' + meta.rowCount + ' sessions).\n\n' +
    'Best regards,\n' + CFG.ownerName
  );
}
