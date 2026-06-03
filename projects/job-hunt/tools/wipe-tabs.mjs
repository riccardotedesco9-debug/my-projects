#!/usr/bin/env node
// wipe-tabs.mjs — clears ALL data rows (A2:S) on both `jobs` and `jobs_global`.
// Use before a manual "send one" re-run so dedup (fingerprint + URL + fuzzy)
// doesn't suppress every candidate. Headers (row 1) are preserved.
//
// Usage:  node --env-file=.env tools/wipe-tabs.mjs [malta|global|both]

import { getAccessToken, SHEETS_BASE } from "./_google-auth.mjs";

const TABS = { malta: "jobs", global: "jobs_global" };

async function clearTab(sheetId, token, tab) {
  const range = encodeURIComponent(`${tab}!A2:S`);
  const resp = await fetch(`${SHEETS_BASE}/${sheetId}/values/${range}:clear`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    throw new Error(`Clear ${tab} failed (${resp.status}): ${await resp.text()}`);
  }
  console.log(`✓ Cleared ${tab} (A2:S)`);
}

async function main() {
  const sheetId = process.env.JobHunt_Sheet_ID;
  if (!sheetId) throw new Error("JobHunt_Sheet_ID is not set");

  const which = (process.argv[2] ?? "both").toLowerCase();
  const targets = which === "both"
    ? [TABS.malta, TABS.global]
    : TABS[which]
      ? [TABS[which]]
      : null;
  if (!targets) throw new Error(`Unknown target '${which}' — use malta, global, or both`);

  const token = await getAccessToken();
  for (const tab of targets) await clearTab(sheetId, token, tab);
  console.log("Done. Next run will re-dedup from an empty sheet.");
}

main().catch((err) => {
  console.error("wipe-tabs failed:", err.message);
  process.exit(1);
});
