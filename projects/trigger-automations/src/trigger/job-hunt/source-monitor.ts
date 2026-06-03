// source-monitor.ts — detect sources that have gone silent (HTML changed,
// account locked, site down). Reads the last N days of run_log rows and
// returns a list of sources that returned 0 fetched for 5+ consecutive days.

import { getAccessToken } from "./google-auth.js";
import { LIMITS, SOURCE_ENABLED } from "./config.js";
import { scrapersForTrack } from "./scrapers/index.js";
import type { Source, Track } from "./types.js";
import { RUN_LOG_TAB, RUN_LOG_GLOBAL_TAB } from "./sheet-client.js";

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

export interface SourceHealth {
  source: Source;
  zeroStreakDays: number;
}

export async function detectSilentSources(track: Track = "malta"): Promise<SourceHealth[]> {
  const sheetId = process.env.JobHunt_Sheet_ID;
  if (!sheetId) return [];
  const token = await getAccessToken();
  // Read the run-log tab for THIS track — Malta's health check was wrongly
  // reading global's zero-count entries and flagging them as silent.
  const runLogTab = track === "malta" ? RUN_LOG_TAB : RUN_LOG_GLOBAL_TAB;
  const trackSources = new Set(Object.keys(scrapersForTrack(track)));
  const range = encodeURIComponent(`${runLogTab}!A2:H`);
  const resp = await fetch(`${SHEETS_BASE}/${sheetId}/values/${range}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) return [];
  const data = (await resp.json()) as { values?: string[][] };
  const rows = data.values ?? [];
  if (rows.length === 0) return [];

  // Count consecutive trailing days with 0 for each source.
  const streaks = new Map<Source, number>();
  // Walk newest → oldest (rows are append-only, so newest is last)
  for (let i = rows.length - 1; i >= 0; i--) {
    const perSourceStr = rows[i][6] ?? ""; // col G: per_source_counts, "src:n,src:n"
    const counts = parseCounts(perSourceStr);
    for (const [src, n] of counts) {
      if (n === 0) {
        streaks.set(src, (streaks.get(src) ?? 0) + 1);
      } else {
        // Non-zero → streak broken. Mark -1 so future zeros don't append.
        if (!streaks.has(src)) streaks.set(src, -1);
      }
    }
    // Stop after we've looked at recent enough history
    if (rows.length - 1 - i >= LIMITS.sourceDryStreakDays + 2) break;
  }

  const unhealthy: SourceHealth[] = [];
  for (const [src, streak] of streaks) {
    // Only flag sources that (a) belong to THIS track and (b) are enabled.
    // Flat SOURCE_ENABLED doesn't distinguish tracks, so linkedin-ie etc
    // would otherwise look "silent" in the Malta digest even though they're
    // the global digest's concern.
    if (!trackSources.has(src)) continue;
    if (!SOURCE_ENABLED[src]) continue;
    if (streak >= LIMITS.sourceDryStreakDays) {
      unhealthy.push({ source: src, zeroStreakDays: streak });
    }
  }
  return unhealthy;
}

function parseCounts(s: string): Array<[Source, number]> {
  const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
  const out: Array<[Source, number]> = [];
  for (const p of parts) {
    const [src, nStr] = p.split(":");
    const n = Number(nStr);
    if (!Number.isNaN(n)) out.push([src as Source, n]);
  }
  return out;
}
