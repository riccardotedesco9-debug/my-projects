// Alerts tab on the AI Spend Tracker sheet — append-only log of every
// notifyOwner() call from inside Trigger.dev tasks. Telegram still pings
// for live notifications; this tab is the searchable historical record.
//
// Columns: A timestamp (ISO)   B label   C message
//
// The Worker /internal/alert route does NOT write here (CF Worker → Sheets
// would need an in-Worker OAuth flow — cost > value at this stage). All
// Worker alerts are still routed to Telegram only.

import { getAccessToken } from "../../trigger/job-hunt/google-auth.js";

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const TAB = "alerts";

function getSheetId(): string | null {
  return process.env.BILLING_SHEET_ID ?? null;
}

/**
 * Append one alert row. Best-effort — never throws so callers don't have
 * to guard their alert-firing code paths. Logs failures to console.
 */
export async function appendAlertRow(label: string, message: string): Promise<void> {
  const sheetId = getSheetId();
  if (!sheetId) {
    console.warn("[alerts-log] BILLING_SHEET_ID not set — alert not logged to sheet");
    return;
  }
  const ts = new Date().toISOString();
  const range = encodeURIComponent(`${TAB}!A:C`);
  const url = `${SHEETS_BASE}/${sheetId}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  try {
    const token = await getAccessToken();
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: [[ts, label, message]] }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[alerts-log] append failed (${res.status}): ${body.slice(0, 200)}`);
    }
  } catch (err) {
    console.error("[alerts-log] append exception:", err instanceof Error ? err.message : err);
  }
}

/**
 * Count alerts logged within a month window. Uses the same YYYY-MM prefix
 * filter as the rest of billing-pulse. Returns 0 on any error.
 */
export async function countAlertsInMonth(monthStartISO: string): Promise<number> {
  const sheetId = getSheetId();
  if (!sheetId) return 0;
  const monthPrefix = monthStartISO.slice(0, 7);
  const range = encodeURIComponent(`${TAB}!A2:A`);
  try {
    const token = await getAccessToken();
    const res = await fetch(`${SHEETS_BASE}/${sheetId}/values/${range}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      // 400 = tab doesn't exist yet (sheet upgrade not run). Return 0 silently.
      if (res.status === 400) return 0;
      console.error(`[alerts-log] count read failed (${res.status})`);
      return 0;
    }
    const json = (await res.json()) as { values?: string[][] };
    let count = 0;
    for (const row of json.values ?? []) {
      const ts = row[0];
      if (ts && ts.startsWith(monthPrefix)) count++;
    }
    return count;
  } catch (err) {
    console.error("[alerts-log] count exception:", err instanceof Error ? err.message : err);
    return 0;
  }
}
