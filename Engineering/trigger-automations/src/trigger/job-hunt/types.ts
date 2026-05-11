// types.ts — shared types for the job-hunt pipeline.
// One Job record flows from scraper → normalize → gate → filter → score → dedup → sheet/digest.

export type Source =
  | "linkedin"
  | "keepmeposted"
  | "konnekt"
  | "castille"
  | "maltajobsboard"
  | "archer"
  | "jooble"
  | "mfsa"
  | "greenhouse-malta"
  | "linkedin-ie"
  | "irishjobs"
  | "indeed-ie"
  | "remoteok"
  | "jooble-ie"
  | "linkedin-remote";

export type Track = "malta" | "global";

export type WorkMode = "remote" | "hybrid" | "onsite" | "unclear";

export type PartTime = "yes" | "no" | "unknown";

export type Confidence = "high" | "medium" | "low";

export type JobStatus = "new" | "applied" | "rejected" | "interview" | "offer" | "archived";

export interface Job {
  // Identity
  sourceId: string;          // source-native ID or slug
  source: Source;
  url: string;

  // Core fields
  title: string;             // normalized
  titleRaw: string;          // as scraped
  company: string;           // normalized (no "Ltd", "plc", etc.)
  companyRaw: string;
  location: string;          // raw location text from source
  locality: string | null;   // resolved Malta town/city, if known
  workMode: WorkMode;
  partTime: PartTime;
  descriptionMd: string;     // markdown — kept short for digest
  estSalary: string | null;
  contact: string | null;    // email / phone / LinkedIn handle extracted from desc
  postedAt: string | null;   // ISO-8601 when source provides it

  // Pipeline metadata
  confidence: Confidence;    // how sure we are this is legit + part-time analytical
  fingerprint: string;       // sha256(normTitle + "|" + normCompany)
  score: number;             // LLM fitScore 0-100 (replaces the old weighted keyword score)

  // LLM-derived fields (populated after llm-rank stages)
  fit?: string;              // one-sentence "why this matches"
  redFlags?: string[];       // concerns to surface in the digest
  tags?: string[];           // short domain/work-type tags for chips
  fitScoreRaw?: number;      // Haiku triage score (before Sonnet rerank, if applied)
  reputation?: Reputation;   // company review data (cached or live-fetched)
  /** True when the orchestrator attempted a reputation lookup for this job's
   * company (regardless of outcome). Lets the digest distinguish "no reviews
   * found" from "we didn't look" — only jobs in the Sonnet top-K get lookups. */
  reputationLookedUp?: boolean;
  /** Sonnet-written 1-2 sentence summary of what the role actually is.
   * Replaces the raw Google snippet in the digest when present. Null for
   * jobs outside Sonnet's top-K (they still show cleanDesc of descriptionMd). */
  roleSummary?: string | null;
  /** Sonnet-written 1-2 sentence summary of what it's like to work there.
   * Displayed alongside the star ratings in the reputation block. Null when
   * the company is unknown AND no reputation data was attached. */
  reputationSummary?: string | null;
}

/** Public review signals for an employer — fetched once per company per 30 days
 * via Firecrawl search, cached in the `company_ratings` sheet tab. */
export interface Reputation {
  company: string;                                                      // normalized key
  glassdoor?: { rating: number; reviews: number; url?: string };
  indeed?: { rating: number; reviews: number; url?: string };
  /** First-hit fallback source (Trustpilot / Google / Comparably) tried only
   * when both Glassdoor and Indeed miss. Catches Malta SMBs that aren't on
   * the big review sites. */
  other?: { source: string; rating: number; reviews: number; url?: string };
  summary?: string;                                                     // short human-readable line, e.g. "Glassdoor 4.1★ (2.3k)"
  redFlags?: string[];                                                  // e.g. ["Glassdoor rating below 3.0"]
  fetchedAt: string;                                                    // ISO-8601
}

/** Sheet row — 19 columns in canonical order. */
export interface SheetRow {
  date_seen: string;         // ISO date (YYYY-MM-DD)
  sources: string;           // comma-separated source names when deduped across sources
  source_ids: string;        // comma-separated sourceIds matching `sources`
  title: string;
  company: string;
  location: string;
  locality: string;
  work_mode: WorkMode;
  part_time_yn: PartTime;
  est_salary: string;
  contact: string;
  url: string;               // winner URL (highest-priority source)
  all_urls: string;          // comma-separated all source URLs (dedup trail)
  status: JobStatus;
  notes: string;
  digest_sent: string;       // "Y" | "N" — email digest included this row
  fingerprint: string;
  confidence: Confidence;
  score: string;             // stored as string for Sheets
}

export const SHEET_HEADERS: readonly (keyof SheetRow)[] = [
  "date_seen",
  "sources",
  "source_ids",
  "title",
  "company",
  "location",
  "locality",
  "work_mode",
  "part_time_yn",
  "est_salary",
  "contact",
  "url",
  "all_urls",
  "status",
  "notes",
  "digest_sent",
  "fingerprint",
  "confidence",
  "score",
] as const;

/** Run-level stats collected by the orchestrator for logging + heartbeat email. */
export interface RunStats {
  startedAt: string;
  finishedAt: string;
  /** Only populated for sources used by the current track (Malta or global) —
   * not all 19 in the Source union. Use safe access. `metaDropped` and
   * `urlDropped` track per-source losses to Layer A and Layer B freshness
   * checks respectively, so the email footer can surface which scrapers feed
   * the most dead listings. */
  perSource: Partial<Record<Source, {
    fetched: number;
    passed: number;
    error: string | null;
    metaDropped?: number;
    urlDropped?: number;
  }>>;
  totalRaw: number;
  /** totalRaw − jobs dropped by track-appropriate geo gate (passesMaltaGate /
   * passesGlobalGate). Before the gate runs, listings default to the scraper's
   * assumed region, so Malta track's gate rarely drops anything; the global
   * gate is doing real work (rejecting US-only remote, pure-onsite Ireland). */
  afterGeoGate: number;
  afterFilter: number;
  /** passedFilter − metadata-freshness drops (Layer A). */
  afterMetaFreshness: number;
  /** afterMetaFreshness − sheet/intra-run duplicates (6-layer dedup). */
  afterDedup: number;
  /** afterDedup − LLM hard-constraint auto-rejects (fitScore=0). */
  afterAutoReject: number;
  /** afterAutoReject − Layer B URL verification drops (404/closed/redirect). */
  afterUrlVerify: number;
  newJobs: number;
  digestSent: boolean;
  /** Firecrawl /v1/search + /v1/scrape calls made this run. Helps spot cost
   * regressions (scraper spam, uncached reputation storms). Budget ceiling
   * enforced in scrapers/firecrawl-search.ts. */
  firecrawlCalls?: number;
  firecrawlBudget?: number;
  /** Per-job pipeline errors (normalize/filter/score throws) caught silently
   * during the per-job loop. Used to fire a "degraded run" Telegram alert
   * when error rate crosses a threshold (default 10%). */
  pipelineErrors?: number;
}
