#!/usr/bin/env node
// upgrade-billing-sheet.mjs — Idempotent one-shot script that upgrades
// the AI Spend Tracker sheet from v1 (one flat tab) to v2 (3 tabs with
// formatting, frozen headers, conditional formatting, a summary KPI tab,
// and an alerts log tab).
//
// Run from workspace root, in a shell where `op` is signed in:
//   node tools/upgrade-billing-sheet.mjs
//
// Safe to re-run — checks existing tab state and only adds what's missing.
// Never deletes existing data; only formats + adds.

import { execSync } from "node:child_process";
import { readSecretByRef } from "./secret-lib.mjs";

const VAULT = "AI-Stack";
const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const MONTHLY = "monthly";
const SUMMARY = "summary";
const ALERTS = "alerts";
const DASHBOARD = "dashboard";

// Must match SHEET_HEADERS in sheet-writer.ts. 25 cols → A..Y.
const MONTHLY_HEADERS = [
  "month",
  "anthropic_tokens",
  "anthropic_usd",
  "elevenlabs_chars_used",
  "elevenlabs_chars_remaining",
  "trigger_runs",
  "trigger_usd",
  "cloudflare_requests",
  "cloudflare_usd",
  "firecrawl_credits_used",
  "firecrawl_credits_remaining",
  "total_usd",
  "delta_usd_vs_prev",
  "delta_pct_vs_prev",
  "rolling_3mo_avg_usd",
  "meetsync_active_users",
  "meetsync_new_users",
  "meetsync_turns",
  "meetsync_reminders_fired",
  "jobhunt_runs",
  "jobhunt_jobs_ingested",
  "jobhunt_emails_sent",
  "alert_count",
  "flags",
  "errors",
];

const ALERTS_HEADERS = ["timestamp", "label", "message"];

// Tab colors (Sheets RGB, 0-1 floats).
const COLOR_BLUE = { red: 0.34, green: 0.55, blue: 0.85 };
const COLOR_RED = { red: 0.9, green: 0.4, blue: 0.4 };
const COLOR_GREEN = { red: 0.4, green: 0.75, blue: 0.45 };
const COLOR_HEADER_BG = { red: 0.15, green: 0.15, blue: 0.18 };
const COLOR_HEADER_FG = { red: 1, green: 1, blue: 1 };

function opRead(ref) {
  // .env (the source of record) first, 1Password only as backup — no auth prompt in the normal path.
  const value = readSecretByRef(ref);
  if (value === null) throw new Error(`Secret ${ref} not found in .env and 1Password read failed.`);
  return value;
}

async function refreshAccessToken(clientId, clientSecret, refreshToken) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed (${res.status}): ${await res.text()}`);
  return (await res.json()).access_token;
}

async function api(token, method, path, body) {
  const res = await fetch(`${SHEETS_BASE}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Sheets API ${method} ${path} (${res.status}): ${text.slice(0, 400)}`);
  }
  return res.status === 204 ? null : res.json();
}

async function getMeta(token, sheetId) {
  return api(token, "GET", `${sheetId}?fields=sheets(properties(sheetId,title,gridProperties))`);
}

function findTab(meta, title) {
  return meta.sheets?.find((s) => s.properties?.title === title)?.properties;
}

async function batchUpdate(token, sheetId, requests) {
  if (requests.length === 0) return;
  return api(token, "POST", `${sheetId}:batchUpdate`, { requests });
}

async function writeRange(token, sheetId, range, values) {
  return api(
    token,
    "PUT",
    `${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    { values },
  );
}

// ────────────────────────────────────────────────────────────────────
// Build the requests array — one batchUpdate at the end, atomic.
// ────────────────────────────────────────────────────────────────────

function ensureTabRequests(meta) {
  // dashboard = transposed primary view (metrics down, months across)
  // monthly   = raw cron-written rows; kept around but de-prioritised
  // The cron writes to `monthly`; dashboard auto-renders via TRANSPOSE.
  const reqs = [];
  const COLOR_GREY = { red: 0.7, green: 0.7, blue: 0.72 };
  for (const [title, color, frozenRow, frozenCol] of [
    [SUMMARY, COLOR_GREEN, 0, 0],
    [DASHBOARD, COLOR_BLUE, 1, 1],
    [MONTHLY, COLOR_GREY, 1, 0],
    [ALERTS, COLOR_RED, 1, 0],
  ]) {
    if (!findTab(meta, title)) {
      reqs.push({
        addSheet: {
          properties: {
            title,
            tabColor: color,
            gridProperties: { frozenRowCount: frozenRow, frozenColumnCount: frozenCol },
          },
        },
      });
    }
  }
  return reqs;
}

