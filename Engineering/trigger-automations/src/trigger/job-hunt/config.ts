// config.ts — tunable knobs for the job-hunt pipeline.
// Edit keyword lists + score weights here during week-1 tuning; no other file changes needed.

import type { Source } from "./types.js";

// ────────────────────────────────────────────────────────────────────
// Keywords — drive both filter gate and score weights
// ────────────────────────────────────────────────────────────────────

/** Core analytical role keywords (title match → immediate pass). */
export const CORE_KEYWORDS = [
  "data analyst",
  "business analyst",
  "analytics",
  "analyst",
  "data scientist",
  "bi analyst",
  "business intelligence",
  "reporting analyst",
  "insights analyst",
  "operations analyst",
  "financial analyst",
  "marketing analyst",
  "research analyst",
  "product analyst",
  "customer insights",
  "fraud analyst",
  "risk analyst",
  "compliance analyst",
  "kyc analyst",
  "aml analyst",
  "crm analyst",
] as const;

/** Analytical tools — boost in description match. */
export const TOOL_KEYWORDS = [
  "sql",
  "tableau",
  "power bi",
  "powerbi",
  "looker",
  "excel",
  "python",
  "r studio",
  "google analytics",
  "ga4",
  "mixpanel",
  "amplitude",
  "dbt",
  "snowflake",
  "bigquery",
  "redshift",
  "jira",
  "pandas",
] as const;

/** Domain keywords (iGaming/fintech focus in Malta). */
export const DOMAIN_KEYWORDS = [
  "igaming",
  "i-gaming",
  "gambling",
  "casino",
  "sportsbook",
  "betting",
  "fintech",
  "payments",
  "insurance",
  "banking",
  "crypto",
  "blockchain",
  "aviation",
  "aircraft leasing",
  "hospitality",
  "ecommerce",
  "e-commerce",
] as const;

/** Hard exclude — anything matching these is rejected regardless of other hits. */
export const EXCLUDE_KEYWORDS = [
  "senior",
  "sr.",
  "lead ",
  "head of",
  "director",
  "principal",
  "manager",
  "vp ",
  "chief",
  "internship",
  "intern ",
  " intern",
  "trainee",
  "apprentice",
  "sales executive",
  "bdr",
  "sdr",
  "account executive",
  "teacher",
  "nurse",
  "chef",
  "waiter",
  "cleaner",
  "construction",
] as const;

/** Part-time signals in title/description. */
export const PART_TIME_KEYWORDS = [
  "part-time",
  "part time",
  "parttime",
  "part-timer",
  "flexible hours",
  "flexible schedule",
  "reduced hours",
  "20 hours",
  "25 hours",
  "30 hours",
] as const;

/** Full-time signals (to mark partTime=no). */
export const FULL_TIME_KEYWORDS = [
  "full-time",
  "full time",
  "40 hours",
  "fulltime",
] as const;

// ────────────────────────────────────────────────────────────────────
// Malta geography
// ────────────────────────────────────────────────────────────────────

/** Malta + Gozo localities — used for the hard Malta-gate. */
export const MALTA_LOCALITIES = [
  // Northern (closer to Mellieħa — drive ≤30min)
  "mellieha", "mellieħa", "st paul's bay", "st pauls bay", "san pawl il-bahar",
  "bugibba", "qawra", "xemxija", "mgarr", "mġarr",
  // Central
  "mosta", "naxxar", "gharghur", "għargħur", "birkirkara", "attard",
  "balzan", "lija", "iklin", "santa venera", "hamrun", "ħamrun",
  "msida", "pieta", "pietà", "gzira", "gżira", "sliema", "st julian's", "st julians",
  "paceville", "swieqi", "pembroke", "ta xbiex", "ta' xbiex",
  // Valletta area
  "valletta", "floriana", "marsa",
  // Southern
  "qormi", "zebbug", "żebbuġ", "siggiewi", "siġġiewi", "dingli", "rabat",
  "mdina", "mtarfa", "luqa", "gudja", "kirkop", "safi",
  "tarxien", "paola", "fgura", "zejtun", "żejtun", "marsaxlokk",
  "marsaskala", "birzebbuga", "birżebbuġa", "zabbar", "żabbar",
  "cottonera", "birgu", "senglea", "cospicua", "isla", "bormla",
  // Gozo
  "victoria", "rabat gozo", "xaghra", "xagħra", "nadur", "xewkija",
  "mgarr gozo", "mġarr gozo", "gharb", "għarb", "san lawrenz",
  "sannat", "fontana", "kercem", "qala", "zebbug gozo", "munxar",
] as const;

