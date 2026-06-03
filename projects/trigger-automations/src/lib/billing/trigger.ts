// Trigger.dev run count for the past month via the public management API.
// No first-party billing endpoint exists at v4; we count runs and estimate
// cost from the published per-run rate (Hobby: 50k runs/mo included, then
// $0.40/1k; verify against your dashboard plan tier).
//
// Auth: TRIGGER_API_KEY (public-prefixed key from Trigger.dev dashboard,
// usually the same TRIGGER_SECRET_KEY used by the SDK).

import type { ProviderUsage } from "./types.js";
import { emptyUsage } from "./types.js";

interface RunsListResponse {
  data: Array<{ id: string; createdAt: string }>;
  pagination?: { next?: string };
}

const PAGE_LIMIT = 100; // Trigger.dev's max page size for the runs list
const HARD_CAP_PAGES = 200; // 20k runs/month upper bound; bail out cleanly past that

export async function fetchTriggerUsage(
  monthStartISO: string,
  monthEndISO: string,
): Promise<ProviderUsage> {
  const key = process.env.TRIGGER_SECRET_KEY ?? process.env.TRIGGER_API_KEY;
  const apiUrl = process.env.TRIGGER_API_URL ?? "https://api.trigger.dev";
  if (!key) return emptyUsage("trigger", "TRIGGER_SECRET_KEY not set");

  let count = 0;
  let cursor: string | undefined;
  let pages = 0;

  try {
    do {
      const url = new URL("/api/v1/runs", apiUrl);
      url.searchParams.set("filter[from]", monthStartISO);
      url.searchParams.set("filter[to]", monthEndISO);
      url.searchParams.set("page[size]", String(PAGE_LIMIT));
      if (cursor) url.searchParams.set("page[after]", cursor);

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return emptyUsage("trigger", `HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      const json = (await res.json()) as RunsListResponse;
      count += json.data.length;
      cursor = json.pagination?.next;
      pages++;
    } while (cursor && pages < HARD_CAP_PAGES);

    // Hobby plan: 50k runs/mo included, then $0.40 / 1k runs. Adjust if
    // your plan differs; null → user fills manually.
    const FREE_TIER = 50_000;
    const PER_THOUSAND_USD = 0.4;
    const billable = Math.max(0, count - FREE_TIER);
    const estCostUSD = Math.round((billable / 1_000) * PER_THOUSAND_USD * 100) / 100;

    return {
      provider: "trigger",
      used: count,
      remaining: null,
      unit: "runs",
      periodStart: monthStartISO,
      periodEnd: monthEndISO,
      estCostUSD,
      error: pages >= HARD_CAP_PAGES ? "page cap hit — count may be undercounted" : null,
    };
  } catch (err) {
    return emptyUsage("trigger", err instanceof Error ? err.message : String(err));
  }
}