function tabUpdateRequests(ids) {
  const COLOR_GREY = { red: 0.7, green: 0.7, blue: 0.72 };
  // Idempotent: re-applying the same tab properties is a no-op for Sheets.
  // Tab order: summary → dashboard → monthly → alerts (dashboard is the
  // primary readable view; monthly stays as the raw data source).
  return [
    {
      updateSheetProperties: {
        properties: { sheetId: ids.summary, tabColor: COLOR_GREEN, index: 0, gridProperties: { frozenRowCount: 0, hideGridlines: true } },
        fields: "tabColor,index,gridProperties.frozenRowCount,gridProperties.hideGridlines",
      },
    },
    {
      updateSheetProperties: {
        properties: { sheetId: ids.dashboard, tabColor: COLOR_BLUE, index: 1, gridProperties: { frozenRowCount: 1, frozenColumnCount: 1 } },
        fields: "tabColor,index,gridProperties.frozenRowCount,gridProperties.frozenColumnCount",
      },
    },
    {
      updateSheetProperties: {
        properties: { sheetId: ids.monthly, tabColor: COLOR_GREY, index: 2, gridProperties: { frozenRowCount: 1 } },
        fields: "tabColor,index,gridProperties.frozenRowCount",
      },
    },
    {
      updateSheetProperties: {
        properties: { sheetId: ids.alerts, tabColor: COLOR_RED, index: 3, gridProperties: { frozenRowCount: 1 } },
        fields: "tabColor,index,gridProperties.frozenRowCount",
      },
    },
  ];
}

function headerFormatRequests(sheetId, columnCount) {
  return [
    // Bold + dark bg + white text on row 1.
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: columnCount },
        cell: {
          userEnteredFormat: {
            backgroundColor: COLOR_HEADER_BG,
            textFormat: { foregroundColor: COLOR_HEADER_FG, bold: true, fontSize: 11 },
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
            padding: { top: 4, bottom: 4, left: 6, right: 6 },
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,padding)",
      },
    },
  ];
}

function monthlyNumberFormatRequests(sheetId) {
  // Currency cols (C, G, I, L, M, O) — 0-indexed: anthropic_usd=2, trigger_usd=6,
  // cloudflare_usd=8, total_usd=11, delta_usd_vs_prev=12, rolling_3mo_avg_usd=14.
  const currencyCols = [2, 6, 8, 11, 12, 14];
  // Percent col (N=13). delta_pct_vs_prev stored as e.g. 12.5 (pct points).
  const percentCols = [13];
  // Integer count cols (B, D, E, F, H, J, K, P-W).
  const intCols = [1, 3, 4, 5, 7, 9, 10, 15, 16, 17, 18, 19, 20, 21, 22];

  const reqs = [];
  for (const col of currencyCols) {
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: col, endColumnIndex: col + 1 },
        cell: { userEnteredFormat: { numberFormat: { type: "CURRENCY", pattern: "$#,##0.00" } } },
        fields: "userEnteredFormat.numberFormat",
      },
    });
  }
  for (const col of percentCols) {
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: col, endColumnIndex: col + 1 },
        // pattern with literal "%" since we store the value as a percentage already (12.5 → 12.5%).
        cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "+0.0\"%\";-0.0\"%\";0.0\"%\"" } } },
        fields: "userEnteredFormat.numberFormat",
      },
    });
  }
  for (const col of intCols) {
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: col, endColumnIndex: col + 1 },
        cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "#,##0" } } },
        fields: "userEnteredFormat.numberFormat",
      },
    });
  }
  return reqs;
}

