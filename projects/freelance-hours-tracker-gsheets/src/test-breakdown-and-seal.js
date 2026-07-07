// test-breakdown-and-seal.js — the WORK BREAKDOWN grouping pipeline as pure
// units (normalization, fallback, AI-group application, cache path — never a
// network call), the HMAC verification seal's tamper-evidence, and the PDF
// filename grammar.

function sectionBreakdownSeal_(S, env) {
  var props = PropertiesService.getScriptProperties();

  // --- uniqueTasksWithHours_: normalization + summing ---
  var uniq = uniqueTasksWithHours_([
    { task: ' Grooming ', hours: 1, amount: 45 },
    { task: 'grooming', hours: 2, amount: 90 },
    { task: 'GROOMING', hours: 1, amount: 45 },
    { task: '', hours: 0.5, amount: 10 },
  ]);
  S.t('case/whitespace variants merge into one task', uniq.length, 2);
  S.t('first-seen casing wins', uniq[0].task, 'Grooming');
  S.t('hours summed across variants', uniq[0].hours, 4);
  S.t('€ summed across variants', uniq[0].amount, 180);
  S.t('blank task becomes "Untitled work"', uniq[1].task, 'Untitled work');

  // --- fallbackGroups_: deterministic, hours-desc ---
  var fb = fallbackGroups_([{ task: 'Small', hours: 1, amount: 10 }, { task: 'Big', hours: 5, amount: 50 }]);
  S.t('fallback groups sort by hours desc', fb[0].label + '|' + fb[1].label, 'Big|Small');

  // --- applyGroups_: robustness against every malformed AI reply ---
  var tasks = [
    { task: 'A', hours: 2, amount: 90 },
    { task: 'B', hours: 3, amount: 60 },
    { task: 'C', hours: 1, amount: 30 },
  ];
  var out = applyGroups_([{ label: 'AB work', members: [0, 0, 1, 9] }], tasks);
  S.t('duplicate member index counted once', out[0].hours, 5);
  S.t('out-of-range index ignored', out[0].amount, 150);
  S.t('unassigned task keeps its own slice', out.length === 2 && out[1].label === 'C', true);
  var sum = out.reduce(function (a, g) { return a + g.hours; }, 0);
  S.t('grouping never changes total hours', sum, 6);
  out = applyGroups_([{ members: [0] }], [{ task: 'X', hours: 1, amount: 10 }]);
  S.t('missing label defaults to "Other work"', out[0].label, 'Other work');
  out = applyGroups_([{ label: 'Fee work', members: [0] }], [{ task: 'Logo', hours: 0, amount: 250 }]);
  S.t('a 0-hour fixed-fee group keeps its € (never vanishes)', out.length === 1 && out[0].amount === 250, true);
  out = applyGroups_('not an array', tasks);
  S.t('garbage groups → every task keeps its own slice', out.length, 3);

  // --- consolidateTasks_: cache + fallback paths, ZERO network ---
  // The suite never lets consolidateTasks_ reach the live API: every call here
  // either short-circuits (≤2 tasks) or forces the fallback. The cache-HIT
  // branch is verified directly through applyGroups_ (exactly what the function
  // returns on a hit: applyGroups_(JSON.parse(cached), tasks)) so we don't
  // depend on same-execution property write-visibility — and can never spend.
  var mk = function (tasksArr) {
    return tasksArr.map(function (t) { return { task: t[0], hours: t[1], amount: t[2] }; });
  };
  var threeRows = mk([['Alpha', 2, 20], ['Beta', 3, 30], ['Gamma', 1, 10]]);
  var threeTasks = uniqueTasksWithHours_(threeRows);
  var cacheHit = applyGroups_(JSON.parse(JSON.stringify([{ label: 'Seeded group', members: [0, 1, 2] }])), threeTasks);
  S.t('cache-hit grouping is applied verbatim', cacheHit.length === 1 && cacheHit[0].label === 'Seeded group', true);
  S.t('cache-hit grouping preserves total hours', cacheHit[0].hours, 6);
  var two = consolidateTasks_(env.ctx, 'CacheTest', '2026-02', mk([['One', 1, 10], ['Two', 2, 20]]), {});
  S.t('≤2 tasks short-circuit to exact-match groups', two.length, 2);
  var key2 = 'taskGroups:' + sanitize_('CacheTest') + ':2026-02:' + taskHash_('OneTwo');
  S.t('short-circuit writes no cache entry', props.getProperty(key2), null);
  var key3 = 'taskGroups:' + sanitize_('CacheTest') + ':2026-01:' + taskHash_('AlphaBetaGamma');
  var forced = consolidateTasks_(env.ctx, 'CacheTest', '2026-01', threeRows, { forceFallback: true });
  S.t('forceFallback yields exact-match groups', forced.length, 3);
  S.t('forceFallback writes no cache entry', props.getProperty(key3), null);
  S.t('taskHash_ deterministic', taskHash_('abc'), taskHash_('abc'));
  S.t('taskHash_ separates different sets', taskHash_('abc') === taskHash_('abd'), false);

  // --- Verification seal: deterministic, forgery- and tamper-evident ---
  var sealRows = [
    { start: new Date(2026, 0, 5, 9, 0), end: new Date(2026, 0, 5, 12, 0), date: new Date(2026, 0, 5), task: 'Work A', hours: 3, amount: 135 },
    { start: null, end: null, date: new Date(2026, 0, 15), task: 'Fee B', hours: 0, amount: 250 },
  ];
  var ts = '05/01/2026 10:00';
  var seal1 = documentSeal_(env.ctx, 'Pet Centre', 2026, 1, sealRows, 3, 385, ts);
  var seal2 = documentSeal_(env.ctx, 'Pet Centre', 2026, 1, sealRows, 3, 385, ts);
  S.t('seal is deterministic for identical content', seal1, seal2);
  S.t('seal shape: 40 hex chars', /^[0-9A-F]{40}$/.test(seal1), true);
  var reRow = function (r, patch) {
    var copy = { start: r.start, end: r.end, date: r.date, task: r.task, hours: r.hours, amount: r.amount };
    Object.keys(patch).forEach(function (k) { copy[k] = patch[k]; });
    return copy;
  };
  var tampered = [reRow(sealRows[0], { amount: 136 }), reRow(sealRows[1], {})];
  S.t('editing one € re-derives a different seal', documentSeal_(env.ctx, 'Pet Centre', 2026, 1, tampered, 3, 385, ts) === seal1, false);
  var renamed = [reRow(sealRows[0], { task: 'Work Z' }), reRow(sealRows[1], {})];
  S.t('editing one task re-derives a different seal', documentSeal_(env.ctx, 'Pet Centre', 2026, 1, renamed, 3, 385, ts) === seal1, false);
  S.t('signing secret is stable across calls', getOrCreateSigningSecret_(), getOrCreateSigningSecret_());

  // --- Filename grammar ---
  S.t('monthly filename zero-pads', timesheetFilename_('Pet Centre', 2026, 7), 'Timesheet_2026-07_PetCentre_' + sanitize_(CFG.ownerName) + '.pdf');
  S.t('late-year months unpadded', timesheetFilename_('Pet Centre', 2026, 11).indexOf('2026-11') > 0, true);
  S.t('whole-year filename drops the month', timesheetFilename_('Pet Centre', 2026, 0), 'Timesheet_2026_PetCentre_' + sanitize_(CFG.ownerName) + '.pdf');
  S.t("sanitize_ strips apostrophes + spaces", sanitize_("Paws 'n' Claws"), 'PawsnClaws');
  S.t('sanitize_ strips non-ASCII (documented)', sanitize_('Żebbuġ Kafè'), 'ebbuKaf');
}
