// fire-reminders — cron task that picks up due reminders and sends them as
// Telegram messages from the MeetSync bot. Runs every 5 minutes. Handles both
// one-shot (mark FIRED) and recurring (advance fire_at) reminders.
//
// Atomic-lease pattern: each reminder is flipped PENDING → FIRING via a
// conditional UPDATE before we send. Only the worker whose UPDATE actually
// changed the row (leaseReminder returns true) proceeds to send — this
// prevents two cron ticks racing on an overdue reminder and sending it
// twice. On send success we flip to FIRED (or back to PENDING with advanced
// fire_at for recurring). On send failure we leave the row in FIRING; the
// nightly cleanup cron reaps rows stuck in FIRING for >10 min back to
// PENDING for retry. A missed reminder is better than a duplicate DM.

import { schedules } from "@trigger.dev/sdk";
import {
  getDueReminders,
  leaseReminder,
  markReminderFired,
  advanceRecurringReminder,
  computeNextRecurrence,
  type Reminder,
  type ReminderRecurrence,
} from "./d1-client.js";
import { sendTextMessage } from "./telegram-client.js";

/** Hard cap per run so one cron tick can't melt Telegram's rate limits. */
const MAX_PER_RUN = 50;

export const fireReminders = schedules.task({
  id: "meetsync-fire-reminders",
  cron: "*/5 * * * *", // every 5 minutes — D1 REST API rate-limits tighter runs
  run: async () => {
    const nowEpoch = Math.floor(Date.now() / 1000);
    const due: Reminder[] = await getDueReminders(nowEpoch, MAX_PER_RUN);
    if (due.length === 0) return { fired: 0 };

    let fired = 0;
    let failed = 0;
    let skipped = 0;
    for (const r of due) {
      // Atomically claim the lease — if another worker beat us, skip.
      let won = false;
      try {
        won = await leaseReminder(r.id, nowEpoch);
      } catch (err) {
        failed++;
        console.error(
          `fire-reminders: lease failed for ${r.id}:`,
          err instanceof Error ? err.message : err,
        );
        continue;
      }
      if (!won) {
        skipped++;
        continue;
      }

      try {
        const body = formatReminderMessage(r);
        await sendTextMessage(r.chat_id, body);
        if (r.recurrence) {
          const next = computeNextRecurrence(r.fire_at, r.recurrence as ReminderRecurrence);
          await advanceRecurringReminder(r.id, next);
        } else {
          await markReminderFired(r.id);
        }
        fired++;
      } catch (err) {
        failed++;
        console.error(
          `fire-reminders: send/mark failed for ${r.id} (chat ${r.chat_id}):`,
          err instanceof Error ? err.message : err,
        );
        // Leave in FIRING; cleanup cron will reap it back to PENDING after
        // 10 min so it retries next tick. Better than duplicate sends.
      }
    }

    return { fired, failed, skipped, examined: due.length };
  },
});

/** Compose the message body shown to the user. Simple and warm. */
function formatReminderMessage(r: Reminder): string {
  const tag = r.recurrence ? ` (${r.recurrence})` : "";
  return `⏰ Reminder${tag}: ${r.text}`;
}
