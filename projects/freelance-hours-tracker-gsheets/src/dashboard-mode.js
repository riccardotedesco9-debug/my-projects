// dashboard-mode.js — the Dashboard's desktop/mobile view toggle.
//
// Sheets has no per-device layout: column widths, row heights and hidden rows
// are properties of the SHEET, shared by every viewer. So this is a MODE you
// flip, not responsive design — tick it on the way out, untick at the desk.
// Apps Script gets no device signal from an edit, so a manual toggle is the
// only mechanism available.
//
// Mobile mode changes the three things that actually hurt on a phone:
//   1. checkbox size — the glyph scales with the cell's FONT SIZE, which is the
//      only lever Sheets gives us over a tap target
//   2. column widths — the desktop layout is ~840px, far past a phone viewport
//   3. the analytics tail — hidden, so START / RUNNING NOW / EXPORT all sit
//      above the fold instead of below two cards

var DASH_LAYOUT = {
  // Column widths, A..H. Desktop is the canonical spec (buildDashboardSheet_
  // applies the same object, so the two can never drift).
  desktop: {
    cols: { 1: 24, 2: 120, 3: 140, 4: 140, 5: 170, 6: 110, 7: 110, 8: 24 },
    controlRow: 30, // the START / EXPORT bars
    runRow: 26, // one RUNNING NOW row
    boxFont: 10, // checkbox cells → glyph size follows this
    fieldFont: 10, // dropdowns + the labels beside them
    fieldRow: 21, // Sheets' default row height
    outRow: 26, // the export result / PDF link
  },
  mobile: {
    cols: { 1: 10, 2: 64, 3: 104, 4: 104, 5: 104, 6: 86, 7: 86, 8: 10 },
    controlRow: 46,
    runRow: 36,
    boxFont: 18,
    fieldFont: 14,
    fieldRow: 38,
    outRow: 40,
  },
  // Rows where a bold label and its input share the line (Client, Task, and the
  // export Client/Period pair). The WHOLE row's font moves together — a 14pt
  // field beside a 10pt label reads as broken rather than roomy.
  fieldRows: [7, 8, 39],
  // The by-client tail, hidden on a phone. AT A GLANCE (rows 25-30) survives —
  // today/week/month is the one thing worth a glance on the way out the door.
  tail: { from: 31, count: 7 },
};

/** The toggle itself: a checkbox under the title, labelled in plain English. */
function buildModeToggle_(sh, ss) {
  var box = sh.getRange('B4');
  box.insertCheckboxes();
  box.setBackground(CFG.colors.white).setHorizontalAlignment('center').setVerticalAlignment('middle');
  ss.setNamedRange(CFG.named.chkMobile, box);
  sh.getRange('C4:G4').merge();
  sh.getRange('C4')
    .setValue('Mobile view — bigger tap targets, narrow columns, analytics hidden')
    .setFontColor(CFG.colors.gray)
    .setFontSize(9)
    .setVerticalAlignment('middle');
}

/**
 * Reshapes the Dashboard for the given mode. Idempotent and fully reversible —
 * every property it touches is set in BOTH directions, so unticking restores
 * the desktop spec exactly rather than leaving half a mobile layout behind.
 */
function applyDashboardMode_(ctx, mobile) {
  var sh = ctx.ss.getSheetByName(CFG.sheets.dashboard);
  if (!sh) return;
  var L = mobile ? DASH_LAYOUT.mobile : DASH_LAYOUT.desktop;

  Object.keys(L.cols).forEach(function (c) {
    sh.setColumnWidth(Number(c), L.cols[c]);
  });

  // Input band: label + field together, and the row given room to breathe.
  // Applied BEFORE the control rows so that where the two overlap (Billing sits
  // on the START bar) the taller control height is what survives.
  DASH_LAYOUT.fieldRows.forEach(function (row) {
    sh.getRange(row, 2, 1, 6).setFontSize(L.fieldFont); // B..G
    sh.setRowHeight(row, L.fieldRow);
  });

  // Dropdowns sitting ON a control row take the font but not the height, and
  // each control's caption sits one column to its right — keep it legible with
  // the field it annotates.
  var billing = ctx.ss.getRangeByName(CFG.named.dbBilling);
  if (billing) billing.setFontSize(L.fieldFont);
  [CFG.named.dbBilling, CFG.named.dbExpMoney].forEach(function (name) {
    var r = ctx.ss.getRangeByName(name);
    if (r) sh.getRange(r.getRow(), r.getColumn() + 1).setFontSize(L.fieldFont);
  });

  // The result line is a tappable PDF link — size it like a field, not fine print.
  var out = ctx.ss.getRangeByName(CFG.named.dbExpOut);
  if (out) {
    out.setFontSize(L.fieldFont);
    sh.setRowHeight(out.getRow(), L.outRow);
  }

  // Action boxes + the include-€ toggle: font size IS tap-target size here.
  [CFG.named.chkStart, CFG.named.chkExport, CFG.named.dbExpMoney].forEach(function (name) {
    var r = ctx.ss.getRangeByName(name);
    if (!r) return; // control absent on an older layout — skip, never throw
    r.setFontSize(L.boxFont);
    sh.setRowHeight(r.getRow(), L.controlRow);
  });

  var stop = ctx.ss.getRangeByName(CFG.named.chkStopBlock);
  if (stop) {
    stop.setFontSize(L.boxFont);
    for (var i = 0; i < stop.getNumRows(); i++) sh.setRowHeight(stop.getRow() + i, L.runRow);
  }

  if (mobile) sh.hideRows(DASH_LAYOUT.tail.from, DASH_LAYOUT.tail.count);
  else sh.showRows(DASH_LAYOUT.tail.from, DASH_LAYOUT.tail.count);
}

/** Current mode, read off the toggle. False when the control doesn't exist. */
function isMobileMode_(ss) {
  var box = ss.getRangeByName(CFG.named.chkMobile);
  return !!box && box.getValue() === true;
}
