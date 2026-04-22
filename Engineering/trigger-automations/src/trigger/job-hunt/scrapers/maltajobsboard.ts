// maltajobsboard.ts — Malta Jobs Board (maltajobsboard.com) via Firecrawl search.
// Google indexes each /job/{slug} posting individually. Reconnaissance showed
// strong AML/KYC/compliance/fintech analyst coverage — often Malta-specific
// roles that don't appear on LinkedIn.

import { searchJobs, searchHitToJob } from "./firecrawl-search.js";
import type { Job } from "../types.js";

const QUERY = "site:maltajobsboard.com";
const TITLE_SUFFIXES = ["Malta Jobs Board"];

export async function scrapeMaltajobsboard(): Promise<Partial<Job>[]> {
  const results = await searchJobs(QUERY, 20);
  const jobs: Partial<Job>[] = [];
  const seen = new Set<string>();

  for (const hit of results) {
    const url = hit.url ?? "";
    const m = url.match(/maltajobsboard\.com\/job\/([^/?#]+)/i);
    if (!m) continue;
    const sourceId = m[1];
    if (seen.has(sourceId)) continue;
    seen.add(sourceId);

    jobs.push(searchHitToJob("maltajobsboard", hit, sourceId, TITLE_SUFFIXES, "Malta"));
  }
  return jobs;
}
