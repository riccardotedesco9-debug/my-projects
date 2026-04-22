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
import type { Reputation } from "../types.js";

const FIRECRAWL_SEARCH = "https://api.firecrawl.dev/v1/search";
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

  // Glassdoor via Google rich result
  try {
    const gd = await searchAndParse(apiKey, `"${company}" glassdoor reviews rating`, /glassdoor\.com/i);
    if (gd) out.glassdoor = gd;
  } catch (err) {
    console.warn(`[reputation] glassdoor fetch failed for ${company}:`, err instanceof Error ? err.message : err);
  }

  // Indeed as fallback / supplement
  try {
    const id = await searchAndParse(apiKey, `site:indeed.com/cmp "${company}" reviews`, /indeed\.com/i);
    if (id) out.indeed = id;
  } catch (err) {
    console.warn(`[reputation] indeed fetch failed for ${company}:`, err instanceof Error ? err.message : err);
  }

  // Red-flag low ratings
  if (out.glassdoor && out.glassdoor.rating < 3.0) redFlags.push(`Glassdoor ${out.glassdoor.rating.toFixed(1)}★ — below 3.0`);
  if (out.indeed && out.indeed.rating < 3.0) redFlags.push(`Indeed ${out.indeed.rating.toFixed(1)}★ — below 3.0`);
  if (redFlags.length > 0) out.redFlags = redFlags;
  out.summary = buildSummary(out);

  // If we got nothing useful, return null so caller doesn't cache an empty row
  if (!out.glassdoor && !out.indeed) return null;
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

/** Concurrent reputation lookup for N companies with cap=5. */
export async function getReputationBatch(
  companies: string[],
  cache: Map<string, Reputation>,
  newEntries: Map<string, Reputation>,
  concurrency = 5,
): Promise<Map<string, Reputation>> {
  const results = new Map<string, Reputation>();
  const unique = [...new Set(companies.map((c) => c.trim()).filter(Boolean))];
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

async function searchAndParse(
  apiKey: string,
  query: string,
  urlFilter: RegExp,
): Promise<{ rating: number; reviews: number; url?: string } | undefined> {
  const resp = await fetch(FIRECRAWL_SEARCH, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit: 5 }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    // Credit exhaustion / 402 → swallow, orchestrator continues
    if (body.includes("Insufficient credits") || resp.status === 402) return undefined;
    throw new Error(`search ${resp.status}: ${body.slice(0, 160)}`);
  }
  const body = (await resp.json()) as { success?: boolean; data?: SearchHit[] };
  const hits = (body.data ?? []).filter((h) => urlFilter.test(h.url ?? ""));
  for (const hit of hits) {
    const blob = `${hit.title ?? ""} ${hit.description ?? ""}`;
    const parsed = parseRating(blob);
    if (parsed) return { ...parsed, url: hit.url };
  }
  return undefined;
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
  return parts.join(" · ");
}

function formatK(n: number): string {
  if (!n) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}
