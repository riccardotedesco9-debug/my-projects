// filter.ts — minimal pre-filter before the LLM ranks.
//
// Philosophy: Claude's judgment is the ranker. The pre-filter only drops jobs
// that are cheaply and unambiguously wrong — never guessing about fit. A
// "Logistics Manager" at a supply-chain co might be exactly the kind of
// analytical-ops role Riccardo wants; only Claude can tell. Don't filter on
// title keywords like "analyst" — that would concentrate results on literal
// analyst titles and miss good adjacent roles.
//
// Two rules only:
//   1. Title matches an obvious non-analytical track regex (waiter, chef, BDR,
//      etc). Word-boundary-matched so "sales analyst" isn't hit by "sales".
//   2. Listing is explicitly full-time. Early reject saves an LLM round-trip
//      on jobs the profile would auto-reject anyway.
//
// Everything else passes to Claude, who scores against the profile + writes
// fitScore=0 for any hard violations (language mismatch, salary floor,
// specialised cert, etc). The orchestrator then drops score=0 jobs.

import { EXCLUDE_TITLE_PATTERNS } from "../config.js";
import type { Job } from "../types.js";

export interface FilterResult {
  pass: boolean;
  reasons: string[];
}

export function runFilter(job: Job): FilterResult {
  // Cheap early-reject: profile auto-rejects these anyway; no need to pay
  // for the LLM round-trip.
  if (job.partTime === "no") {
    return { pass: false, reasons: ["explicitly full-time"] };
  }

  // Title-only drop for clearly wrong tracks.
  for (const pat of EXCLUDE_TITLE_PATTERNS) {
    if (pat.test(job.title)) {
      return { pass: false, reasons: [`title matches non-analytical track: ${pat.source}`] };
    }
  }

  // No keyword gate. Claude sees this job and decides fit against the profile.
  return { pass: true, reasons: ["passed — Claude to assess fit"] };
}
