import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: "proj_njxprjwjwpnxifasacvr",
  dirs: ["src/trigger"],
  maxDuration: 300, // 5 minutes default, override per-task as needed

  // Global failure hook — fires once per task run that ultimately fails (after
  // all retries exhausted). Pings the MeetSync Worker /internal/alert relay so
  // the failure shows up in the owner's Telegram chat. Best-effort — never
  // throws, so the failure path itself can't blow up the runtime.
  //
  // Two of the 9 tasks (billing-pulse, job-hunt) ALSO call notifyOwner from
  // their own catch blocks with richer context labels. The double-ping is
  // intentional and acceptable: first ping carries task-specific context
  // (month, track, phase), second ping from this hook is the generic catch-all
  // covering the other 7 tasks.
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
