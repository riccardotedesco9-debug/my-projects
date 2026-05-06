#!/usr/bin/env node
// clean-billing-sheet.mjs — One-shot: clears all data rows from the
// AI Spend Tracker sheet (keeps the header row in row 1). Useful after
// the initial round of test runs that left noisy intermediate rows.
//
// Run from workspace root, in a shell where `op` is signed in:
//   node tools/clean-billing-sheet.mjs

import { execSync } from "node:child_process";

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const TAB = "monthly";

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

async function clearRows(token, sheetId) {
  // A2:O wipes from row 2 to the end of the data range, columns A..O.
  const range = encodeURIComponent(`${TAB}!A2:O`);
  const url = `${SHEETS_BASE}/${sheetId}/values/${range}:clear`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(`Clear failed (${res.status}): ${await res.text()}`);
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

  console.log(`Clearing data rows from sheet ${sheetId} (tab "${TAB}")…`);
  const result = await clearRows(token, sheetId);
  console.log(`Cleared range: ${result.clearedRange ?? "(none)"}`);
  console.log("Done. Header row preserved. Next billing-pulse run (or 2026-06-01 cron) writes the first new row.");
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