function monthlyConditionalFormatRequests(sheetId) {
  // delta_pct_vs_prev (col N=13): red if >50, green if <0.
  const deltaPctCol = {
    sheetId, startRowIndex: 1, startColumnIndex: 13, endColumnIndex: 14,
  };
  // alert_count (col W=22): red if >0.
  const alertCountCol = {
    sheetId, startRowIndex: 1, startColumnIndex: 22, endColumnIndex: 23,
  };
  return [
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [deltaPctCol],
          booleanRule: {
            condition: { type: "NUMBER_GREATER", values: [{ userEnteredValue: "50" }] },
            format: { backgroundColor: { red: 1, green: 0.85, blue: 0.85 }, textFormat: { bold: true } },
          },
        },
        index: 0,
      },
    },
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [deltaPctCol],
          booleanRule: {
            condition: { type: "NUMBER_LESS", values: [{ userEnteredValue: "0" }] },
            format: { backgroundColor: { red: 0.85, green: 0.95, blue: 0.85 } },
          },
        },
        index: 1,
      },
    },
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [alertCountCol],
          booleanRule: {
            condition: { type: "NUMBER_GREATER", values: [{ userEnteredValue: "0" }] },
            format: {
              backgroundColor: { red: 1, green: 0.8, blue: 0.8 },
              textFormat: { bold: true, foregroundColor: { red: 0.55, green: 0, blue: 0 } },
            },
          },
        },
        index: 2,
      },
    },
  ];
}

/**
 * Format the transposed dashboard tab. After =TRANSPOSE(monthly!A1:Y100):
 *   row 1 = months across (was column A on monthly)
 *   col A = metric names (was row 1 / headers on monthly)
 *   B2..Z25 = data values (one column per month)
 *
 * Number formatting on the transposed tab is per-row instead of per-column.
 * Row indices below are 0-indexed, MONTHLY_HEADERS is the source order.
 */
function dashboardFormatRequests(sheetId) {
  const reqs = [];

  // Bold + dark bg for top row (months) and first column (metric labels).
  const headerFmt = {
    backgroundColor: COLOR_HEADER_BG,
    textFormat: { foregroundColor: COLOR_HEADER_FG, bold: true, fontSize: 10 },
    horizontalAlignment: "LEFT",
    verticalAlignment: "MIDDLE",
    padding: { top: 4, bottom: 4, left: 8, right: 8 },
  };
  reqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 30 },
      cell: { userEnteredFormat: headerFmt },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,padding)",
    },
  });
  reqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: MONTHLY_HEADERS.length, startColumnIndex: 0, endColumnIndex: 1 },
      cell: { userEnteredFormat: { ...headerFmt, horizontalAlignment: "LEFT" } },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,padding)",
    },
  });

  // Per-row number formatting. Map MONTHLY_HEADERS index → format type.
  // Rows here are 0-indexed in the transposed dashboard (row 0 = "month",
  // row 1 = "anthropic_tokens", ...).
  const fmtByHeader = {
    anthropic_usd: "currency",
    trigger_usd: "currency",
    cloudflare_usd: "currency",
    total_usd: "currency",
    delta_usd_vs_prev: "currency",
    rolling_3mo_avg_usd: "currency",
    delta_pct_vs_prev: "percent",
    anthropic_tokens: "int",
    elevenlabs_chars_used: "int",
    elevenlabs_chars_remaining: "int",
    trigger_runs: "int",
    cloudflare_requests: "int",
    firecrawl_credits_used: "int",
    firecrawl_credits_remaining: "int",
    meetsync_active_users: "int",
    meetsync_new_users: "int",
    meetsync_turns: "int",
    meetsync_reminders_fired: "int",
    jobhunt_runs: "int",
    jobhunt_jobs_ingested: "int",
    jobhunt_emails_sent: "int",
    alert_count: "int",
  };
  const patterns = {
    currency: { type: "CURRENCY", pattern: "$#,##0.00" },
    percent: { type: "NUMBER", pattern: "+0.0\"%\";-0.0\"%\";0.0\"%\"" },
    int: { type: "NUMBER", pattern: "#,##0" },
  };
  for (let i = 0; i < MONTHLY_HEADERS.length; i++) {
    const fmt = fmtByHeader[MONTHLY_HEADERS[i]];
    if (!fmt) continue;
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: i, endRowIndex: i + 1, startColumnIndex: 1, endColumnIndex: 30 },
        cell: { userEnteredFormat: { numberFormat: patterns[fmt] } },
        fields: "userEnteredFormat.numberFormat",
      },
    });
  }

  // Conditional formatting on the delta_pct_vs_prev row + alert_count row.
  const deltaPctRow = MONTHLY_HEADERS.indexOf("delta_pct_vs_prev");
  const alertCountRow = MONTHLY_HEADERS.indexOf("alert_count");
  if (deltaPctRow >= 0) {
    reqs.push({
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId, startRowIndex: deltaPctRow, endRowIndex: deltaPctRow + 1, startColumnIndex: 1, endColumnIndex: 30 }],
          booleanRule: {
            condition: { type: "NUMBER_GREATER", values: [{ userEnteredValue: "50" }] },
            format: { backgroundColor: { red: 1, green: 0.85, blue: 0.85 }, textFormat: { bold: true } },
          },
        },
        index: 0,
      },
    });
    reqs.push({
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId, startRowIndex: deltaPctRow, endRowIndex: deltaPctRow + 1, startColumnIndex: 1, endColumnIndex: 30 }],
          booleanRule: {
            condition: { type: "NUMBER_LESS", values: [{ userEnteredValue: "0" }] },
            format: { backgroundColor: { red: 0.85, green: 0.95, blue: 0.85 } },
          },
        },
        index: 1,
      },
    });
  }
  if (alertCountRow >= 0) {
    reqs.push({
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId, startRowIndex: alertCountRow, endRowIndex: alertCountRow + 1, startColumnIndex: 1, endColumnIndex: 30 }],
          booleanRule: {
            condition: { type: "NUMBER_GREATER", values: [{ userEnteredValue: "0" }] },
            format: {
              backgroundColor: { red: 1, green: 0.8, blue: 0.8 },
              textFormat: { bold: true, foregroundColor: { red: 0.55, green: 0, blue: 0 } },
            },
          },
        },
        index: 2,
      },
    });
  }

  // Make the label column (col A) wider — metric names get squashed otherwise.
  reqs.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 },
      properties: { pixelSize: 220 },
      fields: "pixelSize",
    },
  });
  // Data columns (B..) — set a comfortable fixed width.
  reqs.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 30 },
      properties: { pixelSize: 130 },
      fields: "pixelSize",
    },
  });

  return reqs;
}