/** Drive-30-min-from-Mellieħa localities — score boost. */
export const DRIVE_30MIN = new Set([
  "mellieha", "mellieħa",
  "st paul's bay", "st pauls bay", "san pawl il-bahar",
  "bugibba", "qawra", "xemxija", "mgarr", "mġarr",
  "mosta", "naxxar", "gharghur", "għargħur",
  "attard", "rabat", "mdina",
]);

// ────────────────────────────────────────────────────────────────────
// Scoring weights
// ────────────────────────────────────────────────────────────────────

export const SCORE_WEIGHTS = {
  titleCore: 30,           // title has CORE keyword
  descCore: 20,            // desc has CORE keyword
  tool: 8,                 // per tool keyword in desc (cap 3)
  // Industry neutrality: user explicitly wants no sector preference. The old
  // iGaming bonus is removed so the fallback keyword scorer (used only when
  // LLM ranking fails) doesn't skew toward iGaming roles.
  domainIGaming: 10,
  domainOther: 10,
  workModeHybrid: 15,
  workModeRemote: 10,
  workModeOnsite: 0,
  partTimeConfirmed: 20,   // partTime === "yes"
  partTimeUnknown: 0,      // neutral
  drive30min: 10,
  inMalta: 5,
  recentPost: 5,           // postedAt within 7 days
  employerDirect: 5,       // source priority bonus
} as const;

// ────────────────────────────────────────────────────────────────────
// Source priority — higher wins when same job appears in multiple sources
// ────────────────────────────────────────────────────────────────────

export const SOURCE_PRIORITY: Record<Source, number> = {
  castille: 100,        // specialist iGaming recruiter, direct relationships
  konnekt: 90,          // major Malta recruiter
  maltajobsboard: 85,   // Malta-specific board, compliance/fintech analysts
  keepmeposted: 80,     // Malta-specific
  archer: 75,           // IT specialist recruiter, hybrid/Malta-focused
  jobsplus: 70,         // gov portal — authoritative
  mfsa: 95,             // Malta Financial Services Authority — direct employer, gov
  "greenhouse-malta": 80, // Greenhouse ATS hosts Betsson, BVNK, Revolut etc Malta roles
  linkedin: 60,
  jooble: 50,           // aggregator of ATS platforms
  "indeed-mt": 40,
  careerjet: 30,        // aggregator of aggregators
  // Global track
  irishjobs: 85,
  "linkedin-ie": 70,
  "indeed-ie": 65,
  "linkedin-remote": 60,
  "jooble-ie": 55,
  remoteok: 50,
};

// ────────────────────────────────────────────────────────────────────
// Source toggles — quick disable when one is broken
// ────────────────────────────────────────────────────────────────────

// v2 routing — all active sources go through Firecrawl `/v1/search` via Google
// index to bypass JS SPAs, CAPTCHAs, and LinkedIn's anti-scraping. One search
// call per source per run.
export const SOURCE_ENABLED: Record<Source, boolean> = {
  linkedin: true,
  konnekt: true,
  keepmeposted: true,
  maltajobsboard: true,  // Malta-specific board, AML/KYC/compliance analyst rich
  archer: true,          // IT recruiter, BI/data analyst hybrid roles
  castille: true,        // via sitemap.xml on castilleresources.com → castillians.com — free, 1000+ job URLs
  jooble: true,          // API aggregator — ATS platforms (Manatal, Swooped) not in our other sources
  mfsa: true,            // MFSA gov regulator — direct employer
  "greenhouse-malta": true, // Greenhouse ATS — Betsson, BVNK, iGaming employers
  jobsplus: false,       // JS SPA — Google indexes only docs/PDFs/chatbot UI, sitemap has no vacancies
  "indeed-mt": false,    // mt.indeed.com DNS doesn't exist; www.indeed.com has noindex
  careerjet: false,      // Google has only category list pages; robots.txt disallows /search/rss.html
  // Global track
  "linkedin-ie": true,
  irishjobs: true,
  "indeed-ie": true,
  remoteok: true,
  "jooble-ie": true,
  "linkedin-remote": true,
};

// ────────────────────────────────────────────────────────────────────
// Pipeline limits
// ────────────────────────────────────────────────────────────────────

export const LIMITS = {
  digestCap: 20,             // max jobs in one email; overflow rolls next day
  fuzzyDedupWindow: 30,      // days of sheet history to fuzzy-match against
  fuzzyThreshold: 0.92,      // Levenshtein ratio ≥ this → treat as duplicate
  sourceDryStreakDays: 5,    // alert if a source returns 0 for N consecutive days
  maxDescLength: 800,        // truncate desc when storing
};
