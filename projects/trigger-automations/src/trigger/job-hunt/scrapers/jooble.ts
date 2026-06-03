// jooble.ts — Jooble API (https://jooble.org/api/about) for Malta.
// Structured JSON, no scraping. Coverage for Malta is thin (~90 total jobs)
// but it surfaces ATS-platform postings (Manatal, Swooped, HireLifeScience)
// that don't appear in our Firecrawl-search-based sources.
//
// One POST per run. Free tier is generous (~500/day), we use 1.

import type { Job } from "../types.js";

const JOOBLE_URL = (key: string) => `https://jooble.org/api/${key}`;

interface JoobleHit {
  id?: string | number;
  title?: string;
  company?: string;
  location?: string;
  link?: string;
  snippet?: string;
  salary?: string;
  source?: string;
  type?: string;
  updated?: string;
}

interface JoobleResponse {
  jobs?: JoobleHit[];
  totalCount?: number;
}

export async function scrapeJooble(): Promise<Partial<Job>[]> {
  const apiKey = process.env.Jooble_API_Key;
  if (!apiKey) throw new Error("Jooble_API_Key is not set");

  const resp = await fetch(JOOBLE_URL(apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Broader keyword set so Jooble doesn't only surface literal "Analyst"
    // titles. Jooble's keyword matcher tokenises on OR by default.
    body: JSON.stringify({ keywords: "", location: "Malta", page: "1" }),
  });
  if (!resp.ok) {
    throw new Error(`Jooble API failed (${resp.status}): ${await resp.text()}`);
  }
  const data = (await resp.json()) as JoobleResponse;
  const hits = data.jobs ?? [];

  const jobs: Partial<Job>[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    const sourceId = String(h.id ?? "");
    if (!sourceId || seen.has(sourceId)) continue;
    seen.add(sourceId);

    const title = cleanTitle(h.title ?? "");
    const partTime = detectPartTimeFromType(h.type ?? "", `${title} ${h.snippet ?? ""}`);
    const snippet = stripEntities(h.snippet ?? "");

    jobs.push({
      source: "jooble",
      sourceId,
      url: h.link ?? "",
      title,
      titleRaw: h.title ?? "",
      company: (h.company ?? "").trim(),
      companyRaw: h.company ?? "",
      location: h.location ?? "Malta",
      locality: null,
      workMode: detectWorkModeFromText(`${title} ${h.snippet ?? ""}`),
      partTime,
      descriptionMd: snippet,
      estSalary: h.salary?.trim() || null,
      contact: null,
      postedAt: h.updated ?? null,
    });
  }
  return jobs;
}

function cleanTitle(t: string): string {
  return stripEntities(t).trim();
}

function stripEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\.\.\./g, " ")
    .trim();
}

function detectPartTimeFromType(typeField: string, text: string): "yes" | "no" | "unknown" {
  const t = (typeField ?? "").toLowerCase();
  if (t.includes("part")) return "yes";
  if (t === "full" || t.includes("full-time") || t.includes("fulltime")) return "no";
  const s = text.toLowerCase();
  if (/\bpart[-\s]?time\b|\bflexible hours\b/.test(s)) return "yes";
  if (/\bfull[-\s]?time\b/.test(s)) return "no";
  return "unknown";
}

function detectWorkModeFromText(text: string): "remote" | "hybrid" | "onsite" | "unclear" {
  const s = text.toLowerCase();
  if (/\bhybrid\b/.test(s)) return "hybrid";
  if (/\bremote\b|\bwork from home\b/.test(s)) return "remote";
  if (/\bon[-\s]?site\b|\boffice[-\s]?based\b/.test(s)) return "onsite";
  return "unclear";
}
