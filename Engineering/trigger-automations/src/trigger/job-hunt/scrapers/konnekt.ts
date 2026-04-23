// konnekt.ts — Konnekt (Malta recruiter) analyst roles via Firecrawl search.
// Direct konnekt.com/search scraping returns unfiltered listings because their
// filters apply client-side via JS. Google-indexed pages give us the actual
// filtered job pages instead.
//
// URL pattern: /jobs/{category}/{role-slug}/{numeric-id}

import { searchJobs, searchHitToJob } from "./firecrawl-search.js";
import type { Job } from "../types.js";

// /jobs path forces Google to return individual listing pages. `part-time`
// qualifier biases toward PT-mentioning listings — filter drops silent schedule.
const QUERY = "site:konnekt.com/jobs part-time";
const TITLE_SUFFIXES = ["Konnekt", "Konnekt Jobs", "Konnekt | Malta's best recruitment agency"];

export async function scrapeKonnekt(): Promise<Partial<Job>[]> {
  const results = await searchJobs(QUERY);
  const jobs: Partial<Job>[] = [];
  const seen = new Set<string>();

  for (const hit of results) {
    const url = hit.url ?? "";
    const m = url.match(/\/jobs\/[^/]+\/[^/]+\/(\d+)(?:[/?#]|$)/);
    if (!m) continue;
    const sourceId = m[1];
    if (seen.has(sourceId)) continue;
    seen.add(sourceId);

    jobs.push(searchHitToJob("konnekt", hit, sourceId, TITLE_SUFFIXES, "Malta"));
  }
  return jobs;
}
