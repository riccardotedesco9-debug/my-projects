// indeed-ie.ts — Indeed Ireland via Firecrawl Google search. Unlike Indeed MT
// (which doesn't exist as a domain), Indeed IE is real and Google indexes many
// of its view pages.
import { searchJobs, searchHitToJob } from "./firecrawl-search.js";
import type { Job } from "../types.js";

const QUERY = "site:ie.indeed.com";
const TITLE_SUFFIXES = ["Indeed", "Indeed.com", "Indeed Ireland"];

export async function scrapeIndeedIe(): Promise<Partial<Job>[]> {
  const results = await searchJobs(QUERY, 20);
  const jobs: Partial<Job>[] = [];
  const seen = new Set<string>();
  for (const hit of results) {
    const m = (hit.url ?? "").match(/[?&]jk=([A-Za-z0-9]+)/);
    if (!m) continue;
    const sourceId = m[1];
    if (seen.has(sourceId)) continue;
    seen.add(sourceId);
    jobs.push(searchHitToJob("indeed-ie", hit, sourceId, TITLE_SUFFIXES));
  }
  return jobs;
}
