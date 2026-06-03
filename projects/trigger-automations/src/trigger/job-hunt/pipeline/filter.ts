// filter.ts — minimal pre-filter before the LLM ranks.
//
// Rules (applies to BOTH Malta + global tracks):
//   1. Schedule must be EXPLICIT part-time. Silent-on-schedule listings are
//      treated as full-time (user rule: "if they don't give any indication of
//      being part-time, filter them out"). Only partTime === "yes" survives.
//      Tradeoff: scrapers with no description (Castille sitemap, MFSA,
//      greenhouse shells) zero out — acceptable because the user prefers a
//      lean part-time-only digest over wasting LLM tokens on probable-FT
//      roles from description-less sources.
//   2. Title matches an obvious non-analytical track regex (waiter, chef, BDR,
//      etc). Word-boundary-matched so "sales analyst" isn't hit by "sales".

import { EXCLUDE_TITLE_PATTERNS } from "../config.js";
import type { Job, Track } from "../types.js";

export interface FilterResult {
  pass: boolean;
  reasons: string[];
}

export function runFilter(job: Job, _track: Track = "malta"): FilterResult {
  // Drop anything that isn't explicitly part-time — across both tracks.
  // Silent schedule → assume FT → reject. The scraper is responsible for
  // populating partTime from whatever signal it has (title, description,
  // chip row); absence of signal here means the listing didn't advertise
  // part-time, and we don't want those in the digest.
  if (job.partTime !== "yes") {
    const reason = job.partTime === "no"
      ? "explicitly full-time"
      : "no part-time indication (silent = FT)";
    return { pass: false, reasons: [reason] };
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
