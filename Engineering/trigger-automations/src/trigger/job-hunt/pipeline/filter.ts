// filter.ts — minimal pre-filter before the LLM ranks.
//
// Philosophy: Claude's judgment is the ranker. The pre-filter only drops jobs
// that are cheaply and unambiguously wrong — never guessing about fit. A
// "Logistics Manager" at a supply-chain co might be exactly the kind of
// analytical-ops role Riccardo wants; only Claude can tell.
//
// Rules (applies to BOTH Malta + global tracks):
//   1. Title matches an obvious non-analytical track regex (waiter, chef, BDR,
//      etc). Word-boundary-matched so "sales analyst" isn't hit by "sales".
//   2. Schedule: only drop listings *explicitly* full-time. Silent-on-schedule
//      listings (partTime === "unknown") are passed through — Claude reads the
//      full context and either scores them down for hard FT wording or keeps
//      them when the role is genuinely ambiguous. Rejecting "unknown" here
//      zeros out scrapers that have no description to detect PT from (Castille
//      sitemap, MFSA, Greenhouse shells), which was costing real yield.

import { EXCLUDE_TITLE_PATTERNS } from "../config.js";
import type { Job, Track } from "../types.js";

export interface FilterResult {
  pass: boolean;
  reasons: string[];
}

export function runFilter(job: Job, _track: Track = "malta"): FilterResult {
  // Drop only when the listing is explicitly full-time. "unknown" passes —
  // Claude's system prompt already handles FT-only language via fitScore=0
  // hard-constraint auto-reject downstream, so false-FT risk is low.
  if (job.partTime === "no") {
    return { pass: false, reasons: ["explicitly full-time"] };
  }

  // Title-only drop for clearly wrong tracks (applies to both Malta + global).
  for (const pat of EXCLUDE_TITLE_PATTERNS) {
    if (pat.test(job.title)) {
      return { pass: false, reasons: [`title matches non-analytical track: ${pat.source}`] };
    }
  }

  // No keyword gate. Claude sees this job and decides fit against the profile.
  return { pass: true, reasons: ["passed — Claude to assess fit"] };
}
