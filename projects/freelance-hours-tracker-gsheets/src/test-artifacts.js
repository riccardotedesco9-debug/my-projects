// test-artifacts.js — the three outward-facing artifacts: the exported PDF
// (both the /export URL path and the degraded DriveApp fallback), the
// view-only client viewer (money must NEVER leak into it), and the monthly
// Gmail drafts (attachment-only, correct recipient, zero-session skip).

function sectionPdf_(S, env) {
  var mirror = jsReportMirror_(env, 'Pet Centre', env.y, env.m);
  var pdf = exportPdfCtx_(env.ctx, {
    client: 'Pet Centre', year: env.y, month: env.m, includeMoney: true, save: false, forceFallback: true,
  });
  S.t('pdf: > 5KB of real content', pdf.sizeBytes > 5000, true);
  S.t('pdf: content type', String(pdf.contentType).toLowerCase().indexOf('pdf') >= 0, true);
  var mm = env.m < 10 ? '0' + env.m : String(env.m);
  S.t('pdf: canonical filename', pdf.name, 'Timesheet_' + env.y + '-' + mm + '_PetCentre_' + sanitize_(CFG.ownerName) + '.pdf');
  S.t('pdf: covers every session in the period', pdf.meta.rowCount, mirror.count);
  S.info('pdf export path', pdf.usedFallback ? 'DriveApp fallback (export URL flaky right now)' : 'primary /export URL');

  // Degraded path, exercised directly: must return a real PDF and restore
  // exactly the visibility it changed (Settings was already hidden — stays so).
  var settings = env.ss.getSheetByName(CFG.sheets.settings);
  S.t('precondition: Settings hidden', settings.isSheetHidden(), true);
  var fb = fallbackPdfBlob_(env.ctx);
  S.t('fallback pdf: real bytes', fb.getBytes().length > 5000, true);
  S.t('fallback pdf: content type', String(fb.getContentType()).toLowerCase().indexOf('pdf') >= 0, true);
  S.t('fallback restores hidden sheets it hid', env.ss.getSheetByName(CFG.sheets.dashboard).isSheetHidden(), false);
  S.t('fallback leaves pre-hidden sheets hidden', settings.isSheetHidden(), true);
  S.t('fallback leaves the log visible', env.logSh.isSheetHidden(), false);
}

function sectionViewer_(S, env) {
  var scratch = SpreadsheetApp.create('TEST HoursTracker viewer ' + Date.now());
  env.scratchIds.push(scratch.getId());
  var scratchCtx = makeCtx_({ ss: scratch, prefix: 'test:', silent: true });

  // A spreadsheet with none of our sheets must degrade, not throw.
  S.t('getClientNames_ without a Clients sheet → []', getClientNames_(scratchCtx).length, 0);
  S.t('getClientInfo_ without a Clients sheet → not found', getClientInfo_(scratchCtx, 'Pet Centre').exists, false);
  S.t('clientExists_ without a Clients sheet → false', clientExists_(scratchCtx, 'Pet Centre'), false);

  buildViewerContent_(scratch, env.ss.getId(), "Paws 'n' Claws");
  S.t('viewer: exactly one sheet', scratch.getSheets().length, 1);
  S.t('viewer: lands on the Summary page', scratch.getSheets()[0].getName(), 'Summary');
  var sh = scratch.getSheets()[0];
  var anchor = sh.getRange('H2').getFormula();
  S.t('viewer: bare IMPORTRANGE anchor (Allow-access prompt surface)', anchor.indexOf('=IMPORTRANGE') === 0 && anchor.indexOf('IFERROR') < 0, true);
  S.t('viewer: anchor points at Log!A1', anchor.indexOf(CFG.sheets.log + '!A1') > 0, true);
  var monthly = sh.getRange('N7').getFormula();
  var sessions = sh.getRange('F6').getFormula();
  S.t('viewer: monthly QUERY is IFERROR-wrapped (empty log ≠ access error)', monthly.indexOf('=IFERROR(QUERY(IMPORTRANGE') === 0, true);
  S.t('viewer: apostrophe client survives the GViz literal', sessions.indexOf("Paws 'n' Claws") > 0, true);
  S.t('viewer: headline total-hours stat wired', sh.getRange('B6').getFormula().indexOf('SUM($J$7:$J$1000)') > 0, true);
  S.t('viewer: hours-by-month table wired', sh.getRange('B10').getFormula().indexOf('ARRAYFORMULA') === 0, true);
  S.t('viewer: hours-by-month chart present', sh.getCharts().length, 1);
  S.t('viewer: chart data columns hidden', sh.isColumnHiddenByUser(14), true);
  // Strip the embedded Drive ID first — a random ID containing "Col7" must
  // not trip the privacy probe.
  var probe = (monthly + sessions).split(env.ss.getId()).join('');
  var moneyLeak = /A2:[GH]|Col7|Col8/.test(probe);
  S.t('viewer: imports A2:F only — Rate/€ can never leak', monthly.indexOf('A2:F') > 0 && sessions.indexOf('A2:F') > 0 && !moneyLeak, true);
  S.t('viewer: locale en_GB', scratch.getSpreadsheetLocale(), 'en_GB');
  S.t('viewer: timezone Malta', scratch.getSpreadsheetTimeZone(), 'Europe/Malta');
  buildViewerContent_(scratch, env.ss.getId(), "Paws 'n' Claws");
  S.t('viewer rebuild is idempotent (still one sheet)', scratch.getSheets().length, 1);
  S.t('viewer rebuild is idempotent (still one chart)', scratch.getSheets()[0].getCharts().length, 1);
}

