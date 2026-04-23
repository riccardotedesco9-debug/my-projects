// indeed-ie.ts — Indeed Ireland via Firecrawl Google search. Unlike Indeed MT
// (which doesn't exist as a domain), Indeed IE is real and Google indexes many
// of its view pages.
import { searchJobs, searchHitToJob } from "./firecrawl-search.js";
import type { Job } from "../types.js";

// Bare `site:ie.indeed.com` returns /cmp/ (company), /career/{role}/salaries,
// and /employers/* pages — NOT individual job detail pages. Indeed discourages
// Google indexing of /viewjob pages, but scoping the query to /viewjob still
// finds the indexed ones.
const QUERY = "site:ie.indeed.com/viewjob part-time";
const TITLE_SUFFIXES = ["Indeed", "Indeed.com", "Indeed Ireland"];

export async function scrapeIndeedIe(): Promise<Partial<Job>[]> {
  const results = await searchJobs(QUERY);
  const jobs: Partial<Job>[] = [];
  const seen = new Set<string>();
  for (const hit of results) {
    const m = (hit.url ?? "").match(/[?&]jk=([A-Za-z0-9]+)/);
    if (!m) continue;
    const sourceId = m[1];
    if (seen.has(sourceId)) continue;
    seen.add(sourceId);
    // Default "Ireland" so global-gate accepts these even without a snippet
    // location chip. LLM still evaluates onsite vs remote nuance.
    jobs.push(searchHitToJob("indeed-ie", hit, sourceId, TITLE_SUFFIXES, "Ireland"));
  }
  return jobs;
}
