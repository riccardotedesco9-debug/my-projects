// jobsplus.ts — Jobsplus (Malta gov job portal) scraper.
// Authoritative source — anything here has been formally registered with the
// government. Relatively clean HTML, no aggressive anti-bot.

import { scrapeMarkdown, extractLinks, absoluteUrl, rawJob } from "./shared.js";
import type { Job } from "../types.js";

const BASE = "https://vacancies.jobsplus.gov.mt";
const SEARCH = `${BASE}/Vacancies/Index?searchTerm=analyst`;

export async function scrapeJobsplus(): Promise<Partial<Job>[]> {
  const { markdown } = await scrapeMarkdown(SEARCH, { waitFor: 2500 });
  const links = extractLinks(markdown);

  // Jobsplus listing links follow /Vacancies/Details/{id}
  const jobs: Partial<Job>[] = [];
  for (const l of links) {
    const m = l.url.match(/\/Vacancies\/Details\/(\d+)/i);
    if (!m) continue;
    const sourceId = m[1];
    const url = absoluteUrl(l.url, BASE);

    // Title text comes from the link; company/locality are on nearby lines
    // — we grab a short snippet by finding the title line in markdown.
    const snippet = snippetAround(markdown, l.text, 400);
    const company = extractCompany(snippet);
    const locality = extractLocality(snippet);

    jobs.push(
      rawJob("jobsplus", {
        sourceId,
        url,
        title: l.text,
        titleRaw: l.text,
        company: company ?? "",
        companyRaw: company ?? "",
        location: locality ?? "Malta",
        descriptionMd: snippet,
      }),
    );
  }
  return dedupeBySourceId(jobs);
}

function snippetAround(md: string, needle: string, span: number): string {
  const idx = md.indexOf(needle);
  if (idx < 0) return "";
  const start = Math.max(0, idx - 50);
  const end = Math.min(md.length, idx + needle.length + span);
  return md.slice(start, end);
}

function extractCompany(snippet: string): string | null {
  // Jobsplus usually renders company on a line like "Company: XYZ Ltd" or
  // inside a bold span after the title. Be forgiving.
  const m = snippet.match(/(?:Company|Employer)[:\s-]+([A-Z][A-Za-z0-9&.'()\s-]+)/);
  return m ? m[1].trim().replace(/[.,;]$/, "") : null;
}

function extractLocality(snippet: string): string | null {
  const m = snippet.match(/(?:Location|Locality|Region)[:\s-]+([A-Za-z'ġżċħĠŻĊĦ\s-]+)/i);
  return m ? m[1].trim().replace(/[.,;]$/, "") : null;
}

function dedupeBySourceId(jobs: Partial<Job>[]): Partial<Job>[] {
  const seen = new Set<string>();
  const out: Partial<Job>[] = [];
  for (const j of jobs) {
    const k = j.sourceId ?? "";
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(j);
  }
  return out;
}
