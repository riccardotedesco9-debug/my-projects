// Cloudflare Workers + D1 monthly usage via the GraphQL Analytics API.
// Auth: Bearer CLOUDFLARE_BILLING_API_TOKEN with Account.Analytics.Read
// scope (separate from the wrangler-scoped CLOUDFLARE_API_TOKEN since
// the wrangler scopes don't include analytics access). Falls back to
// CLOUDFLARE_API_TOKEN if the billing-specific one isn't set.
// CLOUDFLARE_ACCOUNT_ID is the same env var meetsync uses for D1.

import type { ProviderUsage } from "./types.js";
import { emptyUsage } from "./types.js";

const GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";

const QUERY = `
  query AccountUsage($accountTag: String!, $start: String!, $end: String!) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        workersInvocationsAdaptive(
          filter: { date_geq: $start, date_leq: $end }
          limit: 10000
        ) {
          sum {
            requests
          }
        }
      }
    }
  }
`;

interface GraphQLResponse {
  data?: {
    viewer: {
      accounts: Array<{
        workersInvocationsAdaptive: Array<{ sum: { requests: number } }>;
      }>;
    };
  };
  errors?: Array<{ message: string }>;
}

export async function fetchCloudflareUsage(
  monthStartISO: string,
  monthEndISO: string,
): Promise<ProviderUsage> {
  const token = process.env.CLOUDFLARE_BILLING_API_TOKEN ?? process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !accountId) {
    return emptyUsage("cloudflare", "CLOUDFLARE_BILLING_API_TOKEN or CLOUDFLARE_ACCOUNT_ID not set");
  }

  // GraphQL `date_geq` / `date_leq` accept YYYY-MM-DD.
  const start = monthStartISO.slice(0, 10);
  const end = monthEndISO.slice(0, 10);

  try {
    const res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: QUERY,
        variables: { accountTag: accountId, start, end },
      }),
    });
    if (!res.ok) {
      // 401/403 = token missing the right scopes. Silent-skip; manual
      // tracking via dash.cloudflare.com → Workers & Pages → Analytics.
      if (res.status === 401 || res.status === 403) return emptyUsage("cloudflare", null);
      const body = await res.text().catch(() => "");
      return emptyUsage("cloudflare", `HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as GraphQLResponse;
    if (json.errors?.length) {
      const msg = json.errors[0].message;
      // GraphQL returns 200 with an "authorization" error when scopes
      // are missing — silent-skip the same as 401/403.
      if (/not authorized/i.test(msg)) return emptyUsage("cloudflare", null);
      return emptyUsage("cloudflare", `GraphQL: ${msg}`);
    }
    const buckets = json.data?.viewer.accounts[0]?.workersInvocationsAdaptive ?? [];
    const totalRequests = buckets.reduce((acc, b) => acc + (b.sum?.requests ?? 0), 0);

    // Workers Paid plan: 10M requests included, $0.30 per additional million.
    // Free plan: 100k/day. We don't know which plan via this API, so the
    // estimate assumes Paid; user can correct if on Free.
    const FREE_TIER = 10_000_000;
    const PER_MILLION_USD = 0.3;
    const billable = Math.max(0, totalRequests - FREE_TIER);
    const estCostUSD = Math.round((billable / 1_000_000) * PER_MILLION_USD * 100) / 100;

    return {
      provider: "cloudflare",
      used: totalRequests,
      remaining: null,
      unit: "requests",
      periodStart: monthStartISO,
      periodEnd: monthEndISO,
      estCostUSD,
      error: null,
    };
  } catch (err) {
    return emptyUsage("cloudflare", err instanceof Error ? err.message : String(err));
  }
}
