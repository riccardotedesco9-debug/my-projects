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

  // Time Log geometry. Columns A..H, header on row 1, data from row 2.
  log: {
    headerRow: 1,
    firstDataRow: 2,
    lastCol: 8,
    headers: ['Date', 'Client', 'Task', 'Start', 'End', 'Hours', 'Rate', 'Amount'],
    cols: { date: 1, client: 2, task: 3, start: 4, end: 5, hours: 6, rate: 7, amount: 8 },
    // The log grid is sized to this many rows (was 5000 — a huge empty scroll).
    // The grid grows past it automatically as you log, and never shrinks below
    // your data; conditional formats + banding cover exactly this range.
    formatRows: 500,
  },

  // Clients sheet: Client | Rate | Email, header row 1.
  clients: {
    headers: ['Client', 'Rate (€/h)', 'Email'],
    cols: { name: 1, rate: 2, email: 3 },
    seed: ['Pet Centre', 'Splash Store'],
  },

  // Named ranges (all defined by rebuild_). db* = Dashboard inputs/displays,
  // chk* = mobile checkbox cells, st* = Settings display mirror.
  named: {
    dbClient: 'dbClient',
    dbTask: 'dbTask',
    dbStatus: 'dbStatus',
    dbToday: 'dbToday',
    dbMonth: 'dbMonth',
    chkStart: 'chkStart',
    chkStop: 'chkStop',
    stStatus: 'stStatus',
    stStartedAt: 'stStartedAt',
    stClient: 'stClient',
    stTask: 'stTask',
  },

  // Script Properties keys. Test contexts prefix these with 'test:'.
  props: {
    state: 'timerState',
    schema: 'schemaVersion',
  },
  schemaVersion: '1',

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
    generated: 'dd/mm/yyyy hh:mm',
  },
};

// The one deliberate UX copy block (single place to reword any user-facing text).
var MSG = {
  pickClient: 'Pick a client first — the dropdown on the Dashboard (or in the timer panel).',
  unknownClient: function (c) {
    return 'Client "' + c + '" is not on the Clients sheet. Add it there first (one row), then start.';
  },
  alreadyRunning: 'This session is already running.',
  notRunning: 'No timer is running.',
  noRate: function (c) {
    return c + ' has no €/h rate on the Clients sheet — amounts stay €0 until you add it (it back-fills past rows).';
  },
  switchPrompt: function (client, task) {
    return 'You are timing "' + client + (task ? ' — ' + task : '') +
      '". Log that session now and start the new one with zero gap?';
  },
  logged: function (h, client) {
    return 'Logged ' + h.toFixed(2) + ' h for ' + client + '.';
  },
  noSessions: 'No sessions logged for this selection.',
  certification: 'Hours self-reported and certified correct.',
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
