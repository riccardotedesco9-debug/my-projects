// config.ts — tunable knobs for the job-hunt pipeline.
// Edit keyword lists + score weights here during week-1 tuning; no other file changes needed.

import type { Source } from "./types.js";

// ────────────────────────────────────────────────────────────────────
// Keywords — drive both filter gate and score weights
// ────────────────────────────────────────────────────────────────────

/** Core analytical/ops/data/compliance keywords — the pre-filter passes a job
 * if ANY of these appear in title OR description. Kept intentionally wide so
 * Claude gets to reason about edge cases (e.g. "Logistics Manager" —
 * `logistics` hits, Claude reads the description and decides if it's the kind
 * of analytical-ops role Riccardo wants). A hit here is "worth considering",
 * not "definitely a fit". */
export const CORE_KEYWORDS = [
  // Generic analyst / analysis
  "analyst", "analytics", "analysis", "analytical",
  // Data / BI
  "data", "bi ", "business intelligence", "dashboard",
  "data scientist", "data engineer", "data specialist", "data officer", "data steward", "data governance",
  "bi developer", "bi engineer", "bi specialist",
  // Reporting / insights / research
  "reporting", "insights", "insight", "research", "researcher",
  // Domains that are intrinsically analytical
  "compliance", "aml", "kyc", "cft", "fraud", "risk", "regulatory",
  "investigator", "investigations", "audit", "auditor", "internal audit",
  "safer gambling", "responsible gaming", "player protection",
  // Ops-analytical
  "operations", "business operations", "operational",
  "process improvement", "process engineer", "process analyst",
  "workflow", "automation", "rpa", "robotic process automation",
  "coordinator", // often analytical-ops
  // Financial / planning
  "financial planning", "fp&a", "treasury", "controller", "reconciliation",
  "forecaster", "forecast", "pricing",
  "accountant", "accounting",
  // Strategy
  "strategy", "strategist", "strategic", "planning",
  // Supply chain / logistics
  "logistics", "supply chain", "procurement", "demand planner", "supply planner",
  "inventory", "warehouse management",
  // Product / Marketing / Customer analytical
  "product", "marketing analyst", "customer insights", "crm analyst", "growth analyst",
  // Stat / quant
  "statistician", "statistics", "quantitative", "quant",
  // Underwriting / actuarial
  "underwriter", "underwriting", "actuary", "actuarial",
  // Generic "consultant" — often analytical work
  "consultant", "consulting",
  // Security-analytical
  "security analyst", "information security",
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

/** Title-only exclude patterns — drop the job BEFORE Claude sees it ONLY when
 * the TITLE clearly indicates a non-analytical track. Matched as word-boundary
 * regex against the title only (not description), so "Sales Analyst" isn't
 * killed by "sales" appearing in a body somewhere.
 *
 * Seniority words (senior/lead/principal/head/manager/director/vp/chief) are
 * DELIBERATELY NOT here — a "Logistics Manager" or "Senior Analyst" role may
 * be exactly what Riccardo wants once Claude reads the full description.
 * Claude handles those nuanced calls, not this filter. */
export const EXCLUDE_TITLE_PATTERNS: readonly RegExp[] = [
  // Hospitality / food
  /\b(waiter|waitress|bartender|host|hostess|barista|barback)\b/i,
  /\b(chef|cook|sous\s?chef|commis|kitchen\s+(assistant|porter|hand|staff))\b/i,
  // Cleaning / housekeeping
  /\b(cleaner|housekeeper|housekeeping|maid|janitor|custodian)\b/i,
  // Transport / drivers
  /\b(driver|chauffeur|truck(er)?|forklift\s+operator|courier|rider|delivery\s+(driver|rider))\b/i,
  // Healthcare (physical)
  /\b(nurse|paramedic|surgeon|dentist|pharmacist|midwife|dental\s+assistant|nursing\s+assistant|care\s+worker)\b/i,
  // Education (physical classroom)
  /\b(teacher|tutor|lecturer|educator|childcare\s+worker)\b/i,
  // Trades
  /\b(bricklayer|carpenter|plumber|electrician|mason|welder|roofer|painter|tiler|scaffolder|labourer|construction\s+worker)\b/i,
  /\bmechanic\b/i,
  // Beauty / wellness
  /\b(hairdresser|barber|beautician|esthetician|massage\s+therapist|nail\s+technician)\b/i,
  // Outdoor / manual
  /\b(gardener|landscaper|groundskeeper|horticulturist|farmhand)\b/i,
  // Security / doors
  /\b(security\s+(guard|officer|staff)|bouncer|doorman)\b/i,
  // Retail / cashier
  /\b(cashier|shop\s+assistant|retail\s+assistant|store\s+associate|sales\s+assistant)\b/i,
  // Pure reception / front-desk
  /\breceptionist\b|\bfront\s+desk\s+agent\b/i,
  // Childcare
  /\b(nanny|babysitter|childminder|au\s+pair)\b/i,
  // Fitness / entertainment
  /\b(personal\s+trainer|fitness\s+(instructor|coach))\b/i,
  /\b(dj\b|musician|performer|entertainer|singer|dancer|model)\b/i,
  // Sales / BD (except ops-analytical sales roles) — narrow exact role markers
  /\b(bdr|sdr)\b/i,
  /\b(business\s+development\s+rep(resentative)?|account\s+executive|sales\s+executive|sales\s+rep(resentative)?|inside\s+sales)\b/i,
  // Intern / trainee / apprentice roles
  /\b(intern|internship|trainee|apprentice)\b/i,
  // Real estate / insurance agent
  /\b(real\s+estate\s+agent|estate\s+agent|realtor|property\s+(agent|consultant|manager))\b/i,
  /\b(insurance\s+agent|insurance\s+broker)\b/i,
  // Pilot / aviation crew (Riccardo was a pilot but is not looking for this)
  /\b(cabin\s+crew|flight\s+attendant|stewardess|steward|pilot\s+officer)\b/i,
  // Translation / copywriting / journalism (different track)
  /\b(translator|interpreter|copywriter|content\s+writer|journalist|editor)\b/i,
  // Photography / design
  /\b(photographer|videographer|graphic\s+designer|ui\s+designer|illustrator)\b/i,
];


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
// Source priority — higher wins when same job appears in multiple sources
// ────────────────────────────────────────────────────────────────────

export const SOURCE_PRIORITY: Record<Source, number> = {
  // Malta
  mfsa: 95,               // Malta Financial Services Authority — direct employer, gov
  castille: 100,          // specialist iGaming recruiter, direct relationships
  konnekt: 90,            // major Malta recruiter
  maltajobsboard: 85,     // Malta-specific board, compliance/fintech analysts
  "greenhouse-malta": 80, // Greenhouse ATS hosts Betsson, BVNK, Revolut etc Malta roles
  keepmeposted: 80,
  archer: 75,
  linkedin: 60,
  jooble: 50,             // aggregator of ATS platforms
  // Global
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
  // Malta
  linkedin: true,
  konnekt: true,
  keepmeposted: true,
  maltajobsboard: true,
  archer: true,
  castille: true,
  jooble: true,
  mfsa: true,
  "greenhouse-malta": true,
  // Global
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
  digestCap: 100,            // max jobs in one email; overflow rolls next day.
                             // Orchestrator bypasses this when sheet is empty
                             // (first run after wipe) so user sees everything.
  fuzzyDedupWindow: 30,      // days of sheet history to fuzzy-match against
  fuzzyThreshold: 0.92,      // Levenshtein ratio ≥ this → treat as duplicate
  sourceDryStreakDays: 5,    // alert if a source returns 0 for N consecutive days
  maxDescLength: 800,        // truncate desc when storing
};
