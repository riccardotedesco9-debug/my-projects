// sheet-client.ts — Google Sheets REST v4 via native fetch. No googleapis SDK.
// Responsibilities:
//   - Load sheet state (all rows) so dedup has fingerprint Set + recent rows for fuzzy match
//   - Append new rows at the next empty row
//   - Log run stats into `run_log` tab (zero-email days still get recorded)

import { getAccessToken } from "./google-auth.js";
import { SHEET_HEADERS, type SheetRow, type RunStats, type Reputation } from "./types.js";

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

export const JOBS_TAB = "jobs";
export const JOBS_GLOBAL_TAB = "jobs_global";
export const RUN_LOG_TAB = "run_log";
export const RUN_LOG_GLOBAL_TAB = "run_log_global";
export const PROFILE_TAB = "profile";
export const COMPANY_RATINGS_TAB = "company_ratings";

/** Column order for the company_ratings tab. Do not reorder without also
 * updating the init-sheet helper. */
const RATING_COLS = [
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
] as const;

/** Read the user's CV+preferences profile from `profile!A1`. Falls back to empty
 * string (LLM then uses a generic analyst rubric). */
export async function readProfile(): Promise<string> {
  try {
    const range = encodeURIComponent(`${PROFILE_TAB}!A1`);
    const resp = await sheetsFetch(`/values/${range}`);
    const data = (await resp.json()) as { values?: string[][] };
    return data.values?.[0]?.[0] ?? "";
  } catch (err) {
    console.warn("[profile] read failed, using empty profile:", err instanceof Error ? err.message : err);
    return "";
  }
}

/** Read the cached company reputation entries from the `company_ratings` tab.
 * Returns a Map keyed by `company_normalized` (first column). Missing tab →
 * empty map (caller will populate via live fetches). */
export async function readRatingCache(): Promise<Map<string, Reputation>> {
  const out = new Map<string, Reputation>();
  try {
    const range = encodeURIComponent(`${COMPANY_RATINGS_TAB}!A2:K`);
    const resp = await sheetsFetch(`/values/${range}`);
    const data = (await resp.json()) as { values?: string[][] };
    for (const row of data.values ?? []) {
      const padded = [...row];
      while (padded.length < RATING_COLS.length) padded.push("");
      const key = padded[0];
      if (!key) continue;
      const rep: Reputation = {
        company: key,
        fetchedAt: padded[10] || new Date(0).toISOString(),
      };
      // Guard against malformed cached rows (manual edits, partial writes):
      // only attach rating objects when the parsed number is a real rating.
      const gdRating = Number(padded[2]);
      if (padded[2] && Number.isFinite(gdRating) && gdRating >= 1.0 && gdRating <= 5) {
        rep.glassdoor = {
          rating: gdRating,
          reviews: Number.isFinite(Number(padded[3])) ? Number(padded[3]) : 0,
          url: padded[4] || undefined,
        };
      }
      const idRating = Number(padded[5]);
      if (padded[5] && Number.isFinite(idRating) && idRating >= 1.0 && idRating <= 5) {
        rep.indeed = {
          rating: idRating,
          reviews: Number.isFinite(Number(padded[6])) ? Number(padded[6]) : 0,
          url: padded[7] || undefined,
        };
      }
      if (padded[8]) rep.summary = padded[8];
      if (padded[9]) rep.redFlags = padded[9].split("|").map((s) => s.trim()).filter(Boolean);
      out.set(key, rep);
    }
  } catch (err) {
    console.warn("[rating-cache] read failed:", err instanceof Error ? err.message : err);
  }
  return out;
}

/** Append new reputation entries to the `company_ratings` tab. Does NOT update
 * existing rows — since TTL is 30 days, occasional duplicates get cleaned up
 * manually or via a compaction script (not worth the Sheets batchUpdate
 * complexity at this scale). */
export async function upsertRatings(
  newEntries: Map<string, Reputation>,
  rawCompanyNames?: Map<string, string>,
): Promise<void> {
  if (newEntries.size === 0) return;
  const rows: string[][] = [];
  for (const [key, rep] of newEntries) {
    rows.push([
      key,
      rawCompanyNames?.get(key) ?? key,
      rep.glassdoor ? String(rep.glassdoor.rating) : "",
      rep.glassdoor ? String(rep.glassdoor.reviews) : "",
      rep.glassdoor?.url ?? "",
      rep.indeed ? String(rep.indeed.rating) : "",
      rep.indeed ? String(rep.indeed.reviews) : "",
      rep.indeed?.url ?? "",
      rep.summary ?? "",
      (rep.redFlags ?? []).join("|"),
      rep.fetchedAt,
    ]);
  }
  const range = encodeURIComponent(`${COMPANY_RATINGS_TAB}!A:K`);
  await sheetsFetch(
    `/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: rows }) },
  );
}

/** Raw row shape returned by Sheets (string[] of 19 cells). */
type RawRow = string[];

function sheetId(): string {
  const id = process.env.JobHunt_Sheet_ID;
  if (!id) throw new Error("JobHunt_Sheet_ID is not set");
  return id;
}

async function sheetsFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const resp = await fetch(`${SHEETS_BASE}/${sheetId()}${path}`, { ...init, headers });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Sheets API ${init.method ?? "GET"} ${path} failed (${resp.status}): ${body}`);
  }
  return resp;
}

