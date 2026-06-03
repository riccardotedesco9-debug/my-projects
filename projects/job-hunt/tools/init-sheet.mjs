#!/usr/bin/env node
// init-sheet.mjs — create a new Google Sheet with `jobs` + `run_log` tabs and
// the 19 canonical columns, then print the ID + URL. Run once at setup time;
// drop the printed sheet ID into .env as GOOGLE_SHEET_ID.
//
// Usage:  node --env-file=.env tools/init-sheet.mjs
//
// Requires .env keys: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET,
// GOOGLE_OAUTH_REFRESH_TOKEN. Refresh token must have scope
// https://www.googleapis.com/auth/spreadsheets.

import { getAccessToken, SHEETS_BASE, JOBS_TAB, RUN_LOG_TAB, SHEET_HEADERS } from "./_google-auth.mjs";

const title = `job-hunt — Malta daily digest (${new Date().toISOString().slice(0, 10)})`;

async function main() {
  const token = await getAccessToken();

  // 1. Create spreadsheet with all five tabs used by the pipeline.
  //    jobs + run_log are the Malta track.
  //    jobs_global + run_log_global are the global/Ireland track.
  //    profile holds the user CV+preferences markdown.
  //    company_ratings caches Glassdoor/Indeed reputation lookups (30-day TTL).
  const createResp = await fetch(SHEETS_BASE, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      properties: { title },
      sheets: [
        { properties: { title: JOBS_TAB } },
        { properties: { title: RUN_LOG_TAB } },
        { properties: { title: "jobs_global" } },
        { properties: { title: "run_log_global" } },
        { properties: { title: "profile", gridProperties: { rowCount: 200, columnCount: 1 } } },
        { properties: { title: "company_ratings" } },
      ],
    }),
  });
  if (!createResp.ok) {
    throw new Error(`Create failed (${createResp.status}): ${await createResp.text()}`);
  }
  const { spreadsheetId, spreadsheetUrl } = await createResp.json();

  // 2. Populate headers
  async function writeHeaders(tab, headers) {
    const range = encodeURIComponent(`${tab}!A1:${columnLetter(headers.length)}1`);
    const resp = await fetch(
      `${SHEETS_BASE}/${spreadsheetId}/values/${range}?valueInputOption=RAW`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ values: [headers] }),
      },
    );
    if (!resp.ok) {
      throw new Error(`Header write failed for ${tab} (${resp.status}): ${await resp.text()}`);
    }
  }

  const RUN_LOG_HEADERS = [
    "started_at",
    "finished_at",
    "total_raw",
    "after_filter",
    "new_jobs",
    "digest_sent",
    "per_source_counts",
    "per_source_errors",
  ];
  const COMPANY_RATINGS_HEADERS = [
    "company_normalized",
    "company_raw",
    "glassdoor_rating",
    "glassdoor_reviews",
    "glassdoor_url",
    "indeed_rating",
    "indeed_reviews",
    "indeed_url",
    "summary",
    "red_flags",
    "fetched_at",
  ];

  await writeHeaders(JOBS_TAB, SHEET_HEADERS);
  await writeHeaders(RUN_LOG_TAB, RUN_LOG_HEADERS);
  await writeHeaders("jobs_global", SHEET_HEADERS);
  await writeHeaders("run_log_global", RUN_LOG_HEADERS);
  await writeHeaders("company_ratings", COMPANY_RATINGS_HEADERS);
  // profile tab is a single-cell markdown holder; no headers needed.
  // User seeds it manually (or via a separate init-profile script) post-setup.

  console.log("✓ Sheet created");
  console.log(`  Title: ${title}`);
  console.log(`  ID:    ${spreadsheetId}`);
  console.log(`  URL:   ${spreadsheetUrl}`);
  console.log("");
  console.log("Next step — add this to your .env and Trigger.dev dashboard:");
  console.log(`  GOOGLE_SHEET_ID=${spreadsheetId}`);
}

function columnLetter(n) {
  // 1 → "A", 19 → "S"
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

main().catch((err) => {
  console.error("init-sheet failed:", err.message);
  process.exit(1);
});
