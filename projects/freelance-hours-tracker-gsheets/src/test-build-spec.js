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
  S.t('status banner idle text', String(ss.getRangeByName(CFG.named.dbStatus).getValue()), 'IDLE — ready to start');

  // --- Time Log spec ---
  var log = env.logSh;
  S.t('log headers', log.getRange(1, 1, 1, CFG.log.lastCol).getValues()[0].join('|'), CFG.log.headers.join('|'));
  S.t('log header frozen', log.getFrozenRows(), 1);
  S.t('log has exactly one banding', log.getBandings().length, 1);
  S.t('log grid grown to the format horizon', log.getMaxRows() >= CFG.log.formatRows, true);
  var colVal = log.getRange(2, CFG.log.cols.client).getDataValidation();
  S.t('log client column validated + strict', !!colVal && colVal.getAllowInvalid() === false, true);
  var dump = log.getConditionalFormatRules().map(function (r) {
    var bc = r.getBooleanCondition();
    return bc ? bc.getCriteriaValues().join(' ') : '[gradient]';
  });
  S.t('8 conditional rules', dump.length, 8);
  // First-match-wins ORDER is the whole mechanism: combined midnight+busy
  // first (deepest shade first), then plain midnight, plain busy, gradient.
  S.t('rule 1 = midnight AND busiest (>12h)', dump[0].indexOf('INT($E2)') >= 0 && dump[0].indexOf('>12') >= 0, true);
  S.t('rule 4 = plain midnight (no busy clause)', dump[3].indexOf('INT($E2)') >= 0 && dump[3].indexOf('SUMIF') < 0, true);
  S.t('rule 7 = plain busy >8h (no midnight clause)', dump[6].indexOf('>8') >= 0 && dump[6].indexOf('INT($E2)') < 0, true);
  S.t('rule 8 = hours gradient', dump[7], '[gradient]');
  S.t('log has a click-to-sort/filter on its headers', !!log.getFilter(), true);

  // --- Clients / Settings / Summary / Report spec ---
  S.t('clients headers', env.clientsSh.getRange(1, 1, 1, 3).getValues()[0].join('|'), CFG.clients.headers.join('|'));
  S.t('seed client 1', String(env.clientsSh.getRange(2, 1).getValue()), 'Pet Centre');
  S.t('seed client 2', String(env.clientsSh.getRange(3, 1).getValue()), 'Splash Store');
  S.t('clients sheet has a click-to-sort/filter on its headers', !!env.clientsSh.getFilter(), true);
  var settings = ss.getSheetByName(CFG.sheets.settings);
  S.t('settings hidden', settings.isSheetHidden(), true);
  S.t('settings mirror idle', String(settings.getRange('C4').getValue()), 'IDLE');
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
  S.t('report shell starts chartless', env.repSh.getCharts().length, 0);

  // --- Empty-tracker behavior (zero rows anywhere) ---
  S.t('sort on empty log is a graceful no-op', sortLogByDate_(env.ctx), false);
  var meta = buildReportCtx_(env.ctx, 'Pet Centre', env.y + 1, 3, true, { forceFallback: true });
  S.t('empty report: zero rows', meta.rowCount, 0);
  S.t('empty report: says so in the body', String(env.repSh.getRange('B10').getValue()), MSG.noSessions);
  S.t('empty report: TOTAL 0.00', Number(env.repSh.getRange(11, 7).getValue()), 0);
  S.t('empty report: still signed', String(env.repSh.getRange(meta.signatureRow, 2).getValue()), CFG.ownerName);
  S.t('empty report: still sealed', /^Document verification: [0-9A-F]{40}$/.test(String(env.repSh.getRange(meta.signatureRow + 2, 2).getValue())), true);
  S.t('empty report: no pie', env.repSh.getCharts().length, 0);
  SpreadsheetApp.flush();
  S.t('dashboard Today reads 0.00 on empty log', Number(ss.getRangeByName(CFG.named.dbToday).getValue()), 0);
  S.t('by-client card degrades to a dash', String(ss.getRangeByName(CFG.named.dbClient).getSheet().getRange('E18').getValue()), '—');
  S.t('summary totals read 0 on empty log', Number(summary.getRange('B5').getValue()), 0);
  var snap = buildSnapshot_(env.ctx, idleState_());
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
  S.t('MSG.switchPrompt names the task', MSG.switchPrompt('A', 'B').indexOf('"A — B"') >= 0, true);
  S.t('MSG.switchPrompt omits an empty task', MSG.switchPrompt('A', '').indexOf(' — ') < 0, true);

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
