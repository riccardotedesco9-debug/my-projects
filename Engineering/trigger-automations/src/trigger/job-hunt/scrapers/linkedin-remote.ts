// linkedin-remote.ts — LinkedIn global remote analyst roles via Firecrawl search.
// Google's "site:linkedin.com/jobs/view analyst remote" surfaces the larger
// global remote pool (not geo-scoped to Ireland).
import { searchJobs, searchHitToJob } from "./firecrawl-search.js";
import type { Job } from "../types.js";

// Remote + part-time qualifier — filter drops silent-schedule, so bias Google
// toward PT-mentioning remote roles upfront.
const QUERY = "site:linkedin.com/jobs/view remote part-time";
const TITLE_SUFFIXES = ["LinkedIn"];

export async function scrapeLinkedInRemote(): Promise<Partial<Job>[]> {
  const results = await searchJobs(QUERY);
  const jobs: Partial<Job>[] = [];
  const seen = new Set<string>();
  for (const hit of results) {
    const m = (hit.url ?? "").match(/\/jobs\/view\/(?:[^/?#]*-)?(\d{6,})/);
    if (!m) continue;
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    jobs.push(searchHitToJob("linkedin-remote", hit, m[1], TITLE_SUFFIXES));
  }
  return jobs;
}
