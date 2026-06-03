// _google-auth.mjs — mirror of src/trigger/job-hunt/google-auth.ts for local CLI scripts.
// Kept minimal (no cache) — local scripts do one-shot work, no need for TTL logic.

export async function getAccessToken() {
  const clientId = process.env.OAuth_Client_ID_Desktop;
  const clientSecret = process.env.OAuth_Client_Secret_Desktop;
  const refreshToken = process.env.Google_Refresh_Token;
  if (!clientId) throw new Error("OAuth_Client_ID_Desktop is not set");
  if (!clientSecret) throw new Error("OAuth_Client_Secret_Desktop is not set");
  if (!refreshToken) throw new Error("Google_Refresh_Token is not set");

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!resp.ok) {
    throw new Error(`Google token refresh failed (${resp.status}): ${await resp.text()}`);
  }
  const data = await resp.json();
  return data.access_token;
}

export const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
export const JOBS_TAB = "jobs";
export const RUN_LOG_TAB = "run_log";

export const SHEET_HEADERS = [
  "date_seen",
  "sources",
  "source_ids",
  "title",
  "company",
  "location",
  "locality",
  "work_mode",
  "part_time_yn",
  "est_salary",
  "contact",
  "url",
  "all_urls",
  "status",
  "notes",
  "digest_sent",
  "fingerprint",
  "confidence",
  "score",
];
