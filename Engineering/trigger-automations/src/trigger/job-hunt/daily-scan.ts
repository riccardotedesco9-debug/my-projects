// daily-scan.ts — Trigger.dev scheduled task. Fires at 07:00 Europe/Malta
// every day (handles DST automatically via IANA timezone).
//
// Manual testing:
//   npx trigger.dev@latest dev
//   → open dashboard → Test → schedule task "job-hunt-daily-scan" → trigger
//
// Production:
//   npx trigger.dev@latest deploy
//   → the cron registers; runs autonomously at 07:00 Malta daily

import { schedules } from "@trigger.dev/sdk";
import { runJobHunt } from "./orchestrator.js";

export const jobHuntDailyScan = schedules.task({
  id: "job-hunt-daily-scan",
  // Object syntax accepts IANA timezone — Trigger.dev v4 handles DST for us.
  cron: { pattern: "0 7 * * *", timezone: "Europe/Malta" },
  maxDuration: 900, // 15 minutes — covers 9 Malta sources + LLM ranking + sheet + email
  run: async () => {
    const stats = await runJobHunt();
    return {
      totalRaw: stats.totalRaw,
      afterFilter: stats.afterFilter,
      newJobs: stats.newJobs,
      digestSent: stats.digestSent,
      perSource: stats.perSource,
    };
  },
});
