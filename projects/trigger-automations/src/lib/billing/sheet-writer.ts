// Append a single monthly snapshot row to the AI Spend Tracker sheet.
// Reads the previous 2 rows on every append to compute deltas and the
// 3-month rolling average — these get baked into the row at write time
// rather than as Sheets formulas, so historical values stay stable even
// if a row is later edited or re-ordered.

import { getAccessToken } from "../google-auth.js";
import type { ProviderUsage } from "./types.js";
import type { MeetsyncAppMetrics } from "./meetsync-app.js";

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

export const SHEET_HEADERS = [
  "month",                       // A   YYYY-MM
  "anthropic_tokens",            // B
  "anthropic_usd",               // C
  "elevenlabs_chars_used",       // D
  "elevenlabs_chars_remaining",  // E
  "trigger_runs",                // F
  "trigger_usd",                 // G
  "cloudflare_requests",         // H
  "cloudflare_usd",              // I
  "firecrawl_credits_used",      // J
  "firecrawl_credits_remaining", // K
  "total_usd",                   // L  sum of all *_usd columns
  "delta_usd_vs_prev",           // M  current total_usd - previous month's
  "delta_pct_vs_prev",           // N  (delta / prev) * 100; null if no prev
  "rolling_3mo_avg_usd",         // O  mean of last 3 months total_usd; null if <3
  "meetsync_active_users",       // P
  "meetsync_new_users",          // Q
  "meetsync_turns",              // R
  "meetsync_reminders_fired",    // S
  "jobhunt_runs",                // T  retired (job-hunt removed 2026-06) — kept blank for alignment
  "jobhunt_jobs_ingested",       // U  retired
  "jobhunt_emails_sent",         // V  retired
  "alert_count",                 // W  alerts logged in `alerts` tab this month
  "flags",                       // X  comma-list of low-balance / health warnings
  "errors",                      // Y  comma-list of providers that errored this run
] as const;

export const BILLING_TAB = "monthly";
export const LAST_COLUMN = "Y";

export interface SnapshotRow {
  month: string; // YYYY-MM
  byProvider: Record<ProviderUsage["provider"], ProviderUsage>;
  meetsync: MeetsyncAppMetrics;
  alertCount: number;
}

/** Fetches up to N most recent rows from `monthly` (excluding header). */
async function readRecentRows(sheetId: string, token: string, n: number): Promise<string[][]> {
  const range = encodeURIComponent(`${BILLING_TAB}!A2:${LAST_COLUMN}`);
  const res = await fetch(`${SHEETS_BASE}/${sheetId}/values/${range}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { values?: string[][] };
  const all = json.values ?? [];
  return all.slice(-n);
}

function num(v: string | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function appendSnapshot(row: SnapshotRow): Promise<void> {
  const sheetId = process.env.BILLING_SHEET_ID;
  if (!sheetId) throw new Error("BILLING_SHEET_ID is not set");

  const token = await getAccessToken();

  // Pull the trailing 3 rows so we can compute delta vs the previous row
  // and the 3-month rolling average. Read happens before the append so we
  // don't include the new row in our own rolling window.
  const history = await readRecentRows(sheetId, token, 3);
  // total_usd is column L (index 11) per SHEET_HEADERS order above.
  const TOTAL_USD_INDEX = 11;
  const prevTotalUsd = history.length > 0 ? num(history[history.length - 1][TOTAL_USD_INDEX]) : null;

  // Aggregate flags + errors from provider results.
  const flags: string[] = [];
  const errors: string[] = [];
  for (const u of Object.values(row.byProvider)) {
    if (u.error) errors.push(`${u.provider}: ${u.error}`);
    if (
      u.remaining !== null &&
      u.used !== null &&
      u.remaining + u.used > 0 &&
      u.remaining / (u.remaining + u.used) < 0.1
    ) {
      flags.push(`${u.provider} <10%`);
    }
  }
  if (row.meetsync.error) errors.push(`meetsync-app: ${row.meetsync.error}`);

  const totalUsd =
    Math.round(
      Object.values(row.byProvider)
        .map((u) => u.estCostUSD ?? 0)
        .reduce((a, b) => a + b, 0) * 100,
    ) / 100;

  const deltaUsd = prevTotalUsd !== null ? Math.round((totalUsd - prevTotalUsd) * 100) / 100 : null;
  const deltaPct =
    prevTotalUsd !== null && prevTotalUsd !== 0
      ? Math.round(((totalUsd - prevTotalUsd) / prevTotalUsd) * 1000) / 10
      : null;

  // Rolling 3-month average: requires the new row + 2 prior. With only
  // current + last, we'd be averaging 2 — misleading. Stay null until we
  // have a true 3-month window.
  const rolling3mo =
    history.length >= 2
      ? Math.round(
          ((totalUsd + (num(history[history.length - 1][TOTAL_USD_INDEX]) ?? 0) +
            (num(history[history.length - 2][TOTAL_USD_INDEX]) ?? 0)) /
            3) *
            100,
        ) / 100
      : null;

  const values: Array<string | number | null> = [
    row.month,
    row.byProvider.anthropic.used,
    row.byProvider.anthropic.estCostUSD,
    row.byProvider.elevenlabs.used,
    row.byProvider.elevenlabs.remaining,
    row.byProvider.trigger.used,
    row.byProvider.trigger.estCostUSD,
    row.byProvider.cloudflare.used,
    row.byProvider.cloudflare.estCostUSD,
    row.byProvider.firecrawl.used,
    row.byProvider.firecrawl.remaining,
    totalUsd,
    deltaUsd,
    deltaPct,
    rolling3mo,
    row.meetsync.active_users,
    row.meetsync.new_users,
    row.meetsync.turns,
    row.meetsync.reminders_fired,
    null, // jobhunt_runs — retired, column kept blank for sheet alignment
    null, // jobhunt_jobs_ingested — retired
    null, // jobhunt_emails_sent — retired
    row.alertCount,
    flags.join("; "),
    errors.join("; "),
  ];

  const range = encodeURIComponent(`${BILLING_TAB}!A:${LAST_COLUMN}`);
  // RAW (not USER_ENTERED) so a future provider error containing "=HYPERLINK(...)"
  // lands as plain text in the `errors` column instead of executing as a formula.
  // Cell-level number formatting (applied via tools/upgrade-billing-sheet.mjs)
  // handles currency / percent / count rendering regardless of input mode.
  const url = `${SHEETS_BASE}/${sheetId}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values: [values] }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Sheets append failed (${res.status}): ${body.slice(0, 300)}`);
  }
}
