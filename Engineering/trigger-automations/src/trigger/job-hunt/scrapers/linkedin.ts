// linkedin.ts — LinkedIn Malta analyst roles via Firecrawl search.
// Direct LinkedIn scraping is explicitly blocked by Firecrawl; Google's index
// of LinkedIn job pages works fine.
//
// Query anatomy:
//   site:linkedin.com/jobs/view  → limits to individual job posting URLs
//   analyst malta part time      → positive match on role + geo + type
//
// One call per run, 20-result cap. LinkedIn URL pattern captures job ID from
// `/jobs/view/{slug-id}-{numeric_id}` or `/jobs/view/{numeric_id}`.

import { searchJobs, searchHitToJob } from "./firecrawl-search.js";
import type { Job } from "../types.js";

// Malta subdomain + `part-time` qualifier — user explicitly wants PT only
// on the Malta track, and "silent-on-schedule = assume FT = reject". Google
// biasing toward part-time-mentioning pages is exactly what we want here.
const QUERY = "site:mt.linkedin.com/jobs/view part-time";
const TITLE_SUFFIXES = ["LinkedIn", "LinkedIn Malta"];

export async function scrapeLinkedIn(): Promise<Partial<Job>[]> {
  const results = await searchJobs(QUERY);
  const jobs: Partial<Job>[] = [];
  const seen = new Set<string>();

  for (const hit of results) {
    const url = hit.url ?? "";
    const m = url.match(/\/jobs\/view\/(?:[^/?#]*-)?(\d{6,})/);
    if (!m) continue;
    const sourceId = m[1];
    if (seen.has(sourceId)) continue;
    seen.add(sourceId);

    jobs.push(searchHitToJob("linkedin", hit, sourceId, TITLE_SUFFIXES, "Malta"));
  }
  return jobs;
}
