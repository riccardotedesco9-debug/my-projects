-- 0022: surface expired Google tokens + atomic reminder lease
--
-- users.google_token_invalid:
--   When refreshAccessToken returns "invalid_grant" (user revoked access, or
--   grant expired after >6 months of inactivity), we need a way to remember
--   the token is dead so the bot doesn't repeatedly try the hopeless refresh
--   and can honestly tell the user "reconnect please" via [STATE]. Cleared
--   on successful /connect reflow.
--
-- reminders.leased_at:
--   Supports the FIRING atomic-lease pattern in fire-reminders. Workflow:
--     1. Optimistic flip: UPDATE SET status='FIRING', leased_at=now
--          WHERE id=? AND status='PENDING'
--     2. If changes>0: send Telegram, then SET status='FIRED'
--     3. On send failure: leave in FIRING; reaper cron flips stuck rows
--        (leased_at < now-600s) back to PENDING.
--   Eliminates the "send-then-mark" race where a 429 between send and mark
--   caused duplicate reminders.

ALTER TABLE users ADD COLUMN google_token_invalid INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reminders ADD COLUMN leased_at INTEGER;
