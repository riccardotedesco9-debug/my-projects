// firecrawl-search.ts — shared Google-search-via-Firecrawl helper.
// Why: the individual job-site HTML scrapes all hit JS SPAs or bot blocks.
// Google has already crawled + indexed those pages, and Firecrawl's /v1/search
// endpoint surfaces the results with clean title + description + url.
// This bypasses every SPA/CAPTCHA/noindex wall in one call per query.
//
// Each source-specific scraper (linkedin.ts, konnekt.ts, keepmeposted.ts) builds
// a `site:` query and calls searchJobs() below.
//
// Also exposes a per-run Firecrawl call budget (shared with company-reputation
// via tryReserveFirecrawl()). Prevents a bad cache-miss day from blowing
// through daily credits: the budget resets on module load and is enforced
// against both /v1/search and /v1/scrape callers. Default 300 calls/run;
// override via FIRECRAWL_RUN_BUDGET env var.

import type { Job, Source } from "../types.js";

const FIRECRAWL_SEARCH = "https://api.firecrawl.dev/v1/search";

// ────────────────────────────────────────────────────────────────────
// Run-scoped Firecrawl budget (shared with company-reputation.ts)
// ────────────────────────────────────────────────────────────────────

let firecrawlCallsMade = 0;
let firecrawlBudgetExhaustedLogged = false;

function getBudget(): number {
  const raw = process.env.FIRECRAWL_RUN_BUDGET;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 300;
}

/**
 * Try to reserve one Firecrawl call against the per-run budget. Returns true
 * if the caller may proceed, false if the budget is exhausted (caller should
 * return an empty result). Increments the counter on success.
 *
 * `label` is logged once at exhaustion so we can see which caller tripped it.
 */
export function tryReserveFirecrawl(label: string): boolean {
  const budget = getBudget();
  if (firecrawlCallsMade >= budget) {
    if (!firecrawlBudgetExhaustedLogged) {
      console.warn(
        `[firecrawl-budget] exhausted at ${firecrawlCallsMade}/${budget} (first blocked caller: ${label}).` +
        ` Remaining calls in this run will be skipped. Raise FIRECRAWL_RUN_BUDGET to lift.`,
      );
      firecrawlBudgetExhaustedLogged = true;
    }
    return false;
  }
  firecrawlCallsMade++;
  return true;
}

/** Current call count + configured budget — used by orchestrator to include in stats. */
export function getFirecrawlUsage(): { calls: number; budget: number } {
  return { calls: firecrawlCallsMade, budget: getBudget() };
}

/** Reset counter — only exported for tests. Production uses the module-load default. */
export function resetFirecrawlBudget(): void {
  firecrawlCallsMade = 0;
  firecrawlBudgetExhaustedLogged = false;
}

interface SearchResultItem {
  title?: string;
  url?: string;
  description?: string;
}

/**
 * Run a Firecrawl search. Returns raw results; the caller is responsible for
 * source-specific URL validation + sourceId extraction.
 *
 * Default limit raised 20 → 50 to widen coverage. Google still only returns
 * what it has indexed, so smaller sites (mfsa, archer) return their full set;
 * only large sites (linkedin) actually fill 50. Keeping queries geo+type only
 * (no role keywords) so Claude reasons on the full set.
 */
