// dedup.ts — 6-layer dedup. Runs twice:
//   (a) intra-run: collapse duplicates inside the current batch
//   (b) vs sheet: drop anything already written, merge URLs into existing rows
//
// Layers:
//   1. normalize (already done in normalize.ts)
//   2. exact fingerprint (O(1) Set lookup)
//   3. fuzzy fallback (Levenshtein ≥ 0.92 on recent rows)
//   4. URL safety net (col L or M exact match)
//   5. source priority (winner selection when merging)
//   6. intra-run fingerprint collapse before sheet compare
//
// Output: { newRows, merges } — orchestrator writes newRows via appendRows
// and applies merges via mergeSourceIntoRow.

import { SOURCE_PRIORITY, LIMITS } from "../config.js";
import type { Job, SheetRow, Source } from "../types.js";

export interface DedupOutput {
  /** Jobs to append as fresh rows in the sheet. */
  newJobs: Job[];
  /** Existing rows to update with new source URL in `all_urls`. */
  merges: Array<{ rowIndex: number; merged: SheetRow }>;
  /** Per-input decision log for debugging. */
  log: string[];
}

/** Reference to an existing sheet row, keyed for fast lookup. */
export interface SheetIndex {
  byFingerprint: Map<string, { rowIndex: number; row: SheetRow }>;
  byUrl: Map<string, { rowIndex: number; row: SheetRow }>;
  recentRows: Array<{ rowIndex: number; row: SheetRow }>; // past N days for fuzzy match
}

/**
 * Build a lookup index from a read of the whole sheet.
 * `rowIndex` is 1-based including header, so first data row is 2.
 */
export function buildSheetIndex(rows: SheetRow[]): SheetIndex {
  const byFingerprint = new Map<string, { rowIndex: number; row: SheetRow }>();
  const byUrl = new Map<string, { rowIndex: number; row: SheetRow }>();
  const cutoff = new Date(Date.now() - LIMITS.fuzzyDedupWindow * 86_400_000);
  const recentRows: Array<{ rowIndex: number; row: SheetRow }> = [];

  rows.forEach((row, idx) => {
    const rowIndex = idx + 2; // +2 for 1-based + header
    if (row.fingerprint) byFingerprint.set(row.fingerprint, { rowIndex, row });
    // Only index non-empty URLs — empty strings would collide all empty-URL rows.
    if (row.url && row.url.length > 0) byUrl.set(row.url, { rowIndex, row });
    if (row.all_urls) {
      for (const u of row.all_urls.split(",").map((s) => s.trim())) {
        if (u) byUrl.set(u, { rowIndex, row });
      }
    }
    const seenAt = row.date_seen ? new Date(row.date_seen) : null;
    if (!seenAt || seenAt >= cutoff) {
      recentRows.push({ rowIndex, row });
    }
  });

  return { byFingerprint, byUrl, recentRows };
}

/**
 * Main dedup pass. Handles intra-run collapse then compares to the sheet index.
 */
export function dedup(jobs: Job[], index: SheetIndex): DedupOutput {
  const log: string[] = [];

  // Layer 6: intra-run collapse by fingerprint. Winner = higher SOURCE_PRIORITY.
  const collapsed = collapseIntraRun(jobs, log);

  const newJobs: Job[] = [];
  const merges: Array<{ rowIndex: number; merged: SheetRow }> = [];

  for (const job of collapsed) {
    // Layer 2: exact fingerprint
    const byFp = index.byFingerprint.get(job.fingerprint);
    if (byFp) {
      const merged = applyMergeIntoRow(byFp.row, job);
      if (merged) merges.push({ rowIndex: byFp.rowIndex, merged });
      log.push(`[fp] merge ${job.source}:${job.sourceId} → row ${byFp.rowIndex}`);
      continue;
    }
    // Layer 4: URL safety net (skip if URL empty — empty matches are spurious)
    const byUrl = job.url ? index.byUrl.get(job.url) : undefined;
    if (byUrl) {
      const merged = applyMergeIntoRow(byUrl.row, job);
      if (merged) merges.push({ rowIndex: byUrl.rowIndex, merged });
      log.push(`[url] merge ${job.source}:${job.sourceId} → row ${byUrl.rowIndex}`);
      continue;
    }
    // Layer 3: fuzzy fallback against recent rows
    const fuzzy = findFuzzyMatch(job, index.recentRows);
    if (fuzzy) {
      const merged = applyMergeIntoRow(fuzzy.row, job);
      if (merged) merges.push({ rowIndex: fuzzy.rowIndex, merged });
      log.push(
        `[fuzzy] merge ${job.source}:${job.sourceId} → row ${fuzzy.rowIndex} (ratio ${fuzzy.ratio.toFixed(3)})`,
      );
      continue;
    }
    newJobs.push(job);
  }

  return { newJobs, merges, log };
}

