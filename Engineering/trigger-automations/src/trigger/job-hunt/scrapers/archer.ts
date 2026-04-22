// archer.ts — Archer IT Recruitment (archer.mt) via Firecrawl search.
// Google indexes /job/{slug} posting pages; reconnaissance also returns
// /search/*, /page/*, /business-intelligence-jobs/ etc which are category or
// list pages — we filter those out by requiring the /job/ segment.

import { searchJobs, searchHitToJob } from "./firecrawl-search.js";
import type { Job } from "../types.js";

const QUERY = "site:archer.mt";
const TITLE_SUFFIXES = ["Archer IT Recruitment", "Archer IT Recruitment Specialist Malta", "Archer"];

export async function scrapeArcher(): Promise<Partial<Job>[]> {
  const results = await searchJobs(QUERY, 20);
  const jobs: Partial<Job>[] = [];
  const seen = new Set<string>();

  for (const hit of results) {
    const url = hit.url ?? "";
    // Only individual job postings — reject /search/, /page/, category pages.
    const m = url.match(/archer\.mt\/job\/([^/?#]+)/i);
    if (!m) continue;
    const sourceId = m[1];
    if (seen.has(sourceId)) continue;
    seen.add(sourceId);

    jobs.push(searchHitToJob("archer", hit, sourceId, TITLE_SUFFIXES, "Malta"));
  }
  return jobs;
}
