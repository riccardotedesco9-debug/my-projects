// greenhouse-malta.ts — Greenhouse ATS is used by many iGaming + fintech
// employers (Betsson, BVNK, etc). Google indexes their job detail pages at
// job-boards.greenhouse.io/{company}/jobs/{id}.
import { searchJobs, searchHitToJob } from "./firecrawl-search.js";
import type { Job } from "../types.js";

const QUERY = "site:greenhouse.io malta part-time";
const TITLE_SUFFIXES = ["Greenhouse", "Job Application"];

export async function scrapeGreenhouseMalta(): Promise<Partial<Job>[]> {
  const results = await searchJobs(QUERY);
  const jobs: Partial<Job>[] = [];
  const seen = new Set<string>();
  for (const hit of results) {
    const url = hit.url ?? "";
    // URL pattern: [eu.]greenhouse.io/{company}/jobs/{id}
    const m = url.match(/greenhouse\.io\/([^/]+)\/jobs\/(\d+)/i);
    if (!m) continue;
    const [, company, id] = m;
    const sourceId = `${company}-${id}`;
    if (seen.has(sourceId)) continue;
    seen.add(sourceId);
    const job = searchHitToJob("greenhouse-malta", hit, sourceId, TITLE_SUFFIXES, "Malta");
    // Company often inferable from URL slug — lowercase, capitalise
    if (!job.company) {
      job.company = company.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      job.companyRaw = job.company;
    }
    // Strip "Job Application for" prefix that Google often includes
    if (job.title?.toLowerCase().startsWith("job application for ")) {
      job.title = job.title.slice("job application for ".length).trim();
    }
    // Strip " at {company}" suffix. Company names may contain hyphens so we
    // look for a trailing " - {site}" separator before stripping, not inside.
    job.title = (job.title ?? "")
      .replace(/\s+at\s+[\w .&'-]+?(\s+-\s+|$)/i, "$1")
      .replace(/\s+-\s+(greenhouse|job board|job application).*$/i, "")
      .trim();
    jobs.push(job);
  }
  return jobs;
}
