#!/usr/bin/env node
// create-billing-sheet.mjs — One-shot: creates the "AI Spend Tracker"
// Google Sheet, names the first tab "monthly", writes the 15-column
// header row, and saves the resulting sheet ID into 1Password
// (op://AI-Stack/billing-sheet/id).
//
// Reuses the Google OAuth refresh-token already in 1P (the same Google
// account used for the daily digest emails).
//
// Run from workspace root:
//   node tools/create-billing-sheet.mjs

import { execSync, spawnSync } from "node:child_process";
import { readSecretByRef } from "./secret-lib.mjs";

const VAULT = "AI-Stack";
const SHEET_TITLE = "AI Spend Tracker";
const TAB_TITLE = "monthly";
const HEADERS = [
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
  "annualized_usd",
  "flags",
  "errors",
];

function opRead(ref) {
  // .env (the source of record) first, 1Password only as backup — no auth prompt in the normal path.
  const value = readSecretByRef(ref);
  if (value === null) throw new Error(`Secret ${ref} not found in .env and 1Password read failed.`);
  return value;
}

function opItemExists(title) {
  return spawnSync("op", ["item", "get", title, `--vault=${VAULT}`], { stdio: "ignore" }).status === 0;
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
  const json = await res.json();
  return json.access_token;
}

async function createSheet(token) {
  const res = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      properties: { title: SHEET_TITLE },
      sheets: [{ properties: { title: TAB_TITLE } }],
    }),
  });
  if (!res.ok) throw new Error(`Create sheet failed (${res.status}): ${await res.text()}`);
  return res.json();
}

async function writeHeaders(token, sheetId) {
  const range = encodeURIComponent(`${TAB_TITLE}!A1:O1`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?valueInputOption=RAW`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [HEADERS] }),
  });
  if (!res.ok) throw new Error(`Write headers failed (${res.status}): ${await res.text()}`);
}

async function main() {
  console.log("Reading OAuth creds from 1Password…");
  const clientId = opRead("op://AI-Stack/google-jobhunt-oauth/client-id");
  const clientSecret = opRead("op://AI-Stack/google-jobhunt-oauth/client-secret");
  const refreshToken = opRead("op://AI-Stack/google-jobhunt-oauth/refresh-token");

  console.log("Refreshing access token…");
  const accessToken = await refreshAccessToken(clientId, clientSecret, refreshToken);

  console.log(`Creating "${SHEET_TITLE}" sheet…`);
  const sheet = await createSheet(accessToken);
  const sheetId = sheet.spreadsheetId;
  const sheetUrl = sheet.spreadsheetUrl;
  console.log(`  ID:  ${sheetId}`);
  console.log(`  URL: ${sheetUrl}`);

  console.log("Writing header row…");
  await writeHeaders(accessToken, sheetId);

  if (opItemExists("billing-sheet")) {
    console.log("1Password item billing-sheet already exists — overwriting field…");
    const r = spawnSync("op", ["item", "edit", "billing-sheet", `--vault=${VAULT}`, `id=${sheetId}`], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`op item edit failed:\n${r.stderr}`);
  } else {
    const r = spawnSync("op", ["item", "create", `--vault=${VAULT}`, "--category=password", "--title=billing-sheet", `id=${sheetId}`], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`op item create failed:\n${r.stderr}`);
  }
  console.log("\nDone. Sheet created and ID saved to op://AI-Stack/billing-sheet/id.");
  console.log(`Open: ${sheetUrl}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
