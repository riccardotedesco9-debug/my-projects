// config.js — single source of truth for names, colors, and layout constants.
// Every other file reads CFG; nothing else hardcodes a sheet name or hex color.

var CFG = {
  // Owner identity is read from Script Properties (OWNER_NAME / OWNER_EMAIL /
  // OWNER_ID), never committed here — this repo is public and that is personal
  // data. Set them in the Apps Script editor → Project Settings → Script
  // Properties. Unset values fall back to neutral placeholders.
  get ownerName() { return ownerProp_('OWNER_NAME', 'Freelancer'); },
  get ownerEmail() { return ownerProp_('OWNER_EMAIL', ''); },
  get ownerId() { return ownerProp_('OWNER_ID', ''); },
  allClients: 'All Clients',

  sheets: {
    dashboard: 'Dashboard',
    log: 'Time Log',
    report: 'Report',
    summary: 'Summary',
    clients: 'Clients',
    settings: 'Settings',
  },

  // Palette carried over from the Excel reference (premium navy/teal look).
  colors: {
    navy: '#1F3864',
    teal: '#0F766E',
    tealSoft: '#B2DFDB',
    green: '#2E7D32',
    red: '#B91C1C',
    gray: '#6B7280',
    grayFill: '#F3F4F6',
    grayLine: '#D1D5DB',
    amber: '#FEF3C7', // busy-day shading, light → deep as the day's hours climb
    amberMid: '#FDE68A',
    amberDeep: '#FCD34D',
    gold: '#B45309',
    white: '#FFFFFF',
    paper: '#F7F7F4', // warm canvas behind the Dashboard/Summary cards
  },

  // Font used across sheets + HTML surfaces (silently ignored if unavailable).
  fontFamily: 'Outfit',

  // Time Log geometry. Columns A..I, header on row 1, data from row 2.
  // Status (G) sits BEFORE Rate/Amount so a client's view can import A2:G — the
  // in-progress/free label — without ever touching money (H/I).
  log: {
    headerRow: 1,
    firstDataRow: 2,
    lastCol: 9,
    headers: ['Date', 'Client', 'Task', 'Start', 'End', 'Hours', 'Status', 'Rate', 'Amount'],
    cols: { date: 1, client: 2, task: 3, start: 4, end: 5, hours: 6, status: 7, rate: 8, amount: 9 },
    // The log grid is sized to this many rows (was 5000 — a huge empty scroll).
    // The grid grows past it automatically as you log, and never shrinks below
    // your data; conditional formats + banding cover exactly this range.
    formatRows: 500,
  },

  // Max concurrent running sessions surfaced on the mobile Dashboard's RUNNING
  // NOW block (the sidebar shows all; overflow past this is noted in the banner).
  run: { maxRows: 6 },

  // Busy-day amber ramp thresholds (hours/day): the date cell shades amber →
  // amberMid → amberDeep as a day's total passes 8 → 10 → 12. Shared by the Time
  // Log and the client viewer so their busy-day cue can never drift apart.
  busyDayThresholds: [8, 10, 12],

  // Clients sheet: Client | Rate | Email, header row 1.
  clients: {
    headers: ['Client', 'Rate (€/h)', 'Email'],
    cols: { name: 1, rate: 2, email: 3 },
    seed: ['Pet Centre', 'Splash Store'],
  },

  // Named ranges (all defined by rebuild_). db* = Dashboard inputs/displays,
  // chk* = mobile checkbox cells. dbBilling is the Normal/Free/TBD dropdown that
  // a phone Start reads. dbRunIds is the hidden per-row startedAtMs column beside
  // the RUNNING NOW stop checkboxes (chkStopBlock).
  named: {
    dbClient: 'dbClient',
    dbTask: 'dbTask',
    dbStatus: 'dbStatus',
    dbToday: 'dbToday',
    dbMonth: 'dbMonth',
    dbBilling: 'dbBilling',
    chkStart: 'chkStart',
    chkStopBlock: 'chkStopBlock',
    dbRunIds: 'dbRunIds',
  },

  // Script Properties keys. `state` is retained only so the one-time legacy
  // migration (migrateLegacyTimerState_) can find + delete the old single-timer
  // blob; running timers now live as Time Log rows. Test contexts prefix these
  // with 'test:'.
  props: {
    state: 'timerState',
  },
  schemaVersion: '2',

  // Drive layout: root folder holds the spreadsheet + subfolders.
  folders: {
    root: 'Freelance Hours Tracker',
    timesheets: 'Timesheets',
    viewers: 'Client Views',
  },

  formats: {
    date: 'dd/mm/yyyy',
    time: 'hh:mm',
    hours: '0.00',
    euro: '€#,##0.00',
    // Blank-when-zero euro (dashboard/summary widgets stay uncluttered).
    euroBlankZero: '€#,##0.00;;',
    month: 'mmmm yyyy',
    monthShort: 'mmm yyyy',
  },
};

// The six sheets in canonical left-to-right order + tab colour — ONE source for
// both the full rebuild (wipeWorkbook_ inserts them) and updateLayout_
// (applyTabColorsAndOrder_ reorders them), so the two paths can't diverge.
// Assigned after the literal because it references CFG.sheets / CFG.colors.
CFG.sheetOrder = [
  [CFG.sheets.dashboard, CFG.colors.navy],
  [CFG.sheets.log, CFG.colors.teal],
  [CFG.sheets.summary, CFG.colors.teal],
  [CFG.sheets.clients, CFG.colors.gray],
  [CFG.sheets.report, CFG.colors.gold],
  [CFG.sheets.settings, CFG.colors.gray],
];

// The one deliberate UX copy block (single place to reword any user-facing text).
var MSG = {
  pickClient: 'Pick a client first — the dropdown on the Dashboard (or in the timer panel).',
  pickTask: "Type what you're working on — the Task can't be blank.",
  unknownClient: function (c) {
    return 'Client "' + c + '" is not on the Clients sheet. Add it there first (one row), then start.';
  },
  alreadyRunning: 'That client + task is already running — pick a different task to run a second clock.',
  noneRunning: 'No timers running.',
  noRate: function (c) {
    return c + ' has no €/h rate on the Clients sheet — amounts stay €0 until you add it (it back-fills past rows).';
  },
  logged: function (h, client) {
    return 'Logged ' + h.toFixed(2) + ' h for ' + client + '.';
  },
  stoppedAll: function (n) {
    return 'Stopped & logged ' + n + ' session' + (n === 1 ? '' : 's') + '.';
  },
  selectLogRows: 'Select one or more session rows on the Time Log first.',
  noSessions: 'No sessions logged for this selection.',
};

// Owner-identity accessor — reads Script Properties, cached per execution so
// the CFG getters don't hit the property store on every reference.
var _ownerCache = {};
function ownerProp_(key, fallback) {
  if (!(key in _ownerCache)) {
    try {
      _ownerCache[key] = PropertiesService.getScriptProperties().getProperty(key) || fallback;
    } catch (e) {
      _ownerCache[key] = fallback;
    }
  }
  return _ownerCache[key];
}
