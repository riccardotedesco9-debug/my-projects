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

/** Reject postings older than this many days. Default 30 (analyst PT roles
 * churn fast — a 60-day-old listing is almost always closed even when not
 * marked). Override per-run via `JOBHUNT_MAX_AGE_DAYS` env var. */
export const MAX_AGE_DAYS = (() => {
  const raw = process.env.JOBHUNT_MAX_AGE_DAYS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 30;
})();

export interface FreshnessCheck {
  fresh: boolean;
  reason?: string;
  /** When URL verify extracted a `datePosted` from the listing's JSON-LD, it
   * gets returned here so the orchestrator can enrich the Job record. Lets
   * the digest card show "Posted: DD/MM/YYYY" even on scrapers that don't
   * surface posting dates (LinkedIn / Google snippet sources). */
  postedAt?: string;
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
      // Read up to 60KB — JSON-LD schema blocks often sit past the 30KB mark.
      // The text-regex pass still only looks at the first 30KB.
      const raw = (await resp.text()).slice(0, 60_000);
      const lower = raw.slice(0, 30_000).toLowerCase();

      // LinkedIn closed-job indicators — multiple variants seen in the wild.
      // 1. Server-rendered `<figure class="closed-job">` block (the original
      //    signal — caught ~36% of closed LI URLs on its own).
      // 2. `data-test-id="closed-job"` / `="no-longer-accepting"` attributes
      //    used by LinkedIn's React-rendered detail card.
      // 3. Headline classes `jobs-details-top-card__no-longer-accepting` and
      //    `closed-job-indicator` that LI server-renders alongside (1) on
      //    closed posts.
      if (
        /<figure\s+class="[^"]*\bclosed-job\b[^"]*"/i.test(raw) ||
        /data-test-id="(closed-job|no-longer-accepting)/i.test(raw) ||
        /class="[^"]*\b(jobs-details-top-card__no-longer-accepting|closed-job-indicator)\b[^"]*"/i.test(raw)
      ) {
        return { fresh: false, reason: "linkedin closed-job marker" };
      }

      // Generic text patterns (non-LinkedIn platforms that render server-side).
      for (const re of CLOSED_PATTERNS) {
        if (re.test(lower)) {
          return { fresh: false, reason: `closed-marker in body: /${re.source}/` };
        }
      }

      // JSON-LD JobPosting — authoritative posting dates. If validThrough has
      // passed, the role is expired. If datePosted is > MAX_AGE_DAYS old, drop
      // as stale. Extract on every page so we can also enrich the Job record
      // with a posted date for the digest card.
      const ld = extractJobPostingLd(raw);
      if (ld?.validThrough) {
        const t = Date.parse(ld.validThrough);
        if (Number.isFinite(t) && t < Date.now()) {
          return { fresh: false, reason: `validThrough passed (${ld.validThrough})`, postedAt: ld.datePosted };
        }
      }
      if (ld?.datePosted) {
        const t = Date.parse(ld.datePosted);
        if (Number.isFinite(t)) {
          const ageDays = (Date.now() - t) / 86_400_000;
          if (ageDays > MAX_AGE_DAYS) {
            return { fresh: false, reason: `datePosted ${ageDays.toFixed(0)}d old`, postedAt: ld.datePosted };
          }
        }
      }
      return { fresh: true, postedAt: ld?.datePosted };
    }

    return { fresh: true };
  } catch (err) {
    // Network errors — pass through (don't drop jobs on transient issues)
    return { fresh: true, reason: `unverified (${err instanceof Error ? err.name : "err"})` };
  } finally {
    clearTimeout(timeout);
  }
}

/** Test helper — returns the first matching closed-pattern, if any, against a
 * lowercased HTML body. Exposed for unit coverage; production callers use the
 * verifyActive flow above. */
export function matchClosedMarker(lowercaseBody: string): RegExp | null {
  for (const re of CLOSED_PATTERNS) {
    if (re.test(lowercaseBody)) return re;
  }
  return null;
}

