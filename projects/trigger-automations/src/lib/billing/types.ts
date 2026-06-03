// Standardized shape returned by every provider fetcher in lib/billing/.
// Each field is best-effort: providers don't all expose the same metrics,
// so unknowns are null. The monthly-pulse task flattens these into a sheet
// row and emits a single Telegram alert if anything below threshold.

export interface ProviderUsage {
  /** Stable provider key for sheet column mapping. */
  provider:
    | "anthropic"
    | "elevenlabs"
    | "trigger"
    | "cloudflare"
    | "firecrawl";
  /** Raw consumption counter (tokens, characters, runs, requests, credits). */
  used: number | null;
  /** Remaining counter on plan, if metered. null for pay-as-you-go. */
  remaining: number | null;
  /** Unit of `used`/`remaining` ("tokens" | "characters" | "runs" | "requests" | "credits" | "USD"). */
  unit: string;
  /** ISO-8601 inclusive period start. null if provider doesn't expose. */
  periodStart: string | null;
  /** ISO-8601 exclusive period end (or quota reset date). null if unknown. */
  periodEnd: string | null;
  /** Best-effort USD spend for this period. null if not derivable. */
  estCostUSD: number | null;
  /** Error message if the fetch failed. Caller logs + continues. */
  error: string | null;
}

export function emptyUsage(provider: ProviderUsage["provider"], error: string | null): ProviderUsage {
  return {
    provider,
    used: null,
    remaining: null,
    unit: "",
    periodStart: null,
    periodEnd: null,
    estCostUSD: null,
    error,
  };
}
