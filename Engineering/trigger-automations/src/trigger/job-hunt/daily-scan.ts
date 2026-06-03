// daily-scan.ts — Trigger.dev scheduled task. Fires Monday 07:00 Europe/Malta
// (weekly cadence; task ID retained for schedule continuity — the "daily"
// name is historical). IANA timezone handles DST automatically.
//
// Manual testing:
//   npx trigger.dev@latest dev
//   → open dashboard → Test → schedule task "job-hunt-daily-scan" → trigger
//
// Production:
//   npx trigger.dev@latest deploy
//   → the cron registers; runs autonomously Mon 07:00 Malta.

import { schedules } from "@trigger.dev/sdk";
import { runJobHunt } from "./orchestrator.js";

export const jobHuntDailyScan = schedules.task({
  id: "job-hunt-daily-scan",
  // DISABLED 2026-06-03 — user paused the job-hunt email digests. The auto-run
  // cron is commented out so this task no longer fires on a schedule (it can
  // still be triggered manually). To fully stop it in production, also toggle
  // the "job-hunt-daily-scan" schedule off in the Trigger.dev dashboard
  // (Schedules tab) and/or redeploy. Re-enable by uncommenting the cron below.
  // cron: { pattern: "0 7 * * 1", timezone: "Europe/Malta" }, // Weekly Mon 07:00 Europe/Malta
  maxDuration: 900, // 15 minutes — covers 9 Malta sources + LLM ranking + sheet + email
  run: async () => runJobHunt(),
});
