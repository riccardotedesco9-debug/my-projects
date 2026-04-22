#!/usr/bin/env node
// reset-dedup.mjs — clears the `fingerprint` column (col Q) in the jobs tab.
// Use when you suspect a dedup false merge and want the pipeline to treat
// historical rows as fresh again. Does NOT delete row data, only fingerprints.
//
// Usage:  node --env-file=.env tools/reset-dedup.mjs

import { getAccessToken, SHEETS_BASE, JOBS_TAB } from "./_google-auth.mjs";

async function main() {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) throw new Error("GOOGLE_SHEET_ID is not set");
  const token = await getAccessToken();

  const range = encodeURIComponent(`${JOBS_TAB}!Q2:Q`);
  const resp = await fetch(`${SHEETS_BASE}/${sheetId}/values/${range}:clear`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    throw new Error(`Clear failed (${resp.status}): ${await resp.text()}`);
  }
  console.log("✓ Fingerprint column cleared. Next run will re-dedup from scratch.");
}

main().catch((err) => {
  console.error("reset-dedup failed:", err.message);
  process.exit(1);
});