export async function searchJobs(query: string, limit = 50): Promise<SearchResultItem[]> {
  const apiKey = process.env.FireCrawlAPI;
  if (!apiKey) throw new Error("FireCrawlAPI is not set");
  if (!tryReserveFirecrawl(`search:${query.slice(0, 40)}`)) return [];

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
/** Words that strongly suggest a chunk is a JOB TITLE, not a company name.
 * Used by parseDescription to reject title-looking chunks that otherwise slip
 * into the company field (e.g. "Email Marketing Specialist" as company). This
 * was poisoning reputation lookups because we'd search Glassdoor for the title
 * instead of the real employer. Leading-word patterns (e.g. "Senior ...") are
 * kept out of here since some real companies do contain those tokens. */
const TITLE_WORDS = /\b(analyst|analytics|engineer|engineering|developer|manager|officer|specialist|coordinator|administrator|executive|assistant|representative|consultant|technician|accountant|bookkeeper|architect|controller|clerk|associate|director|principal|designer|copywriter|journalist|translator|auditor|investigator|secretary|planner|strategist|cashier|receptionist|operator|supervisor|tester|intern|trainee|apprentice)\b/i;

/** Heuristic: is this chunk plausibly a company name? Drops long sentences,
 * salary chips, and job-title-looking phrases. Aim: prefer false negatives
 * (missing a legit company) over false positives (garbage company name that
 * pollutes reputation lookups with title-text searches). */
function isPlausibleCompany(chunk: string): boolean {
  const trimmed = chunk.trim();
  if (!trimmed || trimmed.length > 60) return false;
  if (trimmed.split(/\s+/).length > 5) return false;           // >5 words = descriptive, not a name
  if (/^[€£$]|\d{2,}/.test(trimmed)) return false;             // salary / money
  if (TITLE_WORDS.test(trimmed)) return false;                 // job-title markers
  if (/^(seniority|experience|posted|full|part|flexible|permanent|temporary|contract|remote|hybrid|onsite)\b/i.test(trimmed)) return false;
  // All-lowercase chunks ("prepare and review", "email marketing specialist")
  // are almost never company names — Google snippets preserve casing for
  // proper nouns. Real companies like "BVNK" / "Betsson" / "iGaming Corp"
  // always have at least one uppercase letter.
  if (trimmed === trimmed.toLowerCase()) return false;
  // Common sentence-starter words — if chunk begins with these, it's a
  // description fragment Google lifted mid-sentence, not a company name.
  if (/^(we|you|the|our|looking|join|apply|ideal|responsible|description|overview|summary|about|key|day|in this|to be)\b/i.test(trimmed)) return false;
  return true;
}

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
  // Widen scan from 4 → 6 chunks so we can skip past title-in-chunk-1 and
  // still find company in chunk 2/3. Google snippets sometimes arrange as
  // "Title · Company · Location · Type" and sometimes "Company · Title · Location".
  for (const chunk of chunks.slice(0, 6)) {
    if (!location && LOC_PATTERN.test(chunk) && chunk.length < 80) {
      location = chunk;
    } else if (!company && isPlausibleCompany(chunk)) {
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
  // PT indicators — anything in the visible text that strongly implies
  // part-time/reduced schedule. Captures more than just the literal phrase:
  // hour counts (15-36), "flexi*", reduced hours, fractional schedules,
  // evening/weekend-only, temporary part-time combinations, etc.
  const PT_PATTERNS = [
    /\bpart[-\s]?time\b/,                                                 // "part-time", "part time", "parttime"
    /\bflexi(?:ble|[-\s]?time|time)?\b/,                                  // flexi, flexible, flexi-time, flexitime
    /\b(?:15|16|18|20|22|24|25|28|30|32|35)\s*(?:hours?|h|hrs?)\b/,       // hour counts (below typical 40 FT)
    /\b(?:15|16|18|20|22|24|25|28|30|32|35)\s*h\s*(?:\/|per|a)\s*(?:week|wk)\b/,
    /\breduc(?:ed|ing)\s+(?:hours?|schedule|week|week hours)\b/,
    /\bhalf[-\s]?time\b|\b50\s*%\s*(?:role|position|schedule|ftf|fte)\b/,
    /\b(?:two|three|four|2|3|4)\s+days?\s+(?:a|per)\s+week\b/,            // "3 days a week"
    /\b(?:weekends?|evenings?|mornings?|afternoons?)\s+only\b/,           // schedule-restricted
    /\b(?:after[-\s]?school|school[-\s]?hours)\b/,
    /\btemporary\s+part[-\s]?time\b/,                                     // explicit combo
    /\b(?:fixed[-\s]?term|temporary)\s+(?:role|position).+(?:20|25|30)\s*(?:hours?|h)\b/,
  ];
  if (PT_PATTERNS.some((p) => p.test(s))) return "yes";

  // Explicit FT markers
  if (/\bfull[-\s]?time\b/.test(s)) return "no";
  if (/\b40\s*(?:hours?|h|hrs?)\s*(?:\/|per|a)?\s*(?:week|wk)?\b/.test(s)) return "no";
  if (/\b9[-\s]?(?:to[-\s]?)?5\b|\bmon(?:day)?\s*[-\s]\s*fri(?:day)?\b/.test(s)) return "no";

  return "unknown";
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
