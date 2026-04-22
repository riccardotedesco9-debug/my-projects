// scrapers/shared.ts — Firecrawl wrapper with retry + common helpers.
// Each source module builds a search URL, calls scrapeMarkdown(), then parses
// its own markdown into raw Job[] records. Normalize.ts takes over afterwards.

import FirecrawlApp from "@mendable/firecrawl-js";
import type { Job, Source } from "../types.js";

let client: FirecrawlApp | null = null;

function firecrawl(): FirecrawlApp {
  if (client) return client;
  const apiKey = process.env.FireCrawlAPI;
  if (!apiKey) throw new Error("FireCrawlAPI is not set");
  client = new FirecrawlApp({ apiKey });
  return client;
}

export interface ScrapeResult {
  markdown: string;
  url: string;
}

/**
 * Scrape a URL with Firecrawl, return markdown. Retries once on transient
 * failure. Throws after second failure so Promise.allSettled in the
 * orchestrator can isolate the dead source without killing the whole run.
 */
export async function scrapeMarkdown(url: string, opts: { waitFor?: number } = {}): Promise<ScrapeResult> {
  const fc = firecrawl();
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await fc.scrapeUrl(url, {
        formats: ["markdown"],
        onlyMainContent: true,
        waitFor: opts.waitFor ?? 2000,
      });
      // v1.x SDK: either { success, markdown, ... } OR { success, data: { markdown, ... } }.
      const r = result as {
        success?: boolean;
        error?: string;
        markdown?: string;
        data?: { markdown?: string };
      };
      if (r.success === false) throw new Error(r.error ?? "Firecrawl returned success=false");
      const markdown = r.markdown ?? r.data?.markdown ?? "";
      if (!markdown) throw new Error("Firecrawl returned empty markdown");
      return { markdown, url };
    } catch (err) {
      lastErr = err;
      if (attempt === 1) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(`Firecrawl scrape failed for ${url}: ${msg}`);
}

// ────────────────────────────────────────────────────────────────────
// Parsing helpers — common patterns across sources
// ────────────────────────────────────────────────────────────────────

/** Extract every markdown link `[text](url)` in the body. */
export function extractLinks(md: string): Array<{ text: string; url: string }> {
  const links: Array<{ text: string; url: string }> = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    const text = m[1].trim();
    const url = m[2].trim();
    if (text && url && !url.startsWith("#")) links.push({ text, url });
  }
  return links;
}

/** Build an absolute URL from a possibly-relative href. */
export function absoluteUrl(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

/** Build a minimally-valid raw Job from parsed fields; normalize fills the rest. */
export function rawJob(source: Source, fields: Partial<Job>): Partial<Job> & { source: Source } {
  return {
    source,
    titleRaw: fields.titleRaw ?? fields.title ?? "",
    title: fields.title ?? "",
    companyRaw: fields.companyRaw ?? fields.company ?? "",
    company: fields.company ?? "",
    location: fields.location ?? "",
    locality: fields.locality ?? null,
    workMode: fields.workMode ?? "unclear",
    partTime: fields.partTime ?? "unknown",
    descriptionMd: fields.descriptionMd ?? "",
    estSalary: fields.estSalary ?? null,
    contact: fields.contact ?? null,
    url: fields.url ?? "",
    sourceId: fields.sourceId ?? fields.url ?? "",
    postedAt: fields.postedAt ?? null,
  };
}