function autoResizeRequests(sheetId, columnCount) {
  return [
    {
      autoResizeDimensions: {
        dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: columnCount },
      },
    },
  ];
}

// ────────────────────────────────────────────────────────────────────
// Summary tab: human-friendly KPI tiles via formulas.
// Layout (3 rows × 4 cols, generous spacing):
//   B2: header — "AI Spend Tracker — last month at a glance"
//   B4 / D4 / F4 / H4 → label cells
//   B5 / D5 / F5 / H5 → value cells (large bold)
//   ... two more KPI rows
// ────────────────────────────────────────────────────────────────────

function summarySeedValues() {
  // Latest data-row of `monthly` (range starts at row 2 — skips header so an
  // empty-data column doesn't return the header text). MATCH(2, 1/(...))
  // finds the last non-empty index; IFERROR returns blank when no data yet.
  const last = (col) =>
    `=IFERROR(INDEX(monthly!${col}2:${col}500,MATCH(2,1/(monthly!${col}2:${col}500<>""))),"")`;
  const lastMinusOne = (col) =>
    `=IFERROR(INDEX(monthly!${col}2:${col}500,MATCH(2,1/(monthly!${col}2:${col}500<>""))-1),"")`;

  // SPARKLINE renders inline mini-charts in a single cell. Wrapped in
  // IFERROR so the cell stays blank when the source column is empty.
  // `line` for time-series, `bar` for quota-fill (used vs used+remaining).
  const trendLine = (col, color) =>
    `=IFERROR(SPARKLINE(monthly!${col}2:${col}500,{"charttype","line";"color1","${color}";"linewidth",2;"empty","zero"}),"")`;
  const quotaBar = (usedCol, remainCol, color) =>
    `=IFERROR(SPARKLINE(IFERROR(INDEX(monthly!${usedCol}2:${usedCol}500,MATCH(2,1/(monthly!${usedCol}2:${usedCol}500<>""))),0),` +
    `{"charttype","bar";"max",IFERROR(INDEX(monthly!${usedCol}2:${usedCol}500,MATCH(2,1/(monthly!${usedCol}2:${usedCol}500<>"")))+INDEX(monthly!${remainCol}2:${remainCol}500,MATCH(2,1/(monthly!${remainCol}2:${remainCol}500<>""))),100);` +
    `"color1","${color}"}),"")`;

  return [
    [, , , , , , , , ,], // row 1 (blank padding)
    // row 2 — title
    [, "AI Spend Tracker — last month at a glance"],
    [, , , , , , , , ,], // row 3
    // row 4 — KPI labels
    [, "Total spend", , "vs prev month", , "3-month avg", , "Active users"],
    // row 5 — KPI values
    [, last("L"), , last("N"), , last("O"), , last("P")],
    [, , , , , , , , ,], // row 6
    [, "Turns processed", , "Reminders fired", , "Job-hunt runs", , "Alerts this month"],
    [, last("R"), , last("S"), , last("T"), , last("W")],
    [, , , , , , , , ,], // row 9
    [, "ElevenLabs used", , "ElevenLabs left", , "Firecrawl used", , "Firecrawl left"],
    [, last("D"), , last("E"), , last("J"), , last("K")],
    [, , , , , , , , ,], // row 12
    [, "Latest month:", last("A")],
    [, "Previous month:", lastMinusOne("A")],
    [, , , , , , , , ,], // row 15
    // row 16 — Trends section header
    [, "Trends (across all months on file)"],
    [, , , , , , , , ,], // row 17
    // row 18 — trend labels
    [, "Spend over time", , "Active users", , "Turns", , "Alerts"],
    // row 19 — sparklines (line)
    [, trendLine("L", "#3b82f6"), , trendLine("P", "#10b981"), , trendLine("R", "#f59e0b"), , trendLine("W", "#ef4444")],
    [, , , , , , , , ,], // row 20
    // row 21 — Quotas section header
    [, "Quotas (current month, used vs total)"],
    [, , , , , , , , ,], // row 22
    // row 23 — quota labels
    [, "ElevenLabs", , "Firecrawl"],
    // row 24 — quota progress bars
    [, quotaBar("D", "E", "#3b82f6"), , quotaBar("J", "K", "#10b981")],
  ];
}

