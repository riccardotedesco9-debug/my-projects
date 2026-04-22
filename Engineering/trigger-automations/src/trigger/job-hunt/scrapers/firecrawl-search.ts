// firecrawl-search.ts — shared Google-search-via-Firecrawl helper.
// Why: the individual job-site HTML scrapes all hit JS SPAs or bot blocks.
// Google has already crawled + indexed those pages, and Firecrawl's /v1/search
// endpoint surfaces the results with clean title + description + url.
// This bypasses every SPA/CAPTCHA/noindex wall in one call per query.
//
// Each source-specific scraper (linkedin.ts, konnekt.ts, keepmeposted.ts) builds
// a `site:` query and calls searchJobs() below.

import type { Job, Source } from "../types.js";

const FIRECRAWL_SEARCH = "https://api.firecrawl.dev/v1/search";

interface SearchResultItem {
  title?: string;
  url?: string;
  description?: string;
}

/**
 * Run a Firecrawl search. Returns raw results; the caller is responsible for
 * source-specific URL validation + sourceId extraction.
 */
export async function searchJobs(query: string, limit = 20): Promise<SearchResultItem[]> {
  const apiKey = process.env.FireCrawlAPI;
  if (!apiKey) throw new Error("FireCrawlAPI is not set");

  const resp = await fetch(FIRECRAWL_SEARCH, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit }),
  });
  if (!resp.ok) {
    throw new Error(`Firecrawl search failed (${resp.status}): ${await resp.text()}`);
  }
  const body = (await resp.json()) as { success?: boolean; data?: SearchResultItem[]; error?: string };
  if (body.success === false) throw new Error(body.error ?? "Firecrawl search returned success=false");
  return body.data ?? [];
}

/**
 * Strip the site suffix Google/Firecrawl add to page titles, e.g.
 *   "Junior AML Analyst - Temporary Part time position - LinkedIn"
 *   → "Junior AML Analyst - Temporary Part time position"
 */
export function stripTitleSuffix(title: string, suffixes: string[]): string {
  let cleaned = title;
  for (const suffix of suffixes) {
    const pattern = new RegExp(`\\s*[-–|·]\\s*${escapeRegex(suffix)}\\s*$`, "i");
    cleaned = cleaned.replace(pattern, "");
  }
  return cleaned.trim();
}

/**
 * Parse the company / location / salary chips that often appear in Google's
 * description field: "Company Name · Malta · €30,000 · Part-time".
 * Returns whatever it can extract; caller decides what to keep.
 */
export function parseDescription(desc: string | undefined): {
  company: string | null;
  location: string | null;
  snippet: string;
} {
  if (!desc) return { company: null, location: null, snippet: "" };
  const chunks = desc.split(/\s*[·|]\s*/).map((s) => s.trim()).filter(Boolean);
  let company: string | null = null;
  let location: string | null = null;
  // Broader location recognition — Malta + Ireland + remote + common EU hubs.
  const LOC_PATTERN = /\b(malta|gozo|ireland|dublin|cork|galway|limerick|waterford|kilkenny|london|manchester|remote|anywhere|amsterdam|berlin|madrid|lisbon|paris|brussels)\b/i;
  for (const chunk of chunks.slice(0, 4)) {
    if (!location && LOC_PATTERN.test(chunk) && chunk.length < 80) {
      location = chunk;
    } else if (!company && chunk.length < 60 && !/^[€£$]|\d{2,}/.test(chunk)) {
      company = chunk;
    }
  }
  return { company, location, snippet: desc };
}

/**
 * Build a raw Job from a search hit. Caller provides source + sourceId + a
 * track-appropriate default location (e.g. "Malta" for Malta scrapers, "" or
 * a looser default for global scrapers so the geo-gate can work correctly).
 */
export function searchHitToJob(
  source: Source,
  hit: SearchResultItem,
  sourceId: string,
  titleSuffixes: string[],
  defaultLocation: string = "",
): Partial<Job> & { source: Source } {
  const rawTitle = hit.title ?? "";
  const title = stripTitleSuffix(rawTitle, titleSuffixes);
  const { company, location, snippet } = parseDescription(hit.description);

  return {
    source,
    sourceId,
    url: hit.url ?? "",
    title,
    titleRaw: rawTitle,
    company: company ?? "",
    companyRaw: company ?? "",
    location: location ?? defaultLocation,
    locality: null,
    workMode: detectWorkModeFromText(`${title} ${snippet}`),
    partTime: detectPartTimeFromText(`${title} ${snippet}`),
    descriptionMd: snippet,
    estSalary: null,
    contact: null,
    postedAt: null,
  };
}

function detectWorkModeFromText(text: string): "remote" | "hybrid" | "onsite" | "unclear" {
  const s = text.toLowerCase();
  if (/\bhybrid\b/.test(s)) return "hybrid";
  if (/\bremote\b|\bwork from home\b|\bwfh\b|\banywhere\b/.test(s)) return "remote";
  if (/\bon[-\s]?site\b|\boffice[-\s]?based\b/.test(s)) return "onsite";
  return "unclear";
}

function detectPartTimeFromText(text: string): "yes" | "no" | "unknown" {
  const s = text.toLowerCase();
  if (/\bpart[-\s]?time\b|\bflexible hours\b|\b(20|25|30) hours\b/.test(s)) return "yes";
  if (/\bfull[-\s]?time\b|\b40 hours\b/.test(s)) return "no";
  return "unknown";
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
