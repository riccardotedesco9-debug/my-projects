-- 0017: reminders table
--
-- Stores user-scheduled reminders that fire as Telegram messages from the
-- bot at a chosen time. General-purpose — not tied to scheduling sessions
-- ("remind me to call mum tomorrow at 6am" / "every Monday 9am stretch").
--
-- fire_at is stored as a UTC Unix epoch (integer seconds). The tool that
-- inserts a row converts the user's local-wall-clock request into UTC using
-- their users.timezone. The cron firer polls in UTC too — no tz math in SQL.

CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,                         -- UUID
  chat_id TEXT NOT NULL,                       -- Owner's Telegram chat_id
  text TEXT NOT NULL,                          -- What to remind them about
  fire_at INTEGER NOT NULL,                    -- Next fire time (UTC epoch seconds)
  status TEXT NOT NULL DEFAULT 'PENDING',      -- PENDING | FIRED | CANCELLED
  recurrence TEXT,                             -- NULL (one-shot) | 'daily' | 'weekly' | 'monthly'
  timezone TEXT NOT NULL,                      -- IANA tz at creation (for displaying back to user)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  fired_at TEXT                                -- Last fire timestamp (for recurring tracking)
);

-- Cron firer: "SELECT * FROM reminders WHERE status='PENDING' AND fire_at <= ? ORDER BY fire_at LIMIT N"
CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(status, fire_at);

-- List/cancel by owner: "WHERE chat_id = ? AND status = 'PENDING'"
CREATE INDEX IF NOT EXISTS idx_reminders_owner_status ON reminders(chat_id, status, fire_at);
