// keepmeposted.ts — Keepmeposted (Malta jobs board) analyst roles via Firecrawl
// search. Direct scraping returns JS-rendered shell only; Google index has the
// real listing pages.
//
// URL pattern varies: /jobs/{id}-{slug}, /jobs/view/{slug}, or just /jobs/{slug}.

import { searchJobs, searchHitToJob } from "./firecrawl-search.js";
import type { Job } from "../types.js";

const QUERY = "site:keepmeposted.com.mt part-time";
const TITLE_SUFFIXES = ["Keepmeposted", "Keep Me Posted"];

export async function scrapeKeepmeposted(): Promise<Partial<Job>[]> {
  const results = await searchJobs(QUERY);
  const jobs: Partial<Job>[] = [];
  const seen = new Set<string>();

  for (const hit of results) {
    const url = hit.url ?? "";
    // Accept any keepmeposted.com.mt/jobs* URL as valid; sourceId = full path
    // minus the host (so /jobs/12345-title and /jobs/view/slug both get a
    // stable ID). Filter out the base /jobs listing page itself.
    if (!/keepmeposted\.com\.mt\/jobs[/?]/.test(url)) continue;
    const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0].split("#")[0];
    if (path === "/jobs" || path === "/jobs/") continue;
    const sourceId = path.replace(/^\/jobs\//, "").replace(/\/$/, "");
    if (!sourceId || seen.has(sourceId)) continue;
    seen.add(sourceId);

    jobs.push(searchHitToJob("keepmeposted", hit, sourceId, TITLE_SUFFIXES, "Malta"));
  }
  return jobs;
}