function summaryFormatRequests(sheetId) {
  // Layout (1-indexed):
  //   row 2  → title (huge bold)
  //   row 4  → labels (small grey)   row 5  → values (huge bold)
  //   row 7  → labels                row 8  → values
  //   row 10 → labels                row 11 → values
  //   row 13/14 → "Latest month / Previous month" labels + dates
  //   row 16 → Trends section header
  //   row 18 → trend labels          row 19 → sparkline cells (line)
  //   row 21 → Quotas section header
  //   row 23 → quota labels          row 24 → quota bar cells
  //
  // Tile/sparkline values live at columns B, D, F, H — every other column.
  const TITLE_FMT = { textFormat: { bold: true, fontSize: 18 }, horizontalAlignment: "LEFT" };
  const SECTION_FMT = { textFormat: { bold: true, fontSize: 12, foregroundColor: { red: 0.2, green: 0.2, blue: 0.22 } }, horizontalAlignment: "LEFT" };
  const LABEL_FMT = {
    textFormat: { bold: true, fontSize: 9, foregroundColor: { red: 0.4, green: 0.4, blue: 0.42 } },
    horizontalAlignment: "LEFT",
  };
  const VALUE_FMT = {
    textFormat: { bold: true, fontSize: 22 },
    horizontalAlignment: "LEFT",
    verticalAlignment: "MIDDLE",
  };

  // Number-format mapping for each value tile (col → format).
  // Row 5 tiles: B=total_usd, D=delta_pct, F=3mo_avg, H=active_users
  // Row 8 tiles: B=turns, D=reminders, F=jobhunt_runs, H=alerts
  // Row 11 tiles: B=11labs_used, D=11labs_left, F=fc_used, H=fc_left
  // (zero-indexed column positions for the API)
  const currencyTiles = [
    { row: 4, col: 1 }, // B5 — total_usd
    { row: 4, col: 5 }, // F5 — rolling_3mo_avg_usd
  ];
  const percentTiles = [
    { row: 4, col: 3 }, // D5 — delta_pct_vs_prev
  ];
  const intTiles = [
    { row: 4, col: 7 }, // H5 — active_users
    { row: 7, col: 1 }, // B8 — turns
    { row: 7, col: 3 }, // D8 — reminders_fired
    { row: 7, col: 5 }, // F8 — jobhunt_runs
    { row: 7, col: 7 }, // H8 — alerts
    { row: 10, col: 1 }, // B11 — elevenlabs used
    { row: 10, col: 3 }, // D11 — elevenlabs left
    { row: 10, col: 5 }, // F11 — firecrawl used
    { row: 10, col: 7 }, // H11 — firecrawl left
  ];

  const reqs = [
    // Title
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 9 },
        cell: { userEnteredFormat: TITLE_FMT },
        fields: "userEnteredFormat(textFormat,horizontalAlignment)",
      },
    },
    // Labels (rows 4, 7, 10)
    ...[3, 6, 9].map((rowIndex) => ({
      repeatCell: {
        range: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 1, endColumnIndex: 9 },
        cell: { userEnteredFormat: LABEL_FMT },
        fields: "userEnteredFormat(textFormat,horizontalAlignment)",
      },
    })),
    // Value rows (rows 5, 8, 11)
    ...[4, 7, 10].map((rowIndex) => ({
      repeatCell: {
        range: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 1, endColumnIndex: 9 },
        cell: { userEnteredFormat: VALUE_FMT },
        fields: "userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment)",
      },
    })),
    // Make value rows tall (50px) for breathing room.
    ...[4, 7, 10].map((rowIndex) => ({
      updateDimensionProperties: {
        range: { sheetId, dimension: "ROWS", startIndex: rowIndex, endIndex: rowIndex + 1 },
        properties: { pixelSize: 50 },
        fields: "pixelSize",
      },
    })),
    // Section headers (rows 16, 21).
    ...[15, 20].map((rowIndex) => ({
      repeatCell: {
        range: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 1, endColumnIndex: 9 },
        cell: { userEnteredFormat: SECTION_FMT },
        fields: "userEnteredFormat(textFormat,horizontalAlignment)",
      },
    })),
    // Trend / quota labels (rows 18, 23).
    ...[17, 22].map((rowIndex) => ({
      repeatCell: {
        range: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 1, endColumnIndex: 9 },
        cell: { userEnteredFormat: LABEL_FMT },
        fields: "userEnteredFormat(textFormat,horizontalAlignment)",
      },
    })),
    // Sparkline rows (rows 19, 24): tall enough to render meaningfully.
    ...[18, 23].map((rowIndex) => ({
      updateDimensionProperties: {
        range: { sheetId, dimension: "ROWS", startIndex: rowIndex, endIndex: rowIndex + 1 },
        properties: { pixelSize: 40 },
        fields: "pixelSize",
      },
    })),
    // Hide gridlines for cleaner KPI feel.
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { hideGridlines: true } },
        fields: "gridProperties.hideGridlines",
      },
    },
  ];

  // Per-tile number formatting.
  for (const t of currencyTiles) {
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: t.row, endRowIndex: t.row + 1, startColumnIndex: t.col, endColumnIndex: t.col + 1 },
        cell: { userEnteredFormat: { numberFormat: { type: "CURRENCY", pattern: "$#,##0.00" } } },
        fields: "userEnteredFormat.numberFormat",
      },
    });
  }
  for (const t of percentTiles) {
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: t.row, endRowIndex: t.row + 1, startColumnIndex: t.col, endColumnIndex: t.col + 1 },
        cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "+0.0\"%\";-0.0\"%\";0.0\"%\"" } } },
        fields: "userEnteredFormat.numberFormat",
      },
    });
  }
  for (const t of intTiles) {
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: t.row, endRowIndex: t.row + 1, startColumnIndex: t.col, endColumnIndex: t.col + 1 },
        cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "#,##0" } } },
        fields: "userEnteredFormat.numberFormat",
      },
    });
  }

  // Conditional formatting: D5 (delta_pct) red if >50, green if <0.
  // H8 (alerts) red bg if >0.
  reqs.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [{ sheetId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 3, endColumnIndex: 4 }],
        booleanRule: {
          condition: { type: "NUMBER_GREATER", values: [{ userEnteredValue: "50" }] },
          format: { backgroundColor: { red: 1, green: 0.85, blue: 0.85 } },
        },
      },
      index: 0,
    },
  });
  reqs.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [{ sheetId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 3, endColumnIndex: 4 }],
        booleanRule: {
          condition: { type: "NUMBER_LESS", values: [{ userEnteredValue: "0" }] },
          format: { backgroundColor: { red: 0.85, green: 0.95, blue: 0.85 } },
        },
      },
      index: 1,
    },
  });
  reqs.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [{ sheetId, startRowIndex: 7, endRowIndex: 8, startColumnIndex: 7, endColumnIndex: 8 }],
        booleanRule: {
          condition: { type: "NUMBER_GREATER", values: [{ userEnteredValue: "0" }] },
          format: {
            backgroundColor: { red: 1, green: 0.8, blue: 0.8 },
            textFormat: { bold: true, foregroundColor: { red: 0.55, green: 0, blue: 0 } },
          },
        },
      },
      index: 2,
    },
  });

  return reqs;
}

