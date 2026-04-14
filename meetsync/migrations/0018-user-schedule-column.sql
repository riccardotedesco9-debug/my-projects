-- 0018: schedule-on-user
--
-- Moves the canonical per-user schedule from participants.schedule_json
-- (per-session-per-user) to users.latest_schedule_json (one per user).
-- This collapses the WhatsApp-era session layer so schedules become
-- visible across any context without needing a live session row.
--
-- Sessions / participants / pending_invites tables remain in place for
-- rollback safety; the code stops writing to them in the same deploy,
-- and a later migration can drop them once we're confident.
--
-- Backfill: pull each user's latest non-empty participants.schedule_json
-- so no one loses their already-uploaded schedule.

ALTER TABLE users ADD COLUMN latest_schedule_json TEXT;

UPDATE users
   SET latest_schedule_json = (
     SELECT schedule_json FROM participants p
      WHERE p.chat_id = users.chat_id
        AND p.schedule_json IS NOT NULL
        AND p.schedule_json != ''
      ORDER BY p.created_at DESC LIMIT 1
   )
 WHERE latest_schedule_json IS NULL;
