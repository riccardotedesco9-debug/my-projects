// export-phone.js — the phone's rebuild of the desktop "Export timesheet PDF…"
// dialog. The Sheets mobile app runs no menus, dialogs or sidebars, so the same
// job is reassembled out of the only parts a phone CAN drive: two dropdowns, a
// checkbox as the tap target, and one result cell that becomes a link to the
// finished PDF. It calls exportPdfCtx_ — the SAME pipeline as the dialog and the
// monthly job — so a phone export and a desktop export are byte-for-byte the
// same document.
//
// The period list is generated in ONE place (exportPeriods_) and written to the
// sheet as VALUES, never a formula: the handler then resolves the picked label
// by matching that same list, so no month-name parsing (and no locale) sits
// between the tap and the export.

/**
 * The periods both surfaces offer, newest first: the last 12 months, then this
 * year and last year as whole-year options. month 0 = whole year (the report
 * layer's convention).
 */
function exportPeriods_(ctx) {
  var tz = ctx.ss.getSpreadsheetTimeZone();
  var now = new Date();
  var periods = [];
  for (var i = 0; i < 12; i++) {
    var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    periods.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      label: Utilities.formatDate(d, tz, 'MMMM yyyy'),
    });
  }
  periods.push({ year: now.getFullYear(), month: 0, label: now.getFullYear() + ' — full year' });
  periods.push({ year: now.getFullYear() - 1, month: 0, label: now.getFullYear() - 1 + ' — full year' });
  return periods;
}

/**
 * EXPORT TIMESHEET (PHONE) block. Source lists live in hidden columns: N =
 * clients (a live FILTER, so a client added today is pickable today), O =
 * periods (values, rewritten by refreshExportPeriods_ on every repaint).
 * No card_ here — it would paint over the button's coloured label face.
 */
function buildPhoneExportBlock_(sh, ss) {
  var clients = "'" + CFG.sheets.clients + "'";
  sectionHeader_(sh.getRange('B38'), 'EXPORT TIMESHEET (PHONE)');

  // Hidden source lists. "All Clients" is a literal in its own cell rather than
  // an array literal joined to the FILTER — one less locale-dependent separator
  // between the client list and the dropdown that depends on it.
  sh.getRange('N1').setValue('Export clients — do not edit').setFontColor(CFG.colors.gray).setFontSize(8);
  sh.getRange('N2').setValue(CFG.allClients);
  sh.getRange('N3').setFormula('=IFERROR(FILTER(' + clients + '!A2:A, ' + clients + '!A2:A<>""), "")');
  sh.getRange('O1').setValue('Export periods — do not edit').setFontColor(CFG.colors.gray).setFontSize(8);
  // PLAIN TEXT on the period list and its picker, or Sheets silently parses
  // "July 2026" into a date — and the handler, which resolves the pick by
  // matching it back against the generated labels, would never find it again.
  sh.getRange('O2:O30').setNumberFormat('@');

  sh.getRange('B39').setValue('Client').setFontWeight('bold');
  sh.getRange('C39:D39').merge();
  styleInputCell_(sh.getRange('C39:D39'));
  sh.getRange('C39').setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInRange(sh.getRange('N2:N20'), true)
      .setAllowInvalid(false)
      .build()
  );
  sh.getRange('C39').setValue(CFG.allClients);
  ss.setNamedRange(CFG.named.dbExpClient, sh.getRange('C39'));

  sh.getRange('E39').setValue('Period').setFontWeight('bold').setHorizontalAlignment('right');
  sh.getRange('F39:G39').merge();
  styleInputCell_(sh.getRange('F39:G39'));
  sh.getRange('F39:G39').setNumberFormat('@'); // see the O-column note above
  sh.getRange('F39').setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInRange(sh.getRange('O2:O20'), true)
      .setAllowInvalid(false)
      .build()
  );
  ss.setNamedRange(CFG.named.dbExpPeriod, sh.getRange('F39'));

  // The tap target, with the include-€ toggle beside it — the same checkbox the
  // desktop dialog offers, not a dropdown, so both surfaces read alike. It is a
  // plain TOGGLE, never an action: onEditInstallable ignores this cell, and
  // therefore never resets it, so a tick survives from one export to the next.
  sh.setRowHeight(40, 30);
  phoneButton_(sh, ss, 40, CFG.named.chkExport, CFG.colors.navy, '📄  EXPORT PDF');
  var moneyCell = sh.getRange('F40');
  moneyCell.insertCheckboxes();
  moneyCell.setValue(true); // ticked = include rates & € (the dialog's default)
  moneyCell.setBackground(CFG.colors.white).setHorizontalAlignment('center').setVerticalAlignment('middle');
  ss.setNamedRange(CFG.named.dbExpMoney, moneyCell);
  sh.getRange('G40').setValue('Include €').setFontColor(CFG.colors.gray).setFontSize(10).setVerticalAlignment('middle');

  // Result line — the only feedback channel a phone has (no dialogs, no toasts).
  sh.setRowHeight(41, 26);
  sh.getRange('B41:G41').merge();
  styleInputCell_(sh.getRange('B41:G41'));
  sh.getRange('B41').setVerticalAlignment('middle').setFontSize(10).setFontColor(CFG.colors.gray);
  ss.setNamedRange(CFG.named.dbExpOut, sh.getRange('B41'));

  sh.getRange('B42:G42').merge();
  sh.getRange('B42')
    .setValue('Pick client + period, then tick EXPORT. The PDF lands in Drive and a link appears above — give it up to a minute.')
    .setFontColor(CFG.colors.gray)
    .setFontStyle('italic')
    .setFontSize(8);
}

