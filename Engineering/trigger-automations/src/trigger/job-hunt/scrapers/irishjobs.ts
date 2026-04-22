// irishjobs.ts — IrishJobs.ie via Firecrawl Google search.
import { searchJobs, searchHitToJob } from "./firecrawl-search.js";
import type { Job } from "../types.js";

const QUERY = "site:irishjobs.ie";
const TITLE_SUFFIXES = ["IrishJobs", "IrishJobs.ie"];

export async function scrapeIrishJobs(): Promise<Partial<Job>[]> {
  const results = await searchJobs(QUERY, 20);
  const jobs: Partial<Job>[] = [];
  const seen = new Set<string>();
  for (const hit of results) {
    const url = hit.url ?? "";
    // IrishJobs URLs: /job/{id}-{slug} or /jobs/{slug}-{id}
    const m = url.match(/irishjobs\.ie\/job[s]?\/(?:[^/?#]*?-)?(\d{5,})/i) ?? url.match(/irishjobs\.ie\/job[s]?\/([^/?#]+)/i);
    if (!m) continue;
    const sourceId = m[1];
    if (seen.has(sourceId)) continue;
    seen.add(sourceId);
    jobs.push(searchHitToJob("irishjobs", hit, sourceId, TITLE_SUFFIXES));
  }
  return jobs;
}
