// Firecrawl team credit usage.
// Auth: Bearer FIRECRAWL_API_KEY (same key as scraping).

import type { ProviderUsage } from "./types.js";
import { emptyUsage } from "./types.js";

interface CreditUsage {
  success: boolean;
  data: {
    remainingCredits: number;
    planCredits: number | null;
    billingPeriodStart: string | null;
    billingPeriodEnd: string | null;
  };
}

export async function fetchFirecrawlUsage(): Promise<ProviderUsage> {
  // Accept the legacy name (FireCrawlAPI) too — it's already set on
  // Trigger.dev prod from the job-hunt setup.
  const key = process.env.FIRECRAWL_API_KEY ?? process.env.FireCrawlAPI;
  if (!key) return emptyUsage("firecrawl", "FIRECRAWL_API_KEY not set");

  try {
    const res = await fetch("https://api.firecrawl.dev/v2/team/credit-usage", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return emptyUsage("firecrawl", `HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as CreditUsage;
    if (!json.success) return emptyUsage("firecrawl", "API returned success=false");
    const used =
      json.data.planCredits !== null
        ? json.data.planCredits - json.data.remainingCredits
        : null;
    return {
      provider: "firecrawl",
      used,
      remaining: json.data.remainingCredits,
      unit: "credits",
      periodStart: json.data.billingPeriodStart,
      periodEnd: json.data.billingPeriodEnd,
      estCostUSD: null, // plan-priced; absolute cost is fixed monthly
      error: null,
    };
  } catch (err) {
    return emptyUsage("firecrawl", err instanceof Error ? err.message : String(err));
  }
}
