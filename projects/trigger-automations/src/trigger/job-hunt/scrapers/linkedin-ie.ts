// linkedin-ie.ts — LinkedIn Ireland analyst roles via Firecrawl Google search.
// Same pattern as linkedin.ts but scoped to ie.linkedin.com subdomain.
import { searchJobs, searchHitToJob } from "./firecrawl-search.js";
import type { Job } from "../types.js";

// Part-time qualifier biases Google toward PT-mentioning Ireland jobs — the
// filter now drops silent-schedule listings so no point scraping them.
const QUERY = "site:ie.linkedin.com/jobs/view part-time";
const TITLE_SUFFIXES = ["LinkedIn", "LinkedIn Ireland"];

export async function scrapeLinkedInIe(): Promise<Partial<Job>[]> {
  const results = await searchJobs(QUERY);
  const jobs: Partial<Job>[] = [];
  const seen = new Set<string>();
  for (const hit of results) {
    const m = (hit.url ?? "").match(/\/jobs\/view\/(?:[^/?#]*-)?(\d{6,})/);
    if (!m) continue;
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    // Default "Ireland" so global-gate sees these as Ireland-based even when
    // Google snippet doesn't have a location chip.
    jobs.push(searchHitToJob("linkedin-ie", hit, m[1], TITLE_SUFFIXES, "Ireland"));
  }
  return jobs;
}
