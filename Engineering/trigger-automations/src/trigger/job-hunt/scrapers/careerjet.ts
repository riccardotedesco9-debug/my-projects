// careerjet.ts — RSS-first with HTML fallback. Aggregator-of-aggregators so
// dedup matters more here; we still scrape to fill the top of the funnel.

import { scrapeMarkdown, extractLinks, absoluteUrl, rawJob } from "./shared.js";
import type { Job } from "../types.js";

const BASE = "https://www.careerjet.com.mt";
const RSS_URL = `${BASE}/jobs.rss?s=analyst&l=Malta`;
const HTML_URL = `${BASE}/jobs?s=analyst&l=Malta&p=1`;

export async function scrapeCareerjet(): Promise<Partial<Job>[]> {
  // Try RSS first — it's cheaper and stabler.
  try {
    const rss = await fetchRss(RSS_URL);
    if (rss.length > 0) return rss;
  } catch {
    // fall through to HTML
  }
  return scrapeHtml();
}

async function fetchRss(url: string): Promise<Partial<Job>[]> {
  const resp = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (job-hunt bot)" },
  });
  if (!resp.ok) throw new Error(`RSS fetch failed (${resp.status})`);
  const xml = await resp.text();
  return parseRss(xml);
}

function parseRss(xml: string): Partial<Job>[] {
  const items = xml.split(/<item[\s>]/i).slice(1);
  const jobs: Partial<Job>[] = [];
  for (const item of items) {
    const title = tag(item, "title");
    const link = tag(item, "link");
    const description = tag(item, "description");
    const pubDate = tag(item, "pubDate");
    if (!title || !link) continue;

    // RSS description contains "Company - Location - snippet" in most careerjet feeds.
    const [company, locality] = splitFirstTwo(stripHtml(description ?? ""));
    const sourceId = extractSourceId(link) ?? link;

    jobs.push(
      rawJob("careerjet", {
        sourceId,
        url: link,
        title,
        titleRaw: title,
        company: company ?? "",
        companyRaw: company ?? "",
        location: locality ?? "Malta",
        descriptionMd: stripHtml(description ?? ""),
        postedAt: pubDate ? new Date(pubDate).toISOString() : null,
      }),
    );
  }
  return jobs;
}

async function scrapeHtml(): Promise<Partial<Job>[]> {
  const { markdown } = await scrapeMarkdown(HTML_URL, { waitFor: 2500 });
  const links = extractLinks(markdown);
  const jobs: Partial<Job>[] = [];
  for (const l of links) {
    if (!/\/jobad\//.test(l.url)) continue;
    const url = absoluteUrl(l.url, BASE);
    const sourceId = extractSourceId(url) ?? url;
    const snippet = snippetAround(markdown, l.text, 350);

    jobs.push(
      rawJob("careerjet", {
        sourceId,
        url,
        title: l.text,
        titleRaw: l.text,
        company: "",
        companyRaw: "",
        location: "Malta",
        descriptionMd: snippet,
      }),
    );
  }
  return dedupeBySourceId(jobs);
}

function tag(xml: string, name: string): string | null {
  const re = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i");
  const m = xml.match(re);
  if (!m) return null;
  return m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim();
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").trim();
}

function splitFirstTwo(s: string): [string | null, string | null] {
  const parts = s.split(/\s+-\s+/).map((p) => p.trim()).filter(Boolean);
  return [parts[0] ?? null, parts[1] ?? null];
}

function extractSourceId(url: string): string | null {
  const m = url.match(/\/jobad\/([^/?#]+)/);
  return m ? m[1] : null;
}

function snippetAround(md: string, needle: string, span: number): string {
  const idx = md.indexOf(needle);
  if (idx < 0) return "";
  return md.slice(Math.max(0, idx - 40), Math.min(md.length, idx + needle.length + span));
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
