import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: "proj_njxprjwjwpnxifasacvr",
  dirs: ["src/trigger"],
  maxDuration: 300, // 5 minutes default, override per-task as needed

  // Global failure hook — fires once per task run that ultimately fails (after
  // all retries exhausted). Pings the MeetSync Worker /internal/alert relay so
  // the failure shows up in the owner's Telegram chat. Single source of truth
  // for failure alerting — per-task catch blocks no longer call notifyOwner
  // for failures (they re-throw and let this hook do the alerting).
  // Best-effort — never throws, so the failure path itself can't blow up
  // the runtime.
  onFailure: async ({ ctx, error }) => {
    const secret = process.env.INTERNAL_ALERT_SECRET;
    const baseUrl =
      process.env.MEETSYNC_WORKER_URL ??
      "https://meetsync-worker.riccardotedesco9.workers.dev";
    if (!secret) {
      console.warn("[onFailure-hook] INTERNAL_ALERT_SECRET not set — alert skipped");
      return;
    }
    const errMsg = error instanceof Error ? error.message : String(error);
    const truncated = errMsg.length > 1500 ? errMsg.slice(0, 1500) + "…" : errMsg;
    try {
      await fetch(`${baseUrl}/internal/alert`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          label: `trigger/${ctx.task.id}`,
          message: `Run ${ctx.run.id} failed:\n${truncated}`,
        }),
      });
    } catch (e) {
      console.error(
        "[onFailure-hook] alert post failed:",
        e instanceof Error ? e.message : e,
      );
    }
  },
});
