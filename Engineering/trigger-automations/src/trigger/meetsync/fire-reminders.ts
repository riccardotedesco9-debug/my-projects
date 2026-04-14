// fire-reminders — cron task that picks up due reminders and sends them as
// Telegram messages from the MeetSync bot. Runs every minute. Handles both
// one-shot (mark FIRED) and recurring (advance fire_at) reminders.
//
// Failure policy: if a single reminder fails to send, log and continue with
// the rest. Do NOT throw — a single bad Telegram response shouldn't block
// the whole batch. The reminder stays PENDING so the next run retries it;
// after too many retries the user can cancel manually.

import { schedules } from "@trigger.dev/sdk";
import {
  getDueReminders,
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
  cron: "* * * * *", // every minute
  run: async () => {
    const nowEpoch = Math.floor(Date.now() / 1000);
    const due: Reminder[] = await getDueReminders(nowEpoch, MAX_PER_RUN);
    if (due.length === 0) return { fired: 0 };

    let fired = 0;
    let failed = 0;
    for (const r of due) {
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
          `fire-reminders: send failed for ${r.id} (chat ${r.chat_id}):`,
          err instanceof Error ? err.message : err,
        );
        // Intentionally do not mark FIRED — let the next minute retry.
      }
    }

    return { fired, failed, examined: due.length };
  },
});

/** Compose the message body shown to the user. Simple and warm. */
function formatReminderMessage(r: Reminder): string {
  const tag = r.recurrence ? ` (${r.recurrence})` : "";
  return `⏰ Reminder${tag}: ${r.text}`;
}
