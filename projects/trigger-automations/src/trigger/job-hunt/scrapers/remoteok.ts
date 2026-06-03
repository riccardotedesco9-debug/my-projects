// remoteok.ts — RemoteOK public API (free, no auth). Returns remote-only jobs
// globally. Good complement for the global/remote track.
//
// API: https://remoteok.com/api?tags=analyst (returns JSON array, first item
// is metadata "legal" stub — skip it).
import type { Job } from "../types.js";

export async function scrapeRemoteok(): Promise<Partial<Job>[]> {
  const resp = await fetch("https://remoteok.com/api?tags=analyst", {
    headers: { "User-Agent": "job-hunt bot (personal, non-commercial)" },
  });
  if (!resp.ok) throw new Error(`RemoteOK API failed (${resp.status})`);
  const arr = (await resp.json()) as Array<Record<string, unknown>>;

  const jobs: Partial<Job>[] = [];
  const seen = new Set<string>();
  for (const item of arr) {
    // First entry is always the legal notice — no `id` field.
    const id = String(item.id ?? "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const position = String(item.position ?? "");
    if (!position) continue;

    jobs.push({
      source: "remoteok",
      sourceId: id,
      url: String(item.url ?? item.apply_url ?? ""),
      title: position,
      titleRaw: position,
      company: String(item.company ?? ""),
      companyRaw: String(item.company ?? ""),
      location: String(item.location ?? "Remote"),
      locality: null,
      workMode: "remote",
      partTime: "unknown",
      descriptionMd: stripHtml(String(item.description ?? "")).slice(0, 800),
      estSalary: item.salary_min && item.salary_max
        ? `$${item.salary_min}-${item.salary_max}`
        : null,
      contact: null,
      postedAt: parseRemoteOkDate(item.date),
    });
  }
  return jobs;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// RemoteOK returns `date` as either a Unix timestamp number or an ISO string
// depending on endpoint version. Without conversion `Date.parse("1717891200")`
// returns NaN → Layer A age check silently no-ops on every RemoteOK job.
function parseRemoteOkDate(d: unknown): string | null {
  if (d == null || d === "") return null;
  const n = typeof d === "number" ? d : Number(d);
  if (Number.isFinite(n) && n > 0) {
    // RemoteOK uses seconds; >year-3000 in seconds means it's already ms.
    const ms = n > 4_000_000_000 ? n : n * 1000;
    return new Date(ms).toISOString();
  }
  const t = Date.parse(String(d));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
