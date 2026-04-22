// castille.ts — Castille Resources / Castillians.
// Castille relaunched as castillians.com with a full public sitemap.xml at
// castilleresources.com/sitemap.xml listing ~1000 individual job URLs in the
// form /jobs/{slug}/{numeric_id}. We fetch the sitemap, filter slugs for
// analyst/data/compliance roles, and transform slug → title.
//
// Zero Firecrawl credits — plain fetch of the XML.

import type { Job } from "../types.js";

const SITEMAP_URL = "https://castilleresources.com/sitemap.xml";

// Slug keywords that indicate the job is analytical (cheap pre-filter — the
// pipeline's full filter still applies downstream).
const SLUG_KEYWORDS = [
  "analyst", "analytics", "analy",
  "data", "bi-",
  "compliance", "kyc", "aml",
  "risk", "fraud",
  "reporting", "research",
  "business-intelligence", "business-analyst", "business-development",
  "financial-analyst", "finance-analyst",
];

export async function scrapeCastille(): Promise<Partial<Job>[]> {
  const resp = await fetch(SITEMAP_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (job-hunt bot)" },
  });
  if (!resp.ok) {
    throw new Error(`Castille sitemap fetch failed (${resp.status})`);
  }
  const xml = await resp.text();

  // Match all <loc>…</loc> URLs that are /jobs/{slug}/{numeric_id}
  const urlRegex = /<loc>\s*(https:\/\/castillians\.com\/jobs\/([^/<]+)\/(\d+))\s*<\/loc>/g;
  const jobs: Partial<Job>[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;

  while ((m = urlRegex.exec(xml)) !== null) {
    const [, url, slug, id] = m;
    const slugLower = slug.toLowerCase();
    if (!SLUG_KEYWORDS.some((k) => slugLower.includes(k))) continue;
    if (seen.has(id)) continue;
    seen.add(id);

    const title = slugToTitle(slug);
    jobs.push({
      source: "castille",
      sourceId: id,
      url,
      title,
      titleRaw: title,
      company: "",
      companyRaw: "",
      location: "Malta",
      locality: null,
      workMode: "unclear",
      partTime: "unknown",
      descriptionMd: "",
      estSalary: null,
      contact: null,
      postedAt: null,
    });
  }

  return jobs;
}

/** "bi-support-officer" → "bi support officer", "Business-Development-Manager" → "business development manager". */
function slugToTitle(slug: string): string {
  return decodeURIComponent(slug)
    .replace(/-/g, " ")
    .replace(/_/g, " ")
    .trim()
    .toLowerCase();
}
