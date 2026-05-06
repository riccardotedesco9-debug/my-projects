#!/usr/bin/env node
// update-profile.mjs — read or append to the `profile` sheet tab A1.
// The profile drives LLM fit scoring (Haiku + Sonnet rubric source).
//
// Usage:
//   node --env-file=.env tools/update-profile.mjs show
//   node --env-file=.env tools/update-profile.mjs append "<text to append>"
//   node --env-file=.env tools/update-profile.mjs append-if-missing "<marker>" "<text>"

import { getAccessToken, SHEETS_BASE } from "./_google-auth.mjs";

const PROFILE_TAB = "profile";

async function readProfile(sheetId, token) {
  const range = encodeURIComponent(`${PROFILE_TAB}!A1`);
  const resp = await fetch(`${SHEETS_BASE}/${sheetId}/values/${range}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`Read failed (${resp.status}): ${await resp.text()}`);
  const data = await resp.json();
  return data.values?.[0]?.[0] ?? "";
}

async function writeProfile(sheetId, token, content) {
  const range = encodeURIComponent(`${PROFILE_TAB}!A1`);
  const resp = await fetch(
    `${SHEETS_BASE}/${sheetId}/values/${range}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: [[content]] }),
    },
  );
  if (!resp.ok) throw new Error(`Write failed (${resp.status}): ${await resp.text()}`);
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const sheetId = process.env.JobHunt_Sheet_ID;
  if (!sheetId) throw new Error("JobHunt_Sheet_ID is not set");
  const token = await getAccessToken();

  if (cmd === "show") {
    const profile = await readProfile(sheetId, token);
    console.log(`--- profile (${profile.length} chars) ---\n${profile}\n--- end ---`);
    return;
  }
  if (cmd === "append") {
    const text = args.join(" ");
    if (!text) throw new Error("append requires text argument");
    const current = await readProfile(sheetId, token);
    const next = current.trimEnd() + "\n\n" + text.trim() + "\n";
    await writeProfile(sheetId, token, next);
    console.log(`✓ Appended ${text.length} chars (profile now ${next.length} chars)`);
    return;
  }
  if (cmd === "append-if-missing") {
    const [marker, ...rest] = args;
    const text = rest.join(" ");
    if (!marker || !text) throw new Error("append-if-missing requires <marker> <text>");
    const current = await readProfile(sheetId, token);
    if (current.includes(marker)) {
      console.log(`Marker "${marker}" already present — skipping`);
      return;
    }
    const next = current.trimEnd() + "\n\n" + text.trim() + "\n";
    await writeProfile(sheetId, token, next);
    console.log(`✓ Appended (marker "${marker}" was not present)`);
    return;
  }
  console.error("Usage: show | append <text> | append-if-missing <marker> <text>");
  process.exit(1);
}

main().catch((err) => {
  console.error("update-profile failed:", err.message);
  process.exit(1);
});