// ────────────────────────────────────────────────────────────────────
// Read
// ────────────────────────────────────────────────────────────────────

/** Fetch all rows from the given jobs tab (excluding header). */
export async function readAllJobRows(tab: string = JOBS_TAB): Promise<SheetRow[]> {
  const range = encodeURIComponent(`${tab}!A2:S`);
  const resp = await sheetsFetch(`/values/${range}`);
  const data = (await resp.json()) as { values?: RawRow[] };
  const raw = data.values ?? [];
  return raw.map(rawToRow);
}

function rawToRow(cells: RawRow): SheetRow {
  // Pad short rows (Sheets omits trailing empty cells).
  const padded = [...cells];
  while (padded.length < SHEET_HEADERS.length) padded.push("");
  const obj = {} as Record<string, string>;
  SHEET_HEADERS.forEach((h, i) => (obj[h] = padded[i] ?? ""));
  return obj as unknown as SheetRow;
}

function rowToRaw(row: SheetRow): RawRow {
  return SHEET_HEADERS.map((h) => String(row[h] ?? ""));
}

// ────────────────────────────────────────────────────────────────────
// Write
// ────────────────────────────────────────────────────────────────────

export async function appendRows(rows: SheetRow[], tab: string = JOBS_TAB): Promise<void> {
  if (rows.length === 0) return;
  const range = encodeURIComponent(`${tab}!A:S`);
  await sheetsFetch(
    `/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      body: JSON.stringify({ values: rows.map(rowToRaw) }),
    },
  );
}

/** Append one run_log row — useful for zero-email days so we still have a trail. */
export async function appendRunLog(stats: RunStats, tab: string = RUN_LOG_TAB): Promise<void> {
  const range = encodeURIComponent(`${tab}!A:H`);
  const perSourceFetched = Object.entries(stats.perSource)
    .map(([s, v]) => `${s}:${v.fetched}`)
    .join(",");
  const perSourceErrors = Object.entries(stats.perSource)
    .filter(([, v]) => v.error)
    .map(([s, v]) => `${s}:${v.error}`)
    .join("; ");
  const row = [
    stats.startedAt,
    stats.finishedAt,
    String(stats.totalRaw),
    String(stats.afterFilter),
    String(stats.newJobs),
    stats.digestSent ? "Y" : "N",
    perSourceFetched,
    perSourceErrors,
  ];
  await sheetsFetch(
    `/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: [row] }) },
  );
}

/**
 * Update the `all_urls` + `sources` + `source_ids` columns on an existing row
 * when a duplicate appears from a different source. Called by dedup when we
 * choose to keep the existing winner and only append the new URL to the trail.
 */
export async function mergeSourceIntoRow(
  rowIndex: number,          // 1-based sheet row number (header=1, first data=2)
  mergedRow: SheetRow,
  tab: string = JOBS_TAB,
): Promise<void> {
  const range = encodeURIComponent(`${tab}!A${rowIndex}:S${rowIndex}`);
  await sheetsFetch(`/values/${range}?valueInputOption=RAW`, {
    method: "PUT",
    body: JSON.stringify({ values: [rowToRaw(mergedRow)] }),
  });
}

// ────────────────────────────────────────────────────────────────────
// Setup helpers — used by tools/init-sheet.mjs
// ────────────────────────────────────────────────────────────────────

/** Create a new spreadsheet with `jobs` and `run_log` tabs + headers. Returns its ID. */
export async function createSheetWithTabs(title: string): Promise<{ sheetId: string; url: string }> {
  const token = await getAccessToken();
  const createResp = await fetch(SHEETS_BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      properties: { title },
      sheets: [
        { properties: { title: JOBS_TAB } },
        { properties: { title: RUN_LOG_TAB } },
      ],
    }),
  });
  if (!createResp.ok) {
    const body = await createResp.text();
    throw new Error(`Failed to create sheet (${createResp.status}): ${body}`);
  }
  const data = (await createResp.json()) as {
    spreadsheetId: string;
    spreadsheetUrl: string;
  };

  // Populate headers — need JobHunt_Sheet_ID env temporarily set for sheetsFetch.
  process.env.JobHunt_Sheet_ID = data.spreadsheetId;

  await sheetsFetch(
    `/values/${encodeURIComponent(`${JOBS_TAB}!A1:S1`)}?valueInputOption=RAW`,
    {
      method: "PUT",
      body: JSON.stringify({ values: [SHEET_HEADERS as unknown as string[]] }),
    },
  );
  await sheetsFetch(
    `/values/${encodeURIComponent(`${RUN_LOG_TAB}!A1:H1`)}?valueInputOption=RAW`,
    {
      method: "PUT",
      body: JSON.stringify({
        values: [[
          "started_at",
          "finished_at",
          "total_raw",
          "after_filter",
          "new_jobs",
          "digest_sent",
          "per_source_counts",
          "per_source_errors",
        ]],
      }),
    },
  );

  return { sheetId: data.spreadsheetId, url: data.spreadsheetUrl };
}

/** Clear the fingerprint column — equivalent to dedup reset. */
export async function clearFingerprints(): Promise<void> {
  const range = encodeURIComponent(`${JOBS_TAB}!Q2:Q`);
  await sheetsFetch(`/values/${range}:clear`, { method: "POST" });
}
