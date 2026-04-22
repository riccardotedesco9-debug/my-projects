// normalize.ts — promote a Partial<Job> from a scraper into a full Job record.
// Handles: title/company normalization, fingerprint, locality resolution,
// work mode detection, part-time detection, desc truncation. Score + confidence
// are left zero/low here and filled in by score.ts.

import { createHash } from "node:crypto";
import { MALTA_LOCALITIES, LIMITS } from "../config.js";
import type { Job, WorkMode, PartTime, Source } from "../types.js";

export function normalize(raw: Partial<Job> & { source: Source }): Job {
  const titleRaw = (raw.titleRaw ?? raw.title ?? "").toString();
  const companyRaw = (raw.companyRaw ?? raw.company ?? "").toString();
  const title = normTitle(titleRaw);
  const company = normCompany(companyRaw);

  const location = (raw.location ?? "").toString();
  const locality = raw.locality ?? detectLocality(`${location} ${raw.descriptionMd ?? ""}`);
  const workMode = raw.workMode ?? detectWorkMode(`${title} ${raw.descriptionMd ?? ""} ${location}`);
  const partTime = raw.partTime ?? detectPartTime(`${titleRaw} ${raw.descriptionMd ?? ""}`);

  const descMd = truncate(raw.descriptionMd ?? "", LIMITS.maxDescLength);

  return {
    sourceId: raw.sourceId ?? raw.url ?? "",
    source: raw.source,
    title,
    titleRaw,
    company,
    companyRaw,
    location,
    locality,
    workMode,
    partTime,
    descriptionMd: descMd,
    estSalary: raw.estSalary ?? extractSalary(descMd),
    contact: raw.contact ?? null,                 // filled by contact.ts after filter
    url: raw.url ?? "",
    postedAt: raw.postedAt ?? null,
    confidence: "low",                            // set by score.ts
    fingerprint: fingerprint(title, company),
    score: 0,                                     // set by score.ts
  };
}

// ────────────────────────────────────────────────────────────────────
// String normalization
// ────────────────────────────────────────────────────────────────────

/** lowercase, strip accents, strip qualifiers. Used for fingerprint + matching. */
export function normTitle(s: string): string {
  return stripAccents(s.toLowerCase())
    .replace(/\b(part[-\s]?time|full[-\s]?time|pt|ft|remote|hybrid|on[-\s]?site|onsite|contract|permanent|temp|temporary|freelance)\b/g, " ")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip company suffixes and normalize whitespace. */
export function normCompany(s: string): string {
  return stripAccents(s.toLowerCase())
    .replace(/\b(ltd|limited|plc|p\.?l\.?c\.?|inc|incorporated|llc|llp|s\.?a\.?|s\.?r\.?l\.?|gmbh|bv|ab|ag|co\.?|holdings?|group)\b\.?/g, " ")
    .replace(/[^a-z0-9\s&]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function fingerprint(normalizedTitle: string, normalizedCompany: string): string {
  return createHash("sha256")
    .update(`${normalizedTitle}|${normalizedCompany}`)
    .digest("hex")
    .slice(0, 16); // 64-bit prefix is plenty for collision avoidance at this volume
}

// ────────────────────────────────────────────────────────────────────
// Field detection
// ────────────────────────────────────────────────────────────────────

function detectLocality(text: string): string | null {
  const norm = stripAccents(text.toLowerCase());
  for (const loc of MALTA_LOCALITIES) {
    const pat = stripAccents(loc.toLowerCase());
    const re = new RegExp(`\\b${escapeRegex(pat)}\\b`);
    if (re.test(norm)) return loc;
  }
  return null;
}

function detectWorkMode(text: string): WorkMode {
  const s = text.toLowerCase();
  const hasHybrid = /\bhybrid\b/.test(s);
  const hasRemote = /\b(remote|work from home|wfh)\b/.test(s);
  const hasOnsite = /\b(on[-\s]?site|office[-\s]based|in[-\s]?office)\b/.test(s);
  if (hasHybrid) return "hybrid";
  if (hasRemote && !hasOnsite) return "remote";
  if (hasOnsite) return "onsite";
  return "unclear";
}

function detectPartTime(text: string): PartTime {
  const s = text.toLowerCase();
  if (/\b(part[-\s]?time|flexible hours|20 hours|25 hours|30 hours)\b/.test(s)) return "yes";
  if (/\b(full[-\s]?time|40 hours)\b/.test(s)) return "no";
  return "unknown";
}

function extractSalary(text: string): string | null {
  // Matches: "€30,000 - €35,000", "€15/hour", "€12 per hour", "30k-35k EUR"
  const m =
    text.match(/€\s?\d{1,3}(?:[,.]\d{3})*(?:\s*[-–]\s*€?\s?\d{1,3}(?:[,.]\d{3})*)?(?:\s*(?:per\s+)?(?:hour|hr|year|annum|month|mo))?/i) ??
    text.match(/\d{2,3}k\s*(?:[-–]\s*\d{2,3}k)?\s*eur/i) ??
    text.match(/eur\s*\d{2,3}k(?:\s*[-–]\s*\d{2,3}k)?/i);
  return m ? m[0].trim() : null;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 3) + "...";
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
