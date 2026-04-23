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
  // Weekly: Monday 07:00 Europe/Malta. Daily was too much noise for the user
  // while job-hunting in parallel with a full-time role.
  cron: { pattern: "0 7 * * 1", timezone: "Europe/Malta" },
  maxDuration: 900, // 15 minutes — covers 9 Malta sources + LLM ranking + sheet + email
  run: async () => runJobHunt(),
});
