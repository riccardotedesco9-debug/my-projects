// Append a single monthly snapshot row to the AI Spend Tracker sheet.
// Reuses the OAuth refresh-token flow already configured for job-hunt.
// One-time setup: create a Google Sheet, add the header row from
// SHEET_HEADERS below, capture its ID into BILLING_SHEET_ID env var.

import { getAccessToken } from "../../trigger/job-hunt/google-auth.js";
import type { ProviderUsage } from "./types.js";

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

export const SHEET_HEADERS = [
  "month",                       // 1  YYYY-MM
  "anthropic_tokens",            // 2
  "anthropic_usd",               // 3
  "elevenlabs_chars_used",       // 4
  "elevenlabs_chars_remaining",  // 5
  "trigger_runs",                // 6
  "trigger_usd",                 // 7
  "cloudflare_requests",         // 8
  "cloudflare_usd",              // 9
  "firecrawl_credits_used",      // 10
  "firecrawl_credits_remaining", // 11
  "total_usd",                   // 12  sum of all *_usd columns
  "annualized_usd",              // 13  total_usd * 12 (rough run-rate)
  "flags",                       // 14  comma-list of low-balance / health warnings
  "errors",                      // 15  comma-list of providers that errored this run
] as const;

export const BILLING_TAB = "monthly";

export interface SnapshotRow {
  month: string; // YYYY-MM
  byProvider: Record<ProviderUsage["provider"], ProviderUsage>;
}

export async function appendSnapshot(row: SnapshotRow): Promise<void> {
  const sheetId = process.env.BILLING_SHEET_ID;
  if (!sheetId) throw new Error("BILLING_SHEET_ID is not set");

  const flags: string[] = [];
  const errors: string[] = [];
  for (const u of Object.values(row.byProvider)) {
    if (u.error) errors.push(`${u.provider}: ${u.error}`);
    // Low-balance flag: <10% of plan remaining (only meaningful when both
    // used and remaining are present; pay-as-you-go has remaining=null).
    if (
      u.remaining !== null &&
      u.used !== null &&
      u.remaining + u.used > 0 &&
      u.remaining / (u.remaining + u.used) < 0.1
    ) {
      flags.push(`${u.provider} <10%`);
    }
  }

  const totalUsd = Object.values(row.byProvider)
    .map((u) => u.estCostUSD ?? 0)
    .reduce((a, b) => a + b, 0);

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
    Math.round(totalUsd * 100) / 100,
    Math.round(totalUsd * 12 * 100) / 100,
    flags.join("; "),
    errors.join("; "),
  ];

  const token = await getAccessToken();
  const range = encodeURIComponent(`${BILLING_TAB}!A:O`);
  const url = `${SHEETS_BASE}/${sheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
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