/**
 * Rewrites the period dropdown's source list (hidden column O) from
 * exportPeriods_, so a new month is pickable the moment it starts — no layout
 * update needed. Runs on every repaint, which on a phone means every start and
 * every stop. Best-effort: list upkeep must never break a timer.
 */
function refreshExportPeriods_(ctx) {
  try {
    var sh = ctx.ss.getSheetByName(CFG.sheets.dashboard);
    var pick = ctx.ss.getRangeByName(CFG.named.dbExpPeriod);
    if (!sh || !pick) return; // pre-v3 layout — nothing to keep current yet
    var labels = exportPeriods_(ctx).map(function (p) {
      return [p.label];
    });
    // Re-assert plain text on every pass, not just at build time: a sheet built
    // before this was pinned holds DATES where it should hold labels, and the
    // pick can never match one. Format first, then write.
    var list = sh.getRange(2, 15, labels.length, 1); // O2:O15
    list.setNumberFormat('@');
    list.setValues(labels);
    pick.setNumberFormat('@');
    // Repair the selection too: blank on a fresh build, stale once the month it
    // names rolls off the list, and a leftover Date on an older layout — each
    // one would fail the next tap.
    var current = String(pick.getValue() || '');
    var known = labels.some(function (l) {
      return l[0] === current;
    });
    if (!known) pick.setValue(labels[0][0]);
  } catch (e) {
    // Cosmetic list maintenance — never fatal.
  }
}

/**
 * The EXPORT tap: read the three controls, run the standard export pipeline,
 * and leave a tappable link (or a plain-English reason it didn't happen) in the
 * result cell. Never throws — the checkbox handler's finally must still run.
 */
function runPhoneExport_(ctx) {
  var out = ctx.ss.getRangeByName(CFG.named.dbExpOut);
  var say = function (text, color) {
    if (!out) return;
    out.setValue(text).setFontColor(color || CFG.colors.gray);
    SpreadsheetApp.flush(); // the phone repaints between steps, not just at the end
  };

  var client = String(getNamedValue_(ctx, CFG.named.dbExpClient) || '').trim();
  var label = String(getNamedValue_(ctx, CFG.named.dbExpPeriod) || '').trim();
  // Ticked (or missing entirely, on a layout that predates the control) = show
  // rates & €; only an explicit untick produces an hours-only timesheet.
  var includeMoney = getNamedValue_(ctx, CFG.named.dbExpMoney) !== false;
  if (!client) {
    say('Pick a client first (or "' + CFG.allClients + '").', CFG.colors.red);
    return;
  }

  var periods = exportPeriods_(ctx);
  var period = null;
  for (var i = 0; i < periods.length; i++) {
    if (periods[i].label === label) period = periods[i];
  }
  if (!period) {
    say('Pick a period from the dropdown.', CFG.colors.red);
    return;
  }

  say('⏳ Building ' + period.label + ' for ' + client + '…');
  try {
    var res = exportPdfCtx_(ctx, {
      client: client,
      year: period.year,
      month: period.month,
      includeMoney: includeMoney,
      save: true,
    });
    if (res.meta.rowCount === 0) {
      say('Nothing logged for ' + client + ' in ' + period.label + ' — the PDF says so explicitly.', CFG.colors.gold);
      return;
    }
    var summary = res.meta.rowCount + ' session' + (res.meta.rowCount === 1 ? '' : 's') + ' · ' +
      res.meta.totalHours.toFixed(2) + ' h' +
      (includeMoney ? ' · €' + res.meta.totalAmount.toFixed(2) : '');
    // A HYPERLINK formula, not a note: tapping a cell link is the one way to
    // open a Drive file from the Sheets mobile app.
    if (out && res.url) {
      out.setFormula('=HYPERLINK("' + res.url + '", "📄  Open the PDF  ·  ' + summary + '")')
        .setFontColor(CFG.colors.teal);
    } else {
      say('Saved to Drive · ' + summary, CFG.colors.green);
    }
  } catch (err) {
    say('Export failed: ' + (err && err.message ? err.message : err), CFG.colors.red);
  }
}
