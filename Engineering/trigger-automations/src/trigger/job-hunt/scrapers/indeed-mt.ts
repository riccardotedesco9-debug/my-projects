// indeed-mt.ts — Indeed Malta with part-time filter (jt=parttime).
// Sponsored entries are filtered out by checking for "Sponsored" markers in
// the snippet; anti-bot may require Firecrawl's waitFor to be generous.

import { scrapeMarkdown, extractLinks, absoluteUrl, rawJob } from "./shared.js";
import type { Job } from "../types.js";

const BASE = "https://mt.indeed.com";
const SEARCH = `${BASE}/jobs?q=analyst&jt=parttime&l=Malta&sort=date`;

export async function scrapeIndeedMt(): Promise<Partial<Job>[]> {
  const { markdown } = await scrapeMarkdown(SEARCH, { waitFor: 4000 });
  const links = extractLinks(markdown);

  const jobs: Partial<Job>[] = [];
  for (const l of links) {
    const m = l.url.match(/\/viewjob\?jk=([A-Za-z0-9]+)/) ?? l.url.match(/\/rc\/clk\?jk=([A-Za-z0-9]+)/);
    if (!m) continue;
    const sourceId = m[1];
    const url = absoluteUrl(`/viewjob?jk=${sourceId}`, BASE);
    const snippet = snippetAround(markdown, l.text, 400);
    if (/\bSponsored\b/i.test(snippet)) continue; // skip sponsored

    const company = extractCompany(snippet, l.text);
    const locality = extractLocality(snippet);

    jobs.push(
      rawJob("indeed-mt", {
        sourceId,
        url,
        title: l.text,
        titleRaw: l.text,
        company: company ?? "",
        companyRaw: company ?? "",
        location: locality ?? "Malta",
        partTime: "yes", // filter guarantees it
        descriptionMd: snippet,
      }),
    );
  }
  return dedupeBySourceId(jobs);
}

function snippetAround(md: string, needle: string, span: number): string {
  const idx = md.indexOf(needle);
  if (idx < 0) return "";
  return md.slice(Math.max(0, idx - 60), Math.min(md.length, idx + needle.length + span));
}

function extractCompany(snippet: string, title: string): string | null {
  const after = snippet.split(title)[1] ?? "";
  const lines = after.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  for (const line of lines.slice(0, 5)) {
    if (/(malta|hybrid|remote|\d+(\.\d+)?\+? (day|week|month) ago|\$|€|eur)/i.test(line)) continue;
    if (line.length > 2 && line.length < 80) return line;
  }
  return null;
}

function extractLocality(snippet: string): string | null {
  // Malta localities show with commas: "Sliema, Malta".
  const m = snippet.match(/([A-Z][a-zA-Z' -]{2,30}),\s*Malta/);
  return m ? m[1].trim() : null;
}

function dedupeBySourceId(jobs: Partial<Job>[]): Partial<Job>[] {
  const seen = new Set<string>();
  return jobs.filter((j) => {
    const k = j.sourceId ?? "";
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
