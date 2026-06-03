import { schedules } from "@trigger.dev/sdk";

// Weekly Pulse — Automated reminder to run the tech intelligence pipeline
// Fires every Monday at 8am UTC (10am Europe/Malta in summer)
export const weeklyPulse = schedules.task({
  id: "weekly-pulse",
  cron: "0 8 * * 1",

  run: async () => {
    const timestamp = new Date().toISOString();
    console.log(`Weekly Pulse triggered at ${timestamp}`);

    const webhookUrl = process.env.WEEKLY_PULSE_SLACK_WEBHOOK;

    if (webhookUrl) {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: [
            "*THE WEEKLY PULSE — Automation Reminder*",
            `Triggered: ${timestamp}`,
            "",
            "Run the pipeline in Claude Code:",
            "> Run The Weekly Pulse",
            "",
            "This generates: trend analysis, Gamma presentation,",
            "Canva graphics, Gmail newsletter, Slack digest,",
            "and the visual dashboard.",
          ].join("\n"),
        }),
      });

      if (!response.ok) {
        throw new Error(`Slack webhook failed: ${response.status}`);
      }

      return { status: "reminder-sent", timestamp };
    }

    // No webhook configured — log only
    console.log("No WEEKLY_PULSE_SLACK_WEBHOOK set. Reminder logged only.");
    return { status: "logged", timestamp };
  },
});