function collapseIntraRun(jobs: Job[], log: string[]): Job[] {
  const buckets = new Map<string, Job[]>();
  for (const j of jobs) {
    const arr = buckets.get(j.fingerprint);
    if (arr) arr.push(j);
    else buckets.set(j.fingerprint, [j]);
  }
  const out: Job[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.length === 1) {
      out.push(bucket[0]);
      continue;
    }
    // Pick winner by source priority
    bucket.sort((a, b) => SOURCE_PRIORITY[b.source] - SOURCE_PRIORITY[a.source]);
    const winner = bucket[0];
    // Fill in missing fields from non-winners (e.g. castille sitemap has no
    // descriptionMd; if LinkedIn also scraped the same role, borrow its desc).
    for (const loser of bucket.slice(1)) {
      if (!winner.descriptionMd && loser.descriptionMd) winner.descriptionMd = loser.descriptionMd;
      if (!winner.estSalary && loser.estSalary) winner.estSalary = loser.estSalary;
      if (!winner.postedAt && loser.postedAt) winner.postedAt = loser.postedAt;
      if (!winner.contact && loser.contact) winner.contact = loser.contact;
      if (winner.partTime === "unknown" && loser.partTime !== "unknown") winner.partTime = loser.partTime;
      if (winner.workMode === "unclear" && loser.workMode !== "unclear") winner.workMode = loser.workMode;
      if (!winner.locality && loser.locality) winner.locality = loser.locality;
    }
    const allUrls = bucket.map((b) => b.url).filter(Boolean);
    const allSources = [...new Set(bucket.map((b) => b.source))];
    const allSourceIds = bucket.map((b) => `${b.source}:${b.sourceId}`);
    (winner as Job & { _urlTrail?: string[] })._urlTrail = allUrls;
    (winner as Job & { _sourceTrail?: Source[] })._sourceTrail = allSources;
    (winner as Job & { _sourceIdTrail?: string[] })._sourceIdTrail = allSourceIds;
    log.push(`[intra-run] collapse ${bucket.length}× → winner=${winner.source}:${winner.sourceId}`);
    out.push(winner);
  }
  return out;
}

function findFuzzyMatch(
  job: Job,
  rows: Array<{ rowIndex: number; row: SheetRow }>,
): { rowIndex: number; row: SheetRow; ratio: number } | null {
  let best: { rowIndex: number; row: SheetRow; ratio: number } | null = null;
  // Normalize both sides to lowercase so future changes in Job.title case
  // don't silently break fuzzy matching.
  const a = `${job.title}|${job.company}`.toLowerCase();
  // Short strings risk false merges at 0.92 (1-char edit = pass). Require the
  // shorter side to be ≥ 25 chars so "Data Analyst|Acme" (16 chars) doesn't
  // collide with "Data Analysts|Acme".
  if (a.length < 25) return null;
  for (const r of rows) {
    const b = `${r.row.title}|${r.row.company}`.toLowerCase();
    if (b.length < 25) continue;
    const ratio = similarityRatio(a, b);
    if (ratio >= LIMITS.fuzzyThreshold && (!best || ratio > best.ratio)) {
      best = { rowIndex: r.rowIndex, row: r.row, ratio };
    }
  }
  return best;
}

/** Levenshtein-based ratio in [0, 1]. */
function similarityRatio(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const len = Math.max(a.length, b.length);
  return 1 - levenshtein(a, b) / len;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * Merge a newly-seen job's URL and source into an existing sheet row.
 * Returns null if nothing changed (new row's url was already in the trail).
 */
function applyMergeIntoRow(existing: SheetRow, job: Job): SheetRow | null {
  const urls = new Set(
    (existing.all_urls ? existing.all_urls.split(",") : [existing.url])
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const sources = new Set(
    (existing.sources ? existing.sources.split(",") : [])
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const sourceIds = new Set(
    (existing.source_ids ? existing.source_ids.split(",") : [])
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const incomingUrl = job.url.trim();
  const incomingSrcId = `${job.source}:${job.sourceId}`;
  if (urls.has(incomingUrl) && sources.has(job.source) && sourceIds.has(incomingSrcId)) {
    return null;
  }
  if (incomingUrl) urls.add(incomingUrl);
  sources.add(job.source);
  sourceIds.add(incomingSrcId);

  return {
    ...existing,
    sources: [...sources].join(","),
    source_ids: [...sourceIds].join(","),
    all_urls: [...urls].join(","),
  };
}
