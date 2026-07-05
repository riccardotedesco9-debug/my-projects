// triggers.js — the two installable-trigger features:
//  1. Mobile checkboxes: the Sheets mobile app runs NO menus/buttons/sidebars,
//     so two Dashboard checkboxes drive the same timer core via installable
//     onEdit (a simple onEdit would silently no-op — it can't use services
//     that need authorization).
//  2. Monthly Gmail drafts: 1st of month, one draft per client with activity.

function onEditInstallable(e) {
  if (!e || !e.range || e.value !== 'TRUE') return; // only fresh ticks; our own reset writes FALSE
  var sheet = e.range.getSheet();
  if (sheet.getName() !== CFG.sheets.dashboard) return;

  var ss = e.source || SpreadsheetApp.getActive();
  // A real trigger always fires on the bound spreadsheet. A foreign source
  // means the smoke test is driving this handler against its throwaway copy —
  // route state to the test: prefix so production state can never be touched.
  var foreign = ss.getId() !== SpreadsheetApp.getActive().getId();
  var ctx = makeCtx_({ ss: ss, prefix: foreign ? 'test:' : '', silent: foreign });
  var a1 = e.range.getA1Notation();
  var startCell = ss.getRangeByName(CFG.named.chkStart);
  var stopCell = ss.getRangeByName(CFG.named.chkStop);
  var isStart = startCell && a1 === startCell.getA1Notation();
  var isStop = stopCell && a1 === stopCell.getA1Notation();
  // Only our two checkboxes act. Anything else on the Dashboard that happens to
  // equal "TRUE" (e.g. typed into the free-text Task cell) is left untouched —
  // never reset a cell we didn't handle.
  if (!isStart && !isStop) return;

  try {
    if (isStart) {
      var client = String(getNamedValue_(ctx, CFG.named.dbClient) || '').trim();
      var task = String(getNamedValue_(ctx, CFG.named.dbTask) || '').trim();
      // No dialogs on mobile → a deliberate tick performs the zero-gap switch
      // directly and proceeds even with no rate set (the live Rate formula
      // back-fills once you add it). Stamped with server time at trigger run;
      // an offline tap therefore logs at sync time.
      startWorkCtx_(ctx, client, task, { confirmSwitch: true, confirmNoRate: true });
    } else {
      stopAndLogCtx_(ctx);
    }
  } finally {
    // Reset only the checkbox we handled (double-fire guard).
    e.range.setValue(false);
  }
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
      drafted.push({ client: name, email: emails[name], subject: subject, draft: draft });
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
