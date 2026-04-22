// freshness.ts — two-layer active-job check:
//
// Layer A (cheap, always runs): `isFreshFromMetadata(job)` — parses date
//   signals from title/description ("posted 3 months ago", "2 weeks ago") and
//   the `postedAt` field if set. Rejects anything over MAX_AGE_DAYS old.
//
// Layer B (expensive, runs only on digest-bound top-K): `verifyActive(url)`
//   — plain fetch (no Firecrawl) against the job URL with a short timeout.
//   Catches 404/410/redirect-to-listing-page + obvious closed-job text in the
//   HTML. SPAs that require JS will return 200 + shell HTML → indistinguishable
//   from active, so those fall through as "active by default" (better than
//   false-rejecting real roles).

import type { Job } from "../types.js";

/** Reject postings older than this many days. */
export const MAX_AGE_DAYS = 60;

export interface FreshnessCheck {
  fresh: boolean;
  reason?: string;
}

/** Metadata-based filter — O(1), no network. */
export function isFreshFromMetadata(job: Job): FreshnessCheck {
  const now = Date.now();

  // 1. explicit postedAt field
  if (job.postedAt) {
    const t = Date.parse(job.postedAt);
    if (!Number.isNaN(t)) {
      const ageDays = (now - t) / (1000 * 60 * 60 * 24);
      if (ageDays > MAX_AGE_DAYS) return { fresh: false, reason: `postedAt=${ageDays.toFixed(0)}d old` };
    }
  }

  // 2. parse "X days/weeks/months ago" from snippet/title
  const blob = `${job.titleRaw} ${job.descriptionMd}`.toLowerCase();
  // months (most restrictive)
  const monthsMatch = blob.match(/(\d+)\s*(?:\+\s*)?months?\s*ago/);
  if (monthsMatch) {
    const months = Number(monthsMatch[1]);
    if (months * 30 > MAX_AGE_DAYS) return { fresh: false, reason: `${months}mo ago` };
  }
  // weeks
  const weeksMatch = blob.match(/(\d+)\s*(?:\+\s*)?weeks?\s*ago/);
  if (weeksMatch) {
    const weeks = Number(weeksMatch[1]);
    if (weeks * 7 > MAX_AGE_DAYS) return { fresh: false, reason: `${weeks}w ago` };
  }
  // relative "reposted", "closed", obvious staleness
  if (/\b(reposted|this role has been reposted|hiring has closed|closed for applications|position filled|no longer accepting)\b/.test(blob)) {
    return { fresh: false, reason: "closed-in-snippet" };
  }

  return { fresh: true };
}

/**
 * Network check — plain fetch, 8s timeout. Returns {active:false} for
 * 404/410/redirect-to-generic-page/explicit-closed-markers. Returns
 * {active:true} on any 2xx that doesn't look closed, OR on network error
 * (conservative: keep the job rather than drop it on flaky network).
 */
export async function verifyActive(url: string): Promise<FreshnessCheck> {
  if (!/^https?:\/\//i.test(url)) return { fresh: true }; // can't verify, pass

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        // Some sites block obvious bots; mimic a browser-ish UA.
        "User-Agent": "Mozilla/5.0 (compatible; job-hunt/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
    });

    // Hard HTTP failures → inactive
    if (resp.status === 404 || resp.status === 410) {
      return { fresh: false, reason: `http ${resp.status}` };
    }

    // Redirect-followed final URL may indicate removal — e.g. LinkedIn closed
    // jobs 302 to /jobs/search. Compare original hostname path shape to final.
    const finalUrl = resp.url;
    if (looksLikeRemovalRedirect(url, finalUrl)) {
      return { fresh: false, reason: `redirected to listing: ${shortUrl(finalUrl)}` };
    }

    // Only check body text if we actually got HTML
    const ct = resp.headers.get("content-type") ?? "";
    if (resp.ok && ct.includes("text/html")) {
      // Cap body read at 30KB — we only need the first viewport-ish chunk.
      const body = (await resp.text()).slice(0, 30_000).toLowerCase();
      if (CLOSED_PATTERNS.some((re) => re.test(body))) {
        return { fresh: false, reason: "closed-marker in body" };
      }
    }

    return { fresh: true };
  } catch (err) {
    // Network errors — pass through (don't drop jobs on transient issues)
    return { fresh: true, reason: `unverified (${err instanceof Error ? err.name : "err"})` };
  } finally {
    clearTimeout(timeout);
  }
}

/** Common "this job is closed" markers across LinkedIn / Indeed / ATS. */
const CLOSED_PATTERNS = [
  /\bno longer accepting applications\b/,
  /\bthis position (is|has been) (closed|filled)\b/,
  /\bthis job (is|has been) (closed|filled|removed|expired)\b/,
  /\bthe position (is|has been) (closed|filled)\b/,
  /\bthis job posting is no longer available\b/,
  /\bjob expired\b/,
  /\bapplications are (closed|no longer)\b/,
  /\bposition filled\b/,
  /\bwe are no longer hiring for this role\b/,
  /\bjobs\/view\/.*is no longer available\b/,  // LinkedIn
];

/**
 * Detect when a job detail URL got redirected to a generic listing/search page —
 * often happens when a site removes the posting. Heuristic: original URL had
 * a path with an ID segment (digits or long slug), final URL is a short generic
 * path like /jobs or /search.
 */
function looksLikeRemovalRedirect(original: string, final: string): boolean {
  try {
    const a = new URL(original);
    const b = new URL(final);
    if (a.hostname !== b.hostname) return false;  // cross-site redirect — keep
    const origPath = a.pathname.replace(/\/$/, "");
    const finalPath = b.pathname.replace(/\/$/, "");
    // Original had a deep path (3+ segments or a numeric ID), final is shallow
    const origDepth = origPath.split("/").filter(Boolean).length;
    const finalDepth = finalPath.split("/").filter(Boolean).length;
    if (origDepth >= 2 && finalDepth <= 1) return true;
    // Direct redirect to common "job removed" landing pages
    if (/^\/(jobs|search|404|not-found)\/?$/i.test(finalPath)) return true;
    return false;
  } catch {
    return false;
  }
}

function shortUrl(u: string): string {
  try {
    const url = new URL(u);
    return url.pathname.slice(0, 40);
  } catch {
    return u.slice(0, 40);
  }
}

/** Concurrency-limited `Promise.all` — verify K jobs at ≤5 parallel fetches. */
export async function verifyActiveBatch(
  jobs: Job[],
  concurrency = 5,
): Promise<Map<string, FreshnessCheck>> {
  const results = new Map<string, FreshnessCheck>();
  let cursor = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const i = cursor++;
      const job = jobs[i];
      try {
        results.set(job.url, await verifyActive(job.url));
      } catch (err) {
        results.set(job.url, { fresh: true, reason: `err ${err instanceof Error ? err.message : err}` });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return results;
}
