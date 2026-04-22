// filter.ts — analytical-role + part-time hard gate.
// Rules (all must pass):
//   1. Malta-gate — handled separately in malta-gate.ts upstream
//   2. Part-time — partTime !== "no". "unknown" passes with note.
//   3. Analytical:
//        title.hasAny(CORE) OR
//        (desc.hasAny(CORE ∪ TOOLS ∪ DOMAIN) AND NOT anyField.hasAny(EXCLUDE))
//
// Returns { pass, reasons } so the orchestrator can log why a job was dropped.

import { CORE_KEYWORDS, EXCLUDE_TITLE_PATTERNS } from "../config.js";
import type { Job } from "../types.js";

export interface FilterResult {
  pass: boolean;
  reasons: string[];
}

/**
 * Pre-filter — cheap regex gate BEFORE Claude sees the job.
 *
 * Two rules, both biased toward passing jobs through so Claude can reason:
 *
 * 1. **Title-only exclude** — drop when title clearly indicates a different
 *    track (waiter / cleaner / BDR / trainee / flight-attendant / etc).
 *    Seniority words (senior / lead / manager / director) are NOT here — a
 *    "Logistics Manager" goes to Claude, who decides if the body describes
 *    analytical-ops or people-management.
 *
 * 2. **Analytical signal anywhere** — title OR description must contain at
 *    least one CORE_KEYWORD (analyst, data, compliance, logistics, strategy,
 *    operations, …). Kept very broad so edge cases reach Claude.
 *
 * Explicit full-time ads still auto-reject (cheap cost saver — LLM doesn't
 * need to score these).
 */
export function runFilter(job: Job): FilterResult {
  const reasons: string[] = [];
  const titleLower = job.title.toLowerCase();
  const descLower = job.descriptionMd.toLowerCase();

  // Cheap early reject — explicitly full-time ads are auto-rejected by the
  // profile anyway, no need to pay for the LLM round-trip.
  if (job.partTime === "no") {
    reasons.push("explicitly full-time");
    return { pass: false, reasons };
  }

  // Title-only exclude. Matches word-boundary regex, so "sales analyst" is NOT
  // caught by the broader /sales\s+executive/ pattern.
  for (const pat of EXCLUDE_TITLE_PATTERNS) {
    if (pat.test(job.title)) {
      reasons.push(`title matches non-analytical track: ${pat.source}`);
      return { pass: false, reasons };
    }
  }

  // Analytical signal — title OR description contains any CORE keyword.
  const titleHasCore = CORE_KEYWORDS.some((k) => titleLower.includes(k));
  if (titleHasCore) {
    reasons.push("title has analytical keyword");
    return { pass: true, reasons };
  }
  const descHasCore = CORE_KEYWORDS.some((k) => descLower.includes(k));
  if (descHasCore) {
    reasons.push("description has analytical keyword");
    return { pass: true, reasons };
  }

  reasons.push("no analytical keyword in title or description");
  return { pass: false, reasons };
}
