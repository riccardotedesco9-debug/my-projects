#!/usr/bin/env node
// clean-billing-sheet.mjs — One-shot: clears all data rows from the
// AI Spend Tracker sheet (keeps the header row in row 1). Useful after
// the initial round of test runs that left noisy intermediate rows.
//
// Run from workspace root, in a shell where `op` is signed in:
//   node tools/clean-billing-sheet.mjs

import { execSync } from "node:child_process";

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
// Each entry: [tab name, last column letter to clear up to (excluding header row)].
const TARGETS = [
  ["monthly", "Y"], // 25 cols (A..Y) since the v2 schema expanded
  ["alerts", "C"],  // timestamp, label, message
];

function opRead(ref) {
  // Env-var fallback for shells without op CLI signed in. Map the opRef's
  // path segments to OP_<UPPER_SNAKE>; e.g. op://AI-Stack/billing-sheet/password
  // → OP_AI_STACK_BILLING_SHEET_PASSWORD. Falls through to `op read` otherwise.
  const envName = "OP_" + ref.replace(/^op:\/\//, "").replace(/[\/-]/g, "_").toUpperCase();
  if (process.env[envName]) return process.env[envName];
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

async function clearRows(token, sheetId, tab, lastCol) {
  // A2:<lastCol> wipes from row 2 to the end of the data range. Header preserved.
  const range = encodeURIComponent(`${tab}!A2:${lastCol}`);
  const url = `${SHEETS_BASE}/${sheetId}/values/${range}:clear`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) {
    // 400 likely = tab doesn't exist (not yet upgraded). Skip silently.
    if (res.status === 400) return { clearedRange: null, skipped: tab };
    throw new Error(`Clear ${tab} failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

async function main() {
  console.log("Reading creds from 1Password…");
  const clientId = opRead("op://AI-Stack/google-jobhunt-oauth/client-id");
  const clientSecret = opRead("op://AI-Stack/google-jobhunt-oauth/client-secret");
  const refreshToken = opRead("op://AI-Stack/google-jobhunt-oauth/refresh-token");
  const sheetId = opRead("op://AI-Stack/billing-sheet/password");

  console.log("Refreshing access token…");
  const token = await refreshAccessToken(clientId, clientSecret, refreshToken);

  console.log(`Clearing data rows from sheet ${sheetId}…`);
  for (const [tab, lastCol] of TARGETS) {
    const result = await clearRows(token, sheetId, tab, lastCol);
    if (result.skipped) {
      console.log(`  [skip] ${tab}: tab does not exist (run upgrade-billing-sheet.mjs first)`);
    } else {
      console.log(`  [ok]   ${tab}: cleared ${result.clearedRange ?? "(none)"}`);
    }
  }
  console.log("Done. Header rows preserved. Next billing-pulse run writes a fresh row.");
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
