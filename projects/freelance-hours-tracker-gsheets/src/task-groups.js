// task-groups.js — consolidates a month's session tasks into named "type of
// work" groups for the timesheet's WORK BREAKDOWN section + pie chart.
// Semantic grouping (same work, differently worded) is done by Claude Haiku;
// everything degrades to deterministic exact-match grouping when there is no
// API key, the call fails, or a caller forces it (tests). Results are cached
// per client+month+taskset so re-exports are stable and don't re-bill.

// Classification = smallest model. The dated ID is the canonical, always-valid
// form — a bare "claude-haiku-4-5" 404s on the Messages API, which silently
// drops every grouping to the exact-match fallback.
var TASKGROUPS_MODEL = 'claude-haiku-4-5-20251001';

/**
 * One-tap diagnostic (menu: Maintenance → Check AI grouping): makes ONE real
 * grouping call and reports exactly why it works or falls back — so a wrong
 * model ID, an unfunded key, or a missing key is named, not silently swallowed.
 */
function checkAiGrouping() {
  var ui = SpreadsheetApp.getUi();
  var key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) {
    ui.alert('AI grouping', 'No ANTHROPIC_API_KEY set — timesheets use the exact-match fallback (raw task names, still grouped by identical text). Add the key in Project Settings → Script Properties to enable AI grouping.', ui.ButtonSet.OK);
    return;
  }
  var sample = [
    { task: 'Restock shelves', hours: 2 }, { task: 'Inventory count', hours: 1 },
    { task: 'Dog grooming', hours: 3 }, { task: 'Reception cover', hours: 1 },
  ];
  try {
    var resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({ model: TASKGROUPS_MODEL, max_tokens: 400, messages: [{ role: 'user', content: 'Reply ONLY with a JSON array [{"label":"...","members":[0]}] grouping these by type: ' + JSON.stringify(sample) }] }),
    });
    var code = resp.getResponseCode();
    if (code === 200) {
      var groups = callClaudeForGroups_(key, sample.map(function (t) { return { task: t.task, hours: t.hours }; }));
      ui.alert('AI grouping ✓ working', 'Model ' + TASKGROUPS_MODEL + ' responded. Sample grouped into ' + groups.length + ' types:\n\n' + groups.map(function (g) { return '• ' + g.label; }).join('\n'), ui.ButtonSet.OK);
    } else {
      var hint = code === 404 ? 'model ID not found' : code === 401 ? 'invalid API key' : code === 400 ? 'bad request / credit balance too low' : code === 429 ? 'rate limited' : 'API error';
      ui.alert('AI grouping ✗ falling back', 'The API returned ' + code + ' (' + hint + '). Timesheets still group by exact task text; fix the key/credits to get AI grouping.\n\n' + String(resp.getContentText()).slice(0, 300), ui.ButtonSet.OK);
    }
  } catch (e) {
    ui.alert('AI grouping ✗', 'Call failed: ' + e + '\n\nTimesheets fall back to exact-match grouping.', ui.ButtonSet.OK);
  }
}

/** Returns [{label, hours}] sorted by hours desc. Never throws. */
function consolidateTasks_(ctx, client, yyyymm, rows, opts) {
  opts = opts || {};
  var tasks = uniqueTasksWithHours_(rows);
  if (tasks.length === 0) return [];
  if (tasks.length <= 2 || opts.forceFallback) return fallbackGroups_(tasks);

  var props = PropertiesService.getScriptProperties();
  var cacheKey =
    'taskGroups:' + sanitize_(String(client)) + ':' + yyyymm + ':' +
    taskHash_(tasks.map(function (t) { return t.task; }).join(''));

  var cached = props.getProperty(cacheKey);
  if (cached) {
    try {
      return applyGroups_(JSON.parse(cached), tasks);
    } catch (e) {
      // fall through to a fresh call
    }
  }

  var apiKey = props.getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) return fallbackGroups_(tasks);
  try {
    var groups = callClaudeForGroups_(apiKey, tasks);
    props.setProperty(cacheKey, JSON.stringify(groups));
    return applyGroups_(groups, tasks);
  } catch (e) {
    return fallbackGroups_(tasks);
  }
}

/** Normalizes (trim/lowercase) and sums hours + € per unique task string. */
function uniqueTasksWithHours_(rows) {
  var byKey = {};
  var order = [];
  rows.forEach(function (r) {
    var label = String(r.task || '').trim() || 'Untitled work';
    var key = label.toLowerCase();
    if (!(key in byKey)) {
      byKey[key] = { task: label, hours: 0, amount: 0 };
      order.push(key);
    }
    byKey[key].hours += r.hours;
    byKey[key].amount += r.amount || 0;
  });
  return order.map(function (k) {
    return {
      task: byKey[k].task,
      hours: Math.round(byKey[k].hours * 100) / 100,
      amount: Math.round(byKey[k].amount * 100) / 100,
    };
  });
}

function fallbackGroups_(tasks) {
  return tasks
    .map(function (t) { return { label: t.task, hours: t.hours, amount: t.amount }; })
    .sort(function (a, b) { return b.hours - a.hours; });
}

/** Maps AI groups back onto hours + €; anything unassigned keeps its own slice. */
function applyGroups_(groups, tasks) {
  var assigned = {};
  var out = [];
  (Array.isArray(groups) ? groups : []).forEach(function (g) {
    var hours = 0;
    var amount = 0;
    (g.members || []).forEach(function (i) {
      if (tasks[i] && !assigned[i]) {
        assigned[i] = true;
        hours += tasks[i].hours;
        amount += tasks[i].amount;
      }
    });
    // hours OR amount: a group of only fixed-fee tasks has 0 h but real € —
    // dropping it would silently lose that money from the breakdown table.
    if (hours > 0 || amount > 0) {
      out.push({
        label: String(g.label || 'Other work'),
        hours: Math.round(hours * 100) / 100,
        amount: Math.round(amount * 100) / 100,
      });
    }
  });
  tasks.forEach(function (t, i) {
    if (!assigned[i]) out.push({ label: t.task, hours: t.hours, amount: t.amount });
  });
  return out.sort(function (a, b) { return b.hours - a.hours; });
}

function callClaudeForGroups_(apiKey, tasks) {
  var prompt =
    'These are billed freelance work sessions for one client\'s monthly timesheet. ' +
    'Group tasks that are the same TYPE of work and give each group a short, professional ' +
    'label an employer immediately understands (e.g. "Inventory & stock management"). ' +
    'Use 3-7 groups; every index must appear in exactly one group. ' +
    'Reply with ONLY a JSON array, no prose: [{"label":"...","members":[0,2]}]\n\nTasks:\n' +
    JSON.stringify(tasks.map(function (t, i) { return { i: i, task: t.task, hours: t.hours }; }));

  var resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({
      model: TASKGROUPS_MODEL,
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error('Anthropic API ' + resp.getResponseCode());
  }
  var data = JSON.parse(resp.getContentText());
  var text = (data.content && data.content[0] && data.content[0].text) || '';
  var jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('No JSON array in model response');
  var groups = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(groups)) throw new Error('Model response is not an array');
  return groups;
}

/** Tiny stable string hash for cache keys. */
function taskHash_(s) {
  var h = 0;
  for (var i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return String(h >>> 0);
}