// ────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Reading creds + sheet ID from 1Password…");
  const clientId = opRead("op://AI-Stack/google-jobhunt-oauth/client-id");
  const clientSecret = opRead("op://AI-Stack/google-jobhunt-oauth/client-secret");
  const refreshToken = opRead("op://AI-Stack/google-jobhunt-oauth/refresh-token");
  const sheetId = opRead("op://AI-Stack/billing-sheet/password");

  console.log("Refreshing access token…");
  const token = await refreshAccessToken(clientId, clientSecret, refreshToken);

  console.log("Inspecting current sheet structure…");
  let meta = await getMeta(token, sheetId);
  console.log("  existing tabs:", meta.sheets.map((s) => s.properties.title).join(", "));

  // 1. Add missing tabs.
  const addReqs = ensureTabRequests(meta);
  if (addReqs.length > 0) {
    console.log(`  adding ${addReqs.length} missing tab(s)…`);
    await batchUpdate(token, sheetId, addReqs);
    meta = await getMeta(token, sheetId);
  } else {
    console.log("  all 4 tabs already exist — formatting only.");
  }

  const ids = {
    summary: findTab(meta, SUMMARY).sheetId,
    dashboard: findTab(meta, DASHBOARD).sheetId,
    monthly: findTab(meta, MONTHLY).sheetId,
    alerts: findTab(meta, ALERTS).sheetId,
  };

  // 2. Write headers and the dashboard's TRANSPOSE formula.
  console.log("Writing headers + dashboard formula…");
  await writeRange(token, sheetId, `${MONTHLY}!A1:${String.fromCharCode(64 + MONTHLY_HEADERS.length)}1`, [MONTHLY_HEADERS]);
  await writeRange(token, sheetId, `${ALERTS}!A1:C1`, [ALERTS_HEADERS]);
  // Dashboard is a single TRANSPOSE — spills the whole monthly table down
  // (metrics) and right (months). 200-row source bound is generous: we write
  // 1 row/month, so 200 rows = 16+ years of history.
  await writeRange(token, sheetId, `${DASHBOARD}!A1`, [[`=TRANSPOSE(monthly!A1:Y200)`]]);

  // 3. Apply formatting in one batch.
  console.log("Applying formatting…");
  const fmtReqs = [
    ...tabUpdateRequests(ids),
    ...headerFormatRequests(ids.monthly, MONTHLY_HEADERS.length),
    ...headerFormatRequests(ids.alerts, ALERTS_HEADERS.length),
    ...monthlyNumberFormatRequests(ids.monthly),
    ...monthlyConditionalFormatRequests(ids.monthly),
    ...autoResizeRequests(ids.monthly, MONTHLY_HEADERS.length),
    ...autoResizeRequests(ids.alerts, ALERTS_HEADERS.length),
    ...dashboardFormatRequests(ids.dashboard),
    ...summaryFormatRequests(ids.summary),
  ];
  await batchUpdate(token, sheetId, fmtReqs);

  // 4. Seed summary tab formulas (KPI tiles + sparkline trends + quota bars).
  console.log("Seeding summary tab formulas…");
  await writeRange(token, sheetId, `${SUMMARY}!A1:I24`, summarySeedValues());

  console.log(`\nDone. Open: https://docs.google.com/spreadsheets/d/${sheetId}/edit`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
