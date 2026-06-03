// global-scan.ts — Trigger.dev scheduled task for the global/Ireland digest.
// Weekly on Monday 07:05 Europe/Malta (5 min after the Malta track) so the
// two emails don't land in the inbox at the exact same second.

import { schedules } from "@trigger.dev/sdk";
import { runJobHunt } from "./orchestrator.js";

export const jobHuntGlobalScan = schedules.task({
  id: "job-hunt-global-scan",
  // DISABLED 2026-06-03 — user paused the job-hunt email digests. Auto-run cron
  // commented out (task can still be triggered manually). To fully stop it in
  // production, also toggle the "job-hunt-global-scan" schedule off in the
  // Trigger.dev dashboard (Schedules tab) and/or redeploy. Re-enable by
  // uncommenting the cron below.
  // cron: { pattern: "5 7 * * 1", timezone: "Europe/Malta" }, // Weekly Mon 07:05 Europe/Malta
  maxDuration: 900,
  run: async () => runJobHunt({ track: "global" }),
});
