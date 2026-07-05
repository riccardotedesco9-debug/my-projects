// Anthropic monthly token usage via the Admin API.
// Requires ANTHROPIC_ADMIN_API_KEY (separate from project keys — generate
// at console.anthropic.com → Settings → Admin Keys).

import type { ProviderUsage } from "./types.js";
import { emptyUsage } from "./types.js";

// Rough per-1M-token rates in USD. Update when Anthropic prices change.
// Cache reads ~10% of input; cache creation 1.25x (5m) or 2x (1h) input.
const RATES: Record<string, { input: number; output: number }> = {
  // Claude Sonnet family
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-sonnet-4-0": { input: 3, output: 15 },
  // Claude Haiku family
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  // Claude Opus family
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  // Claude Fable family (premium tier — 2x Opus)
  "claude-fable-5": { input: 10, output: 50 },
};
const FALLBACK_RATE = { input: 3, output: 15 };

interface MessagesUsageItem {
  model: string | null;
  uncached_input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation: {
    ephemeral_5m_input_tokens: number;
    ephemeral_1h_input_tokens: number;
  };
}

export async function fetchAnthropicUsage(
  monthStartISO: string,
  monthEndISO: string,
): Promise<ProviderUsage> {
  const key = process.env.ANTHROPIC_ADMIN_API_KEY;
  // Silent skip when not set — admin keys are only on Team/Org plans, so
  // personal accounts can't auto-track. Check usage manually at
  // platform.claude.com/settings/usage.
  if (!key) return emptyUsage("anthropic", null);

  const url = new URL("https://api.anthropic.com/v1/organizations/usage_report/messages");
  url.searchParams.set("starting_at", monthStartISO);
  url.searchParams.set("ending_at", monthEndISO);
  url.searchParams.set("bucket_width", "1d");
  url.searchParams.set("limit", "31");
  // Group by model so we can apply per-model rates.
  url.searchParams.append("group_by[]", "model");

  let totalInput = 0;
  let totalOutput = 0;
  let totalUSD = 0;
  let next: string | null = null;

  try {
    do {
      if (next) url.searchParams.set("page", next);
      const res = await fetch(url.toString(), {
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
      });
      if (!res.ok) {
        // 401 = admin keys not enabled on plan. Silent-skip; manual
        // tracking via platform.claude.com/settings/usage.
        if (res.status === 401) return emptyUsage("anthropic", null);
        const body = await res.text().catch(() => "");
        return emptyUsage("anthropic", `HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      const json = (await res.json()) as {
        data: Array<{ results: MessagesUsageItem[] }>;
        has_more: boolean;
        next_page: string | null;
      };
      for (const bucket of json.data) {
        for (const r of bucket.results) {
          const rate = (r.model && RATES[r.model]) || FALLBACK_RATE;
          const cacheCreation =
            r.cache_creation.ephemeral_5m_input_tokens * 1.25 +
            r.cache_creation.ephemeral_1h_input_tokens * 2;
          const cacheRead = r.cache_read_input_tokens * 0.1;
          const inputBilled = r.uncached_input_tokens + cacheCreation + cacheRead;
          const usd =
            (inputBilled / 1_000_000) * rate.input +
            (r.output_tokens / 1_000_000) * rate.output;
          totalInput += r.uncached_input_tokens + r.cache_read_input_tokens;
          totalOutput += r.output_tokens;
          totalUSD += usd;
        }
      }
      next = json.has_more ? json.next_page : null;
    } while (next);

    return {
      provider: "anthropic",
      used: totalInput + totalOutput,
      remaining: null, // pay-as-you-go
      unit: "tokens",
      periodStart: monthStartISO,
      periodEnd: monthEndISO,
      estCostUSD: Math.round(totalUSD * 100) / 100,
      error: null,
    };
  } catch (err) {
    return emptyUsage("anthropic", err instanceof Error ? err.message : String(err));
  }
}
