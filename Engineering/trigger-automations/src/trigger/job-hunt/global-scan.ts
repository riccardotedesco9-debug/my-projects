// global-scan.ts — Trigger.dev scheduled task for the global/Ireland digest.
// Fires at 07:05 Europe/Malta (5 min after the Malta track) so the two emails
// don't land in the inbox at the exact same second.

import { schedules } from "@trigger.dev/sdk";
import { runJobHunt } from "./orchestrator.js";

export const jobHuntGlobalScan = schedules.task({
  id: "job-hunt-global-scan",
  cron: { pattern: "5 7 * * *", timezone: "Europe/Malta" },
  maxDuration: 900,
  run: async () => runJobHunt({ track: "global" }),
});