/** Extract the first JobPosting JSON-LD block from raw HTML. Returns `null`
 * when absent or malformed. Used to pull authoritative posting dates from
 * pages whose scrapers don't expose them (LinkedIn public view, Greenhouse
 * ATS, Workable, etc.). Exposed for tests. */
export function extractJobPostingLd(html: string): { datePosted?: string; validThrough?: string } | null {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const json = JSON.parse(m[1].trim());
      const items = Array.isArray(json) ? json : [json];
      for (const item of items) {
        if (item && typeof item === "object" && item["@type"] === "JobPosting") {
          const datePosted = typeof item.datePosted === "string" ? item.datePosted : undefined;
          const validThrough = typeof item.validThrough === "string" ? item.validThrough : undefined;
          if (datePosted || validThrough) return { datePosted, validThrough };
        }
      }
    } catch {
      // Some pages have HTML-escaped or embedded JSON that isn't strict — skip.
    }
  }
  return null;
}

/** Common "this job is closed" markers across LinkedIn / Indeed / ATS
 * (Greenhouse, Workday, Lever, SmartRecruiters, Workable). Word-bounded and
 * lowercased — the body is lowercased before test. Kept anchored on
 * listing-specific nouns (role/vacancy/job/position/opportunity/listing/
 * posting) so stray sentences ("we closed the Q3 deal") don't trip them. */
const CLOSED_PATTERNS = [
  // Most common — any listing-noun + state verb. Covers "this role is filled",
  // "the vacancy has been closed", "this job was withdrawn", etc.
  /\b(this|the)\s+(role|vacancy|job|position|opportunity|listing|posting|advert|advertisement)\s+(is|has been|was|is now)\s+(closed|filled|removed|expired|withdrawn|archived|deleted|retired|cancell?ed)\b/,
  // "is no longer available/open/active/being recruited"
  /\b(this|the)\s+(role|vacancy|job|position|opportunity|listing|posting|advert|advertisement)\s+is\s+no\s+longer\s+(available|accepting|open|active|live|being\s+(recruited|filled|considered|advertised|offered))\b/,
  // Application-side variants
  /\bapplications?\s+(are|have\s+been|have|is|are\s+now|have\s+now)\s+(closed|no\s+longer\s+(accepted|being\s+accepted|open)|not\s+being\s+accepted)\b/,
  /\bno\s+longer\s+accepting\s+(applications?|applicants?|candidates?|submissions?)\b/,
  /\bwe\s+(have|are|have\s+now)\s+(closed|stopped\s+accepting|filled|no\s+longer\s+accepting)\s+(applications?|this\s+(role|position|vacancy))\b/,
  // Bare-noun short form — "position filled", "role closed", "vacancy expired"
  /\b(role|vacancy|job|position|posting|listing|advert)\s+(is\s+)?(filled|closed|expired|withdrawn|archived)\b/,
  /\b(closed|expired)\s+(to\s+)?applications?\b/,
  /\bjob\s+expired\b/,
  // Hiring-side — "we're not hiring for this role", "we have filled this role"
  /\bwe\s+are\s+no\s+longer\s+hiring\s+for\s+this\s+(role|position|vacancy|job)\b/,
  /\bwe\s+have\s+(filled|closed)\s+this\s+(role|position|vacancy|job|opportunity)\b/,
  // Opportunity-specific
  /\bthis\s+opportunity\s+is\s+no\s+longer\s+available\b/,
  // LinkedIn-specific URL-in-body marker
  /\bjobs\/view\/.*is no longer available\b/,
  // Generic "applications closed" / "closed to applications" headline variant
  /\bapplications?\s+(for\s+this\s+(role|position|vacancy|job)\s+)?(have\s+)?closed\b/,
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
    // LinkedIn-specific: closed jobs frequently 302 to /login or /uas/login
    // (with session_redirect back to the dead URL). Treat any such redirect
    // as removal regardless of the original hostname (covers all LI subdomains
    // including www., mt., uk., etc.).
    if (
      /(^|\.)linkedin\.com$/i.test(b.hostname) &&
      /^\/(login|uas\/login|checkpoint)/i.test(b.pathname)
    ) {
      return true;
    }
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
