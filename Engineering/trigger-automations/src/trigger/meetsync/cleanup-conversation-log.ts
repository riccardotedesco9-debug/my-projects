// cleanup-conversation-log — nightly cron that trims conversation_log to
// the last 50 rows per chat_id. Moved here from an inline cleanup inside
// logMessage() in d1-client.ts — that correlated-subquery DELETE ran on
// every message write and was the top suspect for D1 storage-timeouts
// (code 7429, observed as "D1 DB storage operation exceeded timeout which
// caused object to be reset"). Running once a night instead is:
//   - O(1) writes per turn (just the INSERT)
//   - predictable maintenance window (03:00 UTC, off-peak Malta time)
//   - still bounded storage (50 rows/chat) with at most 1 day of overflow
//
// Also reaps stuck reminders: rows left in FIRING status for >10min get
// flipped back to PENDING so they fire next cron.

import { schedules } from "@trigger.dev/sdk";
import { query } from "./d1-client.js";

export const cleanupConversationLog = schedules.task({
  id: "meetsync-cleanup-conversation-log",
  cron: "0 3 * * *", // 03:00 UTC daily
  run: async () => {
    // 1. Find every chat_id that has >50 rows. Iterate per-chat so each
    //    DELETE is bounded and safe even if one chat has thousands of rows.
    const chatsResult = await query<{ chat_id: string; n: number }>(
      `SELECT chat_id, COUNT(*) as n FROM conversation_log
       GROUP BY chat_id HAVING COUNT(*) > 50`,
    );
    let totalDeleted = 0;
    for (const { chat_id } of chatsResult.results) {
      try {
        const del = await query(
          `DELETE FROM conversation_log
           WHERE chat_id = ? AND id NOT IN (
             SELECT id FROM conversation_log
             WHERE chat_id = ?
             ORDER BY created_at DESC LIMIT 50
           )`,
          [chat_id, chat_id],
        );
        totalDeleted += del.meta?.changes ?? 0;
      } catch (err) {
        console.error(`[cleanup] DELETE failed for chat=${chat_id}:`, err instanceof Error ? err.message : err);
      }
    }

    // 2. Reap stuck reminders — anything in FIRING for >10 min flips back
    //    to PENDING for retry. Safety net so the atomic-lease pattern in
    //    fire-reminders doesn't leak rows on a mid-flight worker crash.
    let reapedReminders = 0;
    try {
      const reap = await query(
        `UPDATE reminders SET status='PENDING', leased_at=NULL
         WHERE status='FIRING' AND leased_at IS NOT NULL
         AND leased_at < ?`,
        [Math.floor(Date.now() / 1000) - 600],
      );
      reapedReminders = reap.meta?.changes ?? 0;
    } catch (err) {
      console.error("[cleanup] reminder reap failed:", err instanceof Error ? err.message : err);
    }

    console.log(`[cleanup] chats_trimmed=${chatsResult.results.length} rows_deleted=${totalDeleted} reminders_reaped=${reapedReminders}`);
    return {
      chats_trimmed: chatsResult.results.length,
      rows_deleted: totalDeleted,
      reminders_reaped: reapedReminders,
    };
  },
});
