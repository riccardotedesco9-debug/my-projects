// monthly-pulse.ts — Trigger.dev scheduled task. Fires 1st of each month
// at 09:00 Europe/Malta. Fans out to each provider's billing fetcher,
// collects MeetSync + job-hunt app metrics, counts alerts, then appends
// one snapshot row to the AI Spend Tracker Google Sheet.
//
// One-time setup:
//   1. Create a Google Sheet titled "AI Spend Tracker"
//   2. Run `node tools/upgrade-billing-sheet.mjs` to provision the 3 tabs
//      (summary, monthly, alerts) with formatting
//   3. Set BILLING_SHEET_ID env var on Trigger.dev to the sheet's ID
//   4. Set ANTHROPIC_ADMIN_API_KEY on Team-tier Anthropic accounts (silent
//      skip otherwise)
//
// Manual run for testing:
//   mcp__trigger__trigger_task with taskIdentifier: "billing-monthly-pulse"

import { schedules } from "@trigger.dev/sdk";
import { fetchAnthropicUsage } from "../../lib/billing/anthropic.js";
import { fetchElevenLabsUsage } from "../../lib/billing/elevenlabs.js";
import { fetchFirecrawlUsage } from "../../lib/billing/firecrawl.js";
import { fetchCloudflareUsage } from "../../lib/billing/cloudflare.js";
import { fetchTriggerUsage } from "../../lib/billing/trigger.js";
import { fetchMeetsyncAppMetrics } from "../../lib/billing/meetsync-app.js";
import { fetchJobhuntAppMetrics } from "../../lib/billing/jobhunt-app.js";
import { countAlertsInMonth } from "../../lib/billing/alerts-log.js";
import { appendSnapshot } from "../../lib/billing/sheet-writer.js";
import { notifyOwner, formatErrorAlert } from "../../lib/telegram-notify.js";
import type { ProviderUsage } from "../../lib/billing/types.js";

export const billingMonthlyPulse = schedules.task({
  id: "billing-monthly-pulse",
  // 1st of each month, 09:00 Europe/Malta. After job-hunt's Mon 07:00 cron
  // so we never overlap, and at a time when the previous month is closed.
  cron: { pattern: "0 9 1 * *", timezone: "Europe/Malta" },
  maxDuration: 300, // 5 min — providers respond in seconds; pagination is the slow part
  run: async () => {
    // Compute previous-month window (the month that just closed).
    // E.g. firing 2026-06-01 → reports on 2026-05.
    const now = new Date();
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const monthLabel = monthStart.toISOString().slice(0, 7); // YYYY-MM
    const startISO = monthStart.toISOString();
    const endISO = monthEnd.toISOString();

    try {
      // Fan out — one provider's failure shouldn't tank the rest.
      const [anthropic, elevenlabs, trigger, cloudflare, firecrawl, meetsync, jobhunt, alertCount] =
        await Promise.all([
          fetchAnthropicUsage(startISO, endISO),
          fetchElevenLabsUsage(),
          fetchTriggerUsage(startISO, endISO),
          fetchCloudflareUsage(startISO, endISO),
          fetchFirecrawlUsage(),
          fetchMeetsyncAppMetrics(startISO),
          fetchJobhuntAppMetrics(startISO),
          countAlertsInMonth(startISO),
        ]);

      const byProvider: Record<ProviderUsage["provider"], ProviderUsage> = {
        anthropic,
        elevenlabs,
        trigger,
        cloudflare,
        firecrawl,
      };

      await appendSnapshot({
        month: monthLabel,
        byProvider,
        meetsync,
        jobhunt,
        alertCount,
      });

      // Per-provider errors are logged into the sheet's `errors` column,
      // but we also surface them once aggregated so they're visible
      // without opening the sheet.
      const errored = Object.values(byProvider).filter((u) => u.error);
      if (errored.length > 0) {
        void notifyOwner(
          `ℹ️ [billing-pulse/${monthLabel}] appended with ${errored.length} provider errors:\n` +
            errored.map((u) => `• ${u.provider}: ${u.error}`).join("\n"),
        );
      }

      return {
        month: monthLabel,
        providers: byProvider,
        meetsync,
        jobhunt,
        alertCount,
        erroredCount: errored.length,
      };
    } catch (err) {
      void notifyOwner(formatErrorAlert(`billing-pulse/${monthLabel}`, err));
      throw err;
    }
  },
});
