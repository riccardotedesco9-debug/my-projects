// Job-hunt app-level metrics aggregated from the JobHunt sheet's run_log
// tabs (one for malta track, one for global). Each run_log row has columns
// A:H per src/trigger/job-hunt/sheet-client.ts:appendRunLog —
//   A startedAt   B finishedAt   C totalRaw   D afterFilter
//   E newJobs     F digestSent (Y/N)   G perSourceFetched   H perSourceErrors
//
// We aggregate over rows whose `startedAt` falls within the target month.
// Fail-open: errors captured, never thrown.

import { getAccessToken } from "../../trigger/job-hunt/google-auth.js";

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const TABS = ["run_log", "run_log_global"];

export interface JobhuntAppMetrics {
  runs: number | null;
  jobs_ingested: number | null;
  emails_sent: number | null;
  error: string | null;
}

export async function fetchJobhuntAppMetrics(monthStartISO: string): Promise<JobhuntAppMetrics> {
  const sheetId = process.env.JobHunt_Sheet_ID;
  if (!sheetId) {
    return { runs: null, jobs_ingested: null, emails_sent: null, error: "JobHunt_Sheet_ID not set" };
  }

  // Lexicographic prefix match — startedAt is ISO 8601 (`2026-04-23T22:36:...`)
  // so the YYYY-MM prefix groups rows correctly.
  const monthPrefix = monthStartISO.slice(0, 7);

  try {
    const token = await getAccessToken();
    let runs = 0;
    let jobsIngested = 0;
    let emailsSent = 0;

    for (const tab of TABS) {
      const range = encodeURIComponent(`${tab}!A2:F`);
      const url = `${SHEETS_BASE}/${sheetId}/values/${range}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        // 400 with "Unable to parse range" = tab doesn't exist (fine — track unused).
        // Anything else propagates as error.
        if (res.status === 400) continue;
        throw new Error(`Sheets read ${tab} (${res.status}): ${(await res.text()).slice(0, 200)}`);
      }
      const json = (await res.json()) as { values?: string[][] };
      for (const row of json.values ?? []) {
        const [startedAt, , totalRaw, , , digestSent] = row;
        if (!startedAt || !startedAt.startsWith(monthPrefix)) continue;
        runs++;
        const n = Number(totalRaw);
        if (Number.isFinite(n)) jobsIngested += n;
        if (digestSent === "Y") emailsSent++;
      }
    }

    return { runs, jobs_ingested: jobsIngested, emails_sent: emailsSent, error: null };
  } catch (err) {
    return {
      runs: null,
      jobs_ingested: null,
      emails_sent: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
