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

const VAULT = "AI-Stack";
const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const MONTHLY = "monthly";
const SUMMARY = "summary";
const ALERTS = "alerts";

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
  return execSync(`op read "${ref}"`, { encoding: "utf8" }).trim();
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
  const reqs = [];
  for (const [title, color] of [
    [SUMMARY, COLOR_GREEN],
    [MONTHLY, COLOR_BLUE],
    [ALERTS, COLOR_RED],
  ]) {
    if (!findTab(meta, title)) {
      reqs.push({
        addSheet: {
          properties: { title, tabColor: color, gridProperties: { frozenRowCount: 1 } },
        },
      });
    }
  }
  return reqs;
}

function tabUpdateRequests(monthlyId, alertsId, summaryId) {
  // Frozen header row + tab color (idempotent — re-applying same value is a no-op).
  return [
    {
      updateSheetProperties: {
        properties: { sheetId: monthlyId, tabColor: COLOR_BLUE, gridProperties: { frozenRowCount: 1 } },
        fields: "tabColor,gridProperties.frozenRowCount",
      },
    },
    {
      updateSheetProperties: {
        properties: { sheetId: alertsId, tabColor: COLOR_RED, gridProperties: { frozenRowCount: 1 } },
        fields: "tabColor,gridProperties.frozenRowCount",
      },
    },
    {
      updateSheetProperties: {
        properties: { sheetId: summaryId, tabColor: COLOR_GREEN, gridProperties: { frozenRowCount: 0 } },
        fields: "tabColor,gridProperties.frozenRowCount",
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
  // Latest row of `monthly` referenced via INDEX(... LOOKUP). LOOKUP with a
  // search key that's always larger than any string in the column finds the
  // last non-empty cell — robust against blank trailing rows.
  const last = (col) =>
    `=IFERROR(INDEX(monthly!${col}:${col},MATCH(2,1/(monthly!${col}:${col}<>""))),)`;
  const lastMinusOne = (col) =>
    `=IFERROR(INDEX(monthly!${col}:${col},MATCH(2,1/(monthly!${col}:${col}<>""))-1),)`;

  return [
    [, , , , , , , , ,], // row 1 (blank padding)
    // row 2 — title
    [, "AI Spend Tracker — last month at a glance"],
    [, , , , , , , , ,], // row 3
    // row 4 — labels
    [, "Total spend", , "vs prev month", , "3-month avg", , "Active users"],
    // row 5 — values
    [, last("L"), , last("N"), , last("O"), , last("P")],
    [, , , , , , , , ,], // row 6
    // row 7 — labels
    [, "Turns processed", , "Reminders fired", , "Job-hunt runs", , "Alerts this month"],
    // row 8 — values
    [, last("R"), , last("S"), , last("T"), , last("W")],
    [, , , , , , , , ,], // row 9
    // row 10 — labels
    [, "ElevenLabs used", , "ElevenLabs left", , "Firecrawl used", , "Firecrawl left"],
    // row 11 — values
    [, last("D"), , last("E"), , last("J"), , last("K")],
    [, , , , , , , , ,],
    [, "Latest month:", last("A")],
    [, "Previous month:", lastMinusOne("A")],
  ];
}

function summaryFormatRequests(sheetId) {
  // Title (B2): big bold.
  // Label rows (4, 7, 10): small grey uppercase.
  // Value rows (5, 8, 11): huge bold.
  return [
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 9 },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true, fontSize: 18 },
            horizontalAlignment: "LEFT",
          },
        },
        fields: "userEnteredFormat(textFormat,horizontalAlignment)",
      },
    },
    // Label rows: 4 (index 3), 7 (6), 10 (9)
    ...[3, 6, 9].map((rowIndex) => ({
      repeatCell: {
        range: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 1, endColumnIndex: 9 },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true, fontSize: 9, foregroundColor: { red: 0.4, green: 0.4, blue: 0.42 } },
            horizontalAlignment: "LEFT",
          },
        },
        fields: "userEnteredFormat(textFormat,horizontalAlignment)",
      },
    })),
    // Value rows: 5 (4), 8 (7), 11 (10)
    ...[4, 7, 10].map((rowIndex) => ({
      repeatCell: {
        range: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 1, endColumnIndex: 9 },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true, fontSize: 22 },
            horizontalAlignment: "LEFT",
            verticalAlignment: "MIDDLE",
          },
        },
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
    // Hide gridlines for cleaner KPI feel.
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { hideGridlines: true } },
        fields: "gridProperties.hideGridlines",
      },
    },
  ];
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
    console.log("  all 3 tabs already exist — formatting only.");
  }

  const monthlyTab = findTab(meta, MONTHLY);
  const alertsTab = findTab(meta, ALERTS);
  const summaryTab = findTab(meta, SUMMARY);

  // 2. Write headers (idempotent — overwrites with same value).
  console.log("Writing headers…");
  await writeRange(token, sheetId, `${MONTHLY}!A1:${String.fromCharCode(64 + MONTHLY_HEADERS.length)}1`, [MONTHLY_HEADERS]);
  await writeRange(token, sheetId, `${ALERTS}!A1:C1`, [ALERTS_HEADERS]);

  // 3. Apply formatting in one batch.
  console.log("Applying formatting…");
  const fmtReqs = [
    ...tabUpdateRequests(monthlyTab.sheetId, alertsTab.sheetId, summaryTab.sheetId),
    ...headerFormatRequests(monthlyTab.sheetId, MONTHLY_HEADERS.length),
    ...headerFormatRequests(alertsTab.sheetId, ALERTS_HEADERS.length),
    ...monthlyNumberFormatRequests(monthlyTab.sheetId),
    ...monthlyConditionalFormatRequests(monthlyTab.sheetId),
    ...autoResizeRequests(monthlyTab.sheetId, MONTHLY_HEADERS.length),
    ...autoResizeRequests(alertsTab.sheetId, ALERTS_HEADERS.length),
    ...summaryFormatRequests(summaryTab.sheetId),
  ];
  await batchUpdate(token, sheetId, fmtReqs);

  // 4. Seed summary tab formulas.
  console.log("Seeding summary tab formulas…");
  await writeRange(token, sheetId, `${SUMMARY}!A1:I14`, summarySeedValues());

  console.log(`\nDone. Open: https://docs.google.com/spreadsheets/d/${sheetId}/edit`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
