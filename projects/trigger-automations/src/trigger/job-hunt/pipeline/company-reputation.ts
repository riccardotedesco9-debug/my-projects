// company-reputation.ts — public-review lookup for employers.
//
// Strategy: Firecrawl `/v1/search` against "{company} glassdoor" and a few
// alternates (indeed.com/cmp, comparably.com). Google's rich-result snippets
// often include "3.9 · 1,234 reviews" text in title/description. Regex-extract
// that into a structured Reputation record, cache in the `company_ratings`
// sheet tab with 30-day TTL.
//
// Graceful degradation: if Firecrawl credits are exhausted or the company
// isn't on any review site, returns null. Orchestrator continues; Sonnet falls
// back to training-knowledge reputation reasoning.

import { normCompany } from "./normalize.js";
import { tryReserveFirecrawl } from "../scrapers/firecrawl-search.js";
import type { Reputation } from "../types.js";

const FIRECRAWL_SEARCH = "https://api.firecrawl.dev/v1/search";
const FIRECRAWL_SCRAPE = "https://api.firecrawl.dev/v1/scrape";
const TTL_DAYS = 30;

interface SearchHit {
  title?: string;
  url?: string;
  description?: string;
}

/** Key used in the cache Map + sheet column A. */
export function reputationKey(company: string): string {
  return normCompany(company);
}

/**
 * Live fetch — 1 Firecrawl call per source, max 2 sources tried (Glassdoor first,
 * Indeed as fallback). Returns null on network/auth error OR if no rating found.
 */
