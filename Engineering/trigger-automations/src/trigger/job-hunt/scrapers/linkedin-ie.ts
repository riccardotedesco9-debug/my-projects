// linkedin-ie.ts — LinkedIn Ireland analyst roles via Firecrawl Google search.
// Same pattern as linkedin.ts but scoped to ie.linkedin.com subdomain.
import { searchJobs, searchHitToJob } from "./firecrawl-search.js";
import type { Job } from "../types.js";

const QUERY = "site:ie.linkedin.com/jobs/view analyst";
const TITLE_SUFFIXES = ["LinkedIn", "LinkedIn Ireland"];

export async function scrapeLinkedInIe(): Promise<Partial<Job>[]> {
  const results = await searchJobs(QUERY, 20);
  const jobs: Partial<Job>[] = [];
  const seen = new Set<string>();
  for (const hit of results) {
    const m = (hit.url ?? "").match(/\/jobs\/view\/(?:[^/?#]*-)?(\d{6,})/);
    if (!m) continue;
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    jobs.push(searchHitToJob("linkedin-ie", hit, m[1], TITLE_SUFFIXES));
  }
  return jobs;
}
