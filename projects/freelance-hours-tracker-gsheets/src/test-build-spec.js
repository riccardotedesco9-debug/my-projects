// test-build-spec.js — the throwaway tracker fresh off rebuild_ must match
// the layout spec exactly, and an EMPTY tracker must behave gracefully
// everywhere (reports, dashboard, sort) before a single row exists. Pure
// config/client helper units live here too — they need no sheet state.

function sectionBuildSpec_(S, env) {
  var ss = env.ss;

  // --- Workbook shape ---
  S.t('6 sheets', ss.getSheets().length, 6);
  S.t('locale en_GB', ss.getSpreadsheetLocale(), 'en_GB');
  S.t('timezone Europe/Malta', ss.getSpreadsheetTimeZone(), 'Europe/Malta');
  var missing = Object.keys(CFG.named).filter(function (k) { return !ss.getRangeByName(CFG.named[k]); });
  S.t('all named ranges registered', missing.join(','), '');

  // --- Controls wired the way the sidebar/phone expect ---
  var chkVal = ss.getRangeByName(CFG.named.chkStart).getDataValidation();
  S.t('phone Start cell is a real checkbox', chkVal && chkVal.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.CHECKBOX, true);
  var ddl = ss.getRangeByName(CFG.named.dbClient).getDataValidation();
  S.t('client dropdown validation present + strict', !!ddl && ddl.getAllowInvalid() === false, true);
  var billVal = ss.getRangeByName(CFG.named.dbBilling).getDataValidation();
  S.t('phone Billing dropdown present (Normal/Free/TBD)', !!billVal && billVal.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST, true);
  var taskVal = ss.getRangeByName(CFG.named.dbTask).getDataValidation();
  S.t('task cell has a recent-task dropdown (free-text allowed)', !!taskVal && taskVal.getAllowInvalid() === true, true);
  S.t('status banner idle text', String(ss.getRangeByName(CFG.named.dbStatus).getValue()), 'IDLE — ready to start');

  // --- Phone export block: the mobile stand-in for the export dialog. A fresh
  // build must be tappable as-is — every control defaulted, nothing stale. ---
  var dash = ss.getSheetByName(CFG.sheets.dashboard);
  var expChk = ss.getRangeByName(CFG.named.chkExport).getDataValidation();
  S.t('phone Export cell is a real checkbox', expChk && expChk.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.CHECKBOX, true);
  var expClientVal = ss.getRangeByName(CFG.named.dbExpClient).getDataValidation();
  S.t('export client dropdown present + strict', !!expClientVal && expClientVal.getAllowInvalid() === false, true);
  S.t('export client defaults to All Clients', String(ss.getRangeByName(CFG.named.dbExpClient).getValue()), CFG.allClients);
  var expPeriodVal = ss.getRangeByName(CFG.named.dbExpPeriod).getDataValidation();
  S.t('export period dropdown present + strict', !!expPeriodVal && expPeriodVal.getAllowInvalid() === false, true);
  var periods = exportPeriods_(env.ctx);
  S.t('export offers 12 months + 2 full years', periods.length, 14);
  S.t('export period list written to its hidden column', String(dash.getRange('O2').getValue()), periods[0].label);
  S.t('export period pre-selected to the newest month', String(ss.getRangeByName(CFG.named.dbExpPeriod).getValue()), periods[0].label);
  // Both must stay TEXT: Sheets parses "July 2026" into a date given half a
  // chance, and the handler resolves the pick by matching the label back
  // against the generated list — a Date there refuses every export.
  S.t('export period list holds text, not parsed dates', typeof dash.getRange('O2').getValue(), 'string');
  S.t('export period pick holds text, not a parsed date', typeof ss.getRangeByName(CFG.named.dbExpPeriod).getValue(), 'string');
  var moneyRange = ss.getRangeByName(CFG.named.dbExpMoney);
  var moneyVal = moneyRange.getDataValidation();
  S.t('export include-€ is a checkbox (same control as the desktop dialog)', moneyVal && moneyVal.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.CHECKBOX, true);
  S.t('export include-€ defaults to ticked', moneyRange.getValue(), true);
  S.t('export helper columns hidden (N:O)', dash.isColumnHiddenByUser(14) && dash.isColumnHiddenByUser(15), true);
  S.t('export result cell starts empty', String(ss.getRangeByName(CFG.named.dbExpOut).getValue()), '');

  // --- View mode: a fresh build is DESKTOP, and the flip is fully reversible.
  // Asserted as a round trip because a one-way mode that half-restores is the
  // failure that would actually bite — you'd untick and still be phone-shaped.
  var modeBox = ss.getRangeByName(CFG.named.chkMobile);
  var modeVal = modeBox.getDataValidation();
  S.t('view toggle is a checkbox', modeVal && modeVal.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.CHECKBOX, true);
  S.t('view toggle starts on desktop (unticked)', modeBox.getValue(), false);
  S.t('desktop column widths per spec', dash.getColumnWidth(3), DASH_LAYOUT.desktop.cols[3]);
  S.t('desktop shows the analytics tail', dash.isRowHiddenByUser(DASH_LAYOUT.tail.from), false);

  applyDashboardMode_(env.ctx, true);
  S.t('mobile narrows the columns', dash.getColumnWidth(3), DASH_LAYOUT.mobile.cols[3]);
  S.t('mobile enlarges the checkbox glyph (font size IS tap-target size)', ss.getRangeByName(CFG.named.chkStart).getFontSize(), DASH_LAYOUT.mobile.boxFont);
  S.t('mobile taller control rows', dash.getRowHeight(ss.getRangeByName(CFG.named.chkExport).getRow()), DASH_LAYOUT.mobile.controlRow);
  S.t('mobile hides the analytics tail', dash.isRowHiddenByUser(DASH_LAYOUT.tail.from), true);
  S.t('mobile KEEPS at-a-glance (row 25)', dash.isRowHiddenByUser(25), false);
  // Dropdowns scale too — a giant checkbox above a 10pt dropdown is half a job.
  S.t('mobile enlarges the client dropdown', ss.getRangeByName(CFG.named.dbClient).getFontSize(), DASH_LAYOUT.mobile.fieldFont);
  S.t('mobile enlarges the export period dropdown', ss.getRangeByName(CFG.named.dbExpPeriod).getFontSize(), DASH_LAYOUT.mobile.fieldFont);
  S.t('mobile enlarges the Billing dropdown on the control row', ss.getRangeByName(CFG.named.dbBilling).getFontSize(), DASH_LAYOUT.mobile.fieldFont);
  S.t('mobile gives the input rows room', dash.getRowHeight(7), DASH_LAYOUT.mobile.fieldRow);
  S.t('mobile keeps the START bar taller than a field row', dash.getRowHeight(ss.getRangeByName(CFG.named.chkStart).getRow()), DASH_LAYOUT.mobile.controlRow);
  S.t('mobile enlarges the PDF link line', ss.getRangeByName(CFG.named.dbExpOut).getFontSize(), DASH_LAYOUT.mobile.fieldFont);

  applyDashboardMode_(env.ctx, false);
  S.t('untick restores desktop widths', dash.getColumnWidth(3), DASH_LAYOUT.desktop.cols[3]);
  S.t('untick restores the checkbox size', ss.getRangeByName(CFG.named.chkStart).getFontSize(), DASH_LAYOUT.desktop.boxFont);
  S.t('untick restores the dropdown size', ss.getRangeByName(CFG.named.dbClient).getFontSize(), DASH_LAYOUT.desktop.fieldFont);
  S.t('untick restores the input row height', dash.getRowHeight(7), DASH_LAYOUT.desktop.fieldRow);
  S.t('untick unhides the analytics tail', dash.isRowHiddenByUser(DASH_LAYOUT.tail.from), false);

  // --- Time Log spec ---
  var log = env.logSh;
  S.t('log headers', log.getRange(1, 1, 1, CFG.log.lastCol).getValues()[0].join('|'), CFG.log.headers.join('|'));
  S.t('log header frozen', log.getFrozenRows(), 1);
  S.t('log has exactly one banding', log.getBandings().length, 1);
  S.t('log grid grown to the format horizon', log.getMaxRows() >= CFG.log.formatRows, true);
  S.t('log grid trimmed to the horizon, not a bloated tail', log.getMaxRows(), Math.max(CFG.log.formatRows, log.getLastRow()));
  var colVal = log.getRange(2, CFG.log.cols.client).getDataValidation();
  S.t('log client column validated + strict', !!colVal && colVal.getAllowInvalid() === false, true);
  var dump = log.getConditionalFormatRules().map(function (r) {
    var bc = r.getBooleanCondition();
    return bc ? bc.getCriteriaValues().join(' ') : '[gradient]';
  });
  S.t('11 conditional rules', dump.length, 11);
  // First-match-wins ORDER is the whole mechanism: combined midnight+busy first
  // (deepest shade first), then plain midnight, plain busy, the hours gradient,
  // then the status/amount cues (in-progress, free, TBD) on their own columns.
  S.t('rule 1 = midnight AND busiest (>12h)', dump[0].indexOf('INT($E2)') >= 0 && dump[0].indexOf('>12') >= 0, true);
  S.t('rule 4 = plain midnight (no busy clause)', dump[3].indexOf('INT($E2)') >= 0 && dump[3].indexOf('SUMIF') < 0, true);
  S.t('rule 7 = plain busy >8h (no midnight clause)', dump[6].indexOf('>8') >= 0 && dump[6].indexOf('INT($E2)') < 0, true);
  S.t('rule 8 = hours gradient', dump[7], '[gradient]');
  S.t('rule 9 = in-progress (Start set, End blank)', dump[8].indexOf('$D2') >= 0 && dump[8].indexOf('$E2') >= 0, true);
  S.t('rule 10 = free amount ($I2="Free")', dump[9].indexOf('Free') >= 0, true);
  S.t('rule 11 = TBD amount ($I2="TBD")', dump[10].indexOf('TBD') >= 0, true);
  S.t('log has a click-to-sort/filter on its headers', !!log.getFilter(), true);

  // --- Clients / Settings / Summary / Report spec ---
  S.t('clients headers', env.clientsSh.getRange(1, 1, 1, 3).getValues()[0].join('|'), CFG.clients.headers.join('|'));
  S.t('seed client 1', String(env.clientsSh.getRange(2, 1).getValue()), 'Pet Centre');
  S.t('seed client 2', String(env.clientsSh.getRange(3, 1).getValue()), 'Splash Store');
  S.t('clients sheet has a click-to-sort/filter on its headers', !!env.clientsSh.getFilter(), true);
  var settings = ss.getSheetByName(CFG.sheets.settings);
  S.t('settings hidden', settings.isSheetHidden(), true);
  S.t('settings schema stamped', String(settings.getRange('C9').getValue()), CFG.schemaVersion);
  var summary = ss.getSheetByName(CFG.sheets.summary);
  S.t('summary ships its 2 charts', summary.getCharts().length, 2);
  S.t('summary chart data is a live QUERY', summary.getRange('T2').getFormula().indexOf('QUERY') >= 0, true);
  S.t('summary cumulative is a live SCAN', summary.getRange('V3').getFormula().indexOf('SCAN') >= 0, true);
  var winCtrl = summary.getRange('F2').getDataValidation();
  S.t('summary window selector present (F2 dropdown)', !!winCtrl && winCtrl.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST, true);
  S.t('summary window default is a valid months value', [3, 6, 12, 24].indexOf(Number(summary.getRange('F2').getValue())) >= 0, true);
  S.t('summary totals QUERY references the F2 selector', summary.getRange('B5').getFormula().indexOf('$F$2') >= 0, true);
  var cliBox = summary.getRange('F22').getDataValidation();
  S.t('summary client filter present (F22 checkboxes)', !!cliBox && cliBox.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.CHECKBOX, true);
  S.t('summary client checkboxes default ticked (all shown)', summary.getRange('F22').getValue(), true);
  S.t('summary totals QUERY filters by the client checklist (X1)', summary.getRange('B5').getFormula().indexOf('$X$1') >= 0, true);
  S.t('summary grid trimmed to content (not the 1000 default)', summary.getMaxRows(), Math.max(80, summary.getLastRow()));
  S.t('dashboard grid trimmed to content (not the 1000 default)', ss.getSheetByName(CFG.sheets.dashboard).getMaxRows(), Math.max(50, ss.getSheetByName(CFG.sheets.dashboard).getLastRow()));
  S.t('report shell starts chartless', env.repSh.getCharts().length, 0);

  // --- Empty-tracker behavior (zero rows anywhere) ---
  S.t('sort on empty log is a graceful no-op', sortLogByDate_(env.ctx), false);
  var meta = buildReportCtx_(env.ctx, 'Pet Centre', env.y + 1, 3, true, { forceFallback: true });
  S.t('empty report: zero rows', meta.rowCount, 0);
  S.t('empty report: says so in the body', String(env.repSh.getRange('B12').getValue()), MSG.noSessions);
  S.t('empty report: TOTAL 0.00', Number(env.repSh.getRange(13, 7).getValue()), 0);
  S.t('empty report: still signed', String(env.repSh.getRange(meta.signatureRow, 2).getValue()), CFG.ownerName);
  S.t('empty report: still sealed', /^Document verification: [0-9A-F]{40}$/.test(String(env.repSh.getRange(meta.signatureRow + 2, 2).getValue())), true);
  S.t('empty report: no pie', env.repSh.getCharts().length, 0);
  SpreadsheetApp.flush();
  S.t('dashboard Today reads 0.00 on empty log', Number(ss.getRangeByName(CFG.named.dbToday).getValue()), 0);
  S.t('by-client card degrades to a dash', String(ss.getRangeByName(CFG.named.dbClient).getSheet().getRange('E26').getValue()), '—');
  S.t('summary totals read 0 on empty log', Number(summary.getRange('B5').getValue()), 0);
  var snap = buildSnapshot_(env.ctx);
  S.t('snapshot on empty tracker: nothing running', snap.running.length, 0);
  S.t('snapshot on empty tracker: 0 hours today', snap.todayHours, 0);

  // --- Pure units: column letters, owner props, UX copy ---
  S.t('colLetter_ 1→A', colLetter_(1), 'A');
  S.t('colLetter_ 8→H', colLetter_(8), 'H');
  S.t('colLetter_ 26→Z', colLetter_(26), 'Z');
  S.t('colLetter_ 27→AA', colLetter_(27), 'AA');
  S.t('colLetter_ 52→AZ', colLetter_(52), 'AZ');
  S.t('colLetter_ 703→AAA', colLetter_(703), 'AAA');
  S.t('ownerProp_ falls back for unset keys', ownerProp_('__SMOKE_UNSET_KEY__', 'fallback'), 'fallback');
  S.t('MSG.logged formats 2 decimals', MSG.logged(1.5, 'X'), 'Logged 1.50 h for X.');
  S.t('MSG.stoppedAll singular/plural', MSG.stoppedAll(1) + '|' + MSG.stoppedAll(3), 'Stopped & logged 1 session.|Stopped & logged 3 sessions.');

  // --- Client lookup semantics (temporary dirty rows, cleared after) ---
  env.clientsSh.getRange(5, 1, 4, 2).setValues([
    ['Text Rate Co', 'TBD'],
    ['Zero Rate Co', 0],
    ['String Rate Co', '45'],
    ['Negative Rate Co', -5],
  ]);
  S.t('text rate → exists but no usable rate', getClientInfo_(env.ctx, 'Text Rate Co').exists === true && getClientInfo_(env.ctx, 'Text Rate Co').hasRate === false, true);
  S.t('zero rate → no usable rate', getClientInfo_(env.ctx, 'Zero Rate Co').hasRate, false);
  S.t('numeric-string rate → usable', getClientInfo_(env.ctx, 'String Rate Co').hasRate, true);
  S.t('negative rate → no usable rate', getClientInfo_(env.ctx, 'Negative Rate Co').hasRate, false);
  env.clientsSh.getRange(5, 1, 4, 3).clearContent();
  S.t('clientExists_ trims whitespace', clientExists_(env.ctx, '  Pet Centre  '), true);
  S.t('clientExists_ is case-insensitive', clientExists_(env.ctx, 'pet centre'), true);
  S.t('clientExists_ refuses blank', clientExists_(env.ctx, '   '), false);
  var withEmail = getClientsWithEmail_(env.ctx).map(function (c) { return c.name; });
  S.t('draft audience = only clients with an email', withEmail.join(','), 'Pet Centre');
}