export async function fetchReputation(company: string): Promise<Reputation | null> {
  const apiKey = process.env.FireCrawlAPI;
  if (!apiKey || !company.trim()) return null;
  const key = reputationKey(company);

  const out: Reputation = {
    company: key,
    fetchedAt: new Date().toISOString(),
  };
  const redFlags: string[] = [];

  // Glassdoor — accept any TLD (.com, .co.uk, .com.au, .co.nz, etc.).
  // Snippet often omits the rating (only "1K Reviews" text) so we scrape the
  // landing page as fallback to extract the actual overall rating.
  try {
    const gd = await searchAndScrape(apiKey, `"${company}" glassdoor reviews`, /glassdoor\./i);
    if (gd) out.glassdoor = gd;
  } catch (err) {
    console.warn(`[reputation] glassdoor fetch failed for ${company}:`, err instanceof Error ? err.message : err);
  }

  // Indeed — Indeed consolidates companies by parent brand ("Aristocrat
  // Interactive" → cmp/Aristocrat). Unquoted query lets Google match the
  // parent page; URL filter narrows to /cmp/ pages. Quoted `"${company}"` was
  // missing most hits because the exact phrase isn't on Indeed's page titles.
  try {
    const id = await searchAndScrape(apiKey, `${company} site:indeed.com/cmp`, /indeed\.com\/cmp\//i);
    if (id) out.indeed = id;
  } catch (err) {
    console.warn(`[reputation] indeed fetch failed for ${company}:`, err instanceof Error ? err.message : err);
  }

  // Fallback chain — only fire when both primary sources missed. Catches
  // Malta SMBs and smaller employers. First hit wins.
  // NOTE: Google Maps was removed — Google search never returns maps.google.com
  // URLs in /v1/search results, so the filter matched nothing.
  if (!out.glassdoor && !out.indeed) {
    const fallbacks: Array<{ name: string; query: string; urlFilter: RegExp }> = [
      { name: "Trustpilot", query: `site:trustpilot.com/review "${company}"`, urlFilter: /trustpilot\.com/i },
      { name: "Comparably", query: `site:comparably.com "${company}"`, urlFilter: /comparably\.com/i },
    ];
    for (const fb of fallbacks) {
      try {
        const hit = await searchAndScrape(apiKey, fb.query, fb.urlFilter);
        if (hit) {
          out.other = { source: fb.name, rating: hit.rating, reviews: hit.reviews, url: hit.url };
          break;
        }
      } catch (err) {
        console.warn(`[reputation] ${fb.name} fetch failed for ${company}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  // Red-flag low ratings
  if (out.glassdoor && out.glassdoor.rating < 3.0) redFlags.push(`Glassdoor ${out.glassdoor.rating.toFixed(1)}★ — below 3.0`);
  if (out.indeed && out.indeed.rating < 3.0) redFlags.push(`Indeed ${out.indeed.rating.toFixed(1)}★ — below 3.0`);
  if (out.other && out.other.rating < 3.0) redFlags.push(`${out.other.source} ${out.other.rating.toFixed(1)}★ — below 3.0`);
  if (redFlags.length > 0) out.redFlags = redFlags;
  out.summary = buildSummary(out);

  // If we got nothing useful, return null so caller doesn't cache an empty row
  if (!out.glassdoor && !out.indeed && !out.other) return null;
  return out;
}

/**
 * Cache-first lookup. Reads from the in-memory `cache` map (loaded from sheet
 * at run start) and falls back to `fetchReputation` + adds to `newEntries` so
 * the caller can persist them via `upsertRatings`.
 */
export async function getReputation(
  company: string,
  cache: Map<string, Reputation>,
  newEntries: Map<string, Reputation>,
): Promise<Reputation | null> {
  if (!company.trim()) return null;
  const key = reputationKey(company);
  const cached = cache.get(key);
  if (cached) {
    const ageDays = (Date.now() - Date.parse(cached.fetchedAt)) / (1000 * 60 * 60 * 24);
    if (ageDays < TTL_DAYS) return cached;
  }
  const fetched = await fetchReputation(company);
  if (fetched) {
    newEntries.set(key, fetched);
    return fetched;
  }
  // Fetch failed. If we have a stale cached entry, return it rather than null.
  return cached ?? null;
}

/** Concurrent reputation lookup for N companies with cap=5. Dedupes by
 * normalized key BEFORE fan-out so two workers don't race on the same company
 * (e.g. "BVNK Ltd" and "bvnk" both normalize to "bvnk" and would otherwise
 * each fire a live fetch). */
export async function getReputationBatch(
  companies: string[],
  cache: Map<string, Reputation>,
  newEntries: Map<string, Reputation>,
  concurrency = 5,
): Promise<Map<string, Reputation>> {
  const results = new Map<string, Reputation>();
  // Normalize-and-dedupe: keep the first raw form we saw for each key so the
  // display name on newly-fetched rows is the human-readable one, not the
  // lower-cased key.
  const keyed = new Map<string, string>();
  for (const raw of companies) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = reputationKey(trimmed);
    if (!key) continue;
    if (!keyed.has(key)) keyed.set(key, trimmed);
  }
  const unique = [...keyed.values()];
  let cursor = 0;
  async function worker() {
    while (cursor < unique.length) {
      const i = cursor++;
      const company = unique[i];
      const rep = await getReputation(company, cache, newEntries);
      if (rep) results.set(reputationKey(company), rep);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, worker));
  return results;
}

// ────────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────────

/**
 * Two-step reputation fetch: SEARCH to find the canonical URL, then try to
 * parse the rating from (a) the Google snippet, or (b) the scraped page
 * content if the snippet is silent on the rating. Glassdoor in particular
 * often shows "1K Reviews" text in the snippet but the actual numeric rating
 * only lives on the page itself.
 */
async function searchAndScrape(
  apiKey: string,
  query: string,
  urlFilter: RegExp,
): Promise<{ rating: number; reviews: number; url?: string } | undefined> {
  if (!tryReserveFirecrawl(`rep-search:${query.slice(0, 40)}`)) return undefined;
  const resp = await fetch(FIRECRAWL_SEARCH, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit: 6 }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    if (body.includes("Insufficient credits") || resp.status === 402) return undefined;
    throw new Error(`search ${resp.status}: ${body.slice(0, 160)}`);
  }
  const body = (await resp.json()) as { success?: boolean; data?: SearchHit[] };
  const hits = (body.data ?? []).filter((h) => urlFilter.test(h.url ?? ""));
  if (hits.length === 0) return undefined;

  // First pass — parse from search snippet. Cheap (no extra credit), works
  // when Google's rich result exposes the rating inline.
  for (const hit of hits) {
    const blob = `${hit.title ?? ""} ${hit.description ?? ""}`;
    const parsed = parseRating(blob);
    if (parsed) return { ...parsed, url: hit.url };
  }

  // Second pass — scrape the canonical page for sources where the snippet
  // rarely carries the rating (Glassdoor, Indeed cmp pages). Only scrape the
  // FIRST matching URL to control credit spend; if that misses, move on.
  const canonicalUrl = hits[0].url;
  if (!canonicalUrl) return undefined;
  const scraped = await scrapeMarkdown(apiKey, canonicalUrl);
  if (!scraped) return undefined;
  // Parse the full markdown — first rating match in delimited form (e.g.
  // "3.5★", "3.3 out of 5") is reliably the overall rating on Glassdoor /
  // Indeed / Trustpilot employer pages. Sub-ratings (Culture, Comp) appear
  // later in the DOM and only as the 2nd/3rd matches.
  const parsed = parseRating(scraped);
  if (parsed) return { ...parsed, url: canonicalUrl };
  return undefined;
}

async function scrapeMarkdown(apiKey: string, url: string): Promise<string | undefined> {
  if (!tryReserveFirecrawl(`rep-scrape:${url.slice(0, 40)}`)) return undefined;
  try {
    const resp = await fetch(FIRECRAWL_SCRAPE, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      if (body.includes("Insufficient credits") || resp.status === 402) return undefined;
      console.warn(`[reputation] scrape ${resp.status} for ${url}: ${body.slice(0, 120)}`);
      return undefined;
    }
    const body = (await resp.json()) as { data?: { markdown?: string }; markdown?: string };
    return body.data?.markdown ?? body.markdown ?? undefined;
  } catch (err) {
    console.warn(`[reputation] scrape threw for ${url}:`, err instanceof Error ? err.message : err);
    return undefined;
  }
}

/**
 * Regex-extract a rating + review count from a Google-style rich snippet.
 * Supported patterns:
 *   "3.9 · 1,234 reviews"
 *   "Rating: 3.9 · 1,234 reviews"
 *   "3.9 out of 5 stars · 1,234 reviews"
 *   "4.1★ (2,300 reviews)"
 */
function parseRating(text: string): { rating: number; reviews: number } | undefined {
  // Two-pass: try delimited forms first (highest precision), then loose form
  // only when a review count is near the number (keeps false-positive rate low).
  const delimited = text.match(/\b([0-5]\.\d)\s*(?:\/\s*5|out of 5|stars?|★|·|\()/i);
  let rating: number | undefined;
  if (delimited) rating = Number(delimited[1]);
  if (rating === undefined) {
    // Loose form — accept "Rating: 3.9" or "3.9 (1,234 reviews)" style where
    // the number sits adjacent to a review-count phrase within 30 chars.
    const loose = text.match(/(?:rating[:\s]+)?([0-5]\.\d)(?=[^\d]{0,30}\d[\d,]*\s*reviews?)/i);
    if (loose) rating = Number(loose[1]);
  }
  if (rating === undefined || !Number.isFinite(rating) || rating < 1.0 || rating > 5) return undefined;
  const reviewMatch = text.match(/([\d,]+)\s*reviews?/i);
  const reviews = reviewMatch ? Number(reviewMatch[1].replace(/,/g, "")) : 0;
  return { rating, reviews };
}

function buildSummary(rep: Reputation): string {
  const parts: string[] = [];
  if (rep.glassdoor) parts.push(`Glassdoor ${rep.glassdoor.rating.toFixed(1)}★ (${formatK(rep.glassdoor.reviews)})`);
  if (rep.indeed) parts.push(`Indeed ${rep.indeed.rating.toFixed(1)}★ (${formatK(rep.indeed.reviews)})`);
  if (rep.other) parts.push(`${rep.other.source} ${rep.other.rating.toFixed(1)}★ (${formatK(rep.other.reviews)})`);
  return parts.join(" · ");
}

function formatK(n: number): string {
  if (!n) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}
