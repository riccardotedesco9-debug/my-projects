// mfsa.ts — Malta Financial Services Authority career pages.
// Direct employer, not an aggregator. High authority (gov regulator).
import { searchJobs, searchHitToJob } from "./firecrawl-search.js";
import type { Job } from "../types.js";

const QUERY = "site:mfsa.mt/career part-time";
const TITLE_SUFFIXES = ["MFSA", "Malta Financial Services Authority"];

export async function scrapeMfsa(): Promise<Partial<Job>[]> {
  const results = await searchJobs(QUERY);
  const jobs: Partial<Job>[] = [];
  const seen = new Set<string>();
  for (const hit of results) {
    const url = hit.url ?? "";
    // URL pattern: mfsa.mt/career/{slug}
    const m = url.match(/mfsa\.mt\/career\/([^/?#]+)/i);
    if (!m) continue;
    const sourceId = m[1];
    if (seen.has(sourceId)) continue;
    seen.add(sourceId);
    const job = searchHitToJob("mfsa", hit, sourceId, TITLE_SUFFIXES, "Malta");
    // MFSA is always Malta, Valletta-based
    job.location = "Valletta, Malta";
    job.locality = "valletta";
    job.company = "Malta Financial Services Authority";
    job.companyRaw = "Malta Financial Services Authority";
    jobs.push(job);
  }
  return jobs;
}
