// jooble-ie.ts — Jooble API scoped to Ireland. Ireland is a bigger market than
// Malta, so Jooble's coverage is notably richer here (hundreds vs ~90).
import type { Job } from "../types.js";

export async function scrapeJoobleIe(): Promise<Partial<Job>[]> {
  const apiKey = process.env.Jooble_API_Key;
  if (!apiKey) throw new Error("Jooble_API_Key is not set");
  const resp = await fetch(`https://jooble.org/api/${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keywords: "", location: "Ireland", page: "1" }),
  });
  if (!resp.ok) throw new Error(`Jooble IE failed (${resp.status})`);
  const data = (await resp.json()) as { jobs?: Array<Record<string, unknown>> };
  const hits = data.jobs ?? [];

  const jobs: Partial<Job>[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    const sourceId = String(h.id ?? "");
    if (!sourceId || seen.has(sourceId)) continue;
    seen.add(sourceId);
    const title = stripEntities(String(h.title ?? "")).trim();
    const snippet = stripEntities(String(h.snippet ?? ""));
    jobs.push({
      source: "jooble-ie",
      sourceId,
      url: String(h.link ?? ""),
      title,
      titleRaw: String(h.title ?? ""),
      company: String(h.company ?? "").trim(),
      companyRaw: String(h.company ?? ""),
      location: String(h.location ?? "Ireland"),
      locality: null,
      workMode: /remote/i.test(snippet) ? "remote" : /hybrid/i.test(snippet) ? "hybrid" : "unclear",
      partTime: /part[-\s]?time/i.test(`${title} ${snippet}`) ? "yes" : "unknown",
      descriptionMd: snippet,
      estSalary: String(h.salary ?? "").trim() || null,
      contact: null,
      postedAt: String(h.updated ?? "") || null,
    });
  }
  return jobs;
}

function stripEntities(s: string): string {
  return s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\.\.\./g, " ").trim();
}