function sectionDrafts_(S, env) {
  // Isolated: a Gmail auth hiccup must fail THIS section, not kill the suite —
  // runSection_ already contains throws, so this section just runs.
  var job = monthlyEmailJobCtx_(env.ctx, { year: env.y, month: env.m, save: false, forceFallback: true });
  // Register immediately: if anything below throws, cleanupSuite_ sweeps them.
  job.drafted.forEach(function (dd) {
    if (dd.draft) env.gmailDrafts.push(dd.draft);
  });
  S.t('one draft prepared (Pet Centre has an email)', job.drafted.length, 1);
  S.t('Splash skipped (no email)', job.skippedNoEmail.indexOf('Splash Store') >= 0, true);
  S.t('no per-client failures', job.failed.length, 0);
  var d = job.drafted[0] || {};
  S.t('draft object captured for review', !!d.draft, true);
  S.t('draft goes to the Clients-sheet email', d.email, 'client@example.test');
  var period = Utilities.formatDate(new Date(env.y, env.m - 1, 1), env.tz, 'MMMM yyyy');
  S.t('draft subject names period + owner', d.subject, 'Timesheet ' + period + ' — ' + CFG.ownerName);
  var body = draftBody_('Pet Centre', period, { totalHours: 12.5, rowCount: 4 });
  S.t('draft body carries no link (PDF only, by request)', /https?:\/\//i.test(body), false);
  S.t('draft body states hours to 2 decimals', body.indexOf('12.50 h across 4 sessions') > 0, true);
  // Attachment contract via the job's own metadata — always runs, no Gmail
  // read scope needed.
  S.t('draft attachment is the canonical PDF', d.attachmentName, timesheetFilename_('Pet Centre', env.y, env.m));
  S.t('draft attachment has real bytes', d.attachmentBytes > 5000, true);
  try {
    var atts = d.draft.getMessage().getAttachments();
    S.t('Gmail confirms exactly one attachment', atts.length, 1);
  } catch (scopeErr) {
    S.warn('Gmail-side attachment check', false, 'unreadable under gmail.compose scope (metadata check above still ran)');
  }

  // Zero-session months draft NOTHING, even for clients with an email.
  var job2 = monthlyEmailJobCtx_(env.ctx, { year: env.y + 1, month: 3, save: false, forceFallback: true });
  S.t('empty month: zero drafts', job2.drafted.length, 0);
  S.t('empty month: zero failures', job2.failed.length, 0);
  S.t('empty month: nobody even flagged for email', job2.skippedNoEmail.length, 0);

  var deleted = 0;
  job.drafted.forEach(function (dd) {
    if (dd.draft) {
      dd.draft.deleteDraft();
      deleted++;
    }
  });
  S.t('review drafts cleaned up', deleted, job.drafted.length);
}
