-- 0019: schedule upload watches
--
-- Lets the bot honor "I'll let you know once X uploads their schedule"
-- promises. When Claude makes that promise, it calls watch_schedule_upload
-- to register a row here. When that target user next saves a schedule via
-- parse_schedule, any outstanding watches fire as Telegram messages to the
-- watchers, and the rows are deleted (one-shot).

CREATE TABLE IF NOT EXISTS user_schedule_watches (
  id TEXT PRIMARY KEY,                      -- UUID
  watcher_chat_id TEXT NOT NULL,            -- Who wants to be notified
  target_chat_id TEXT NOT NULL,             -- Whose upload we're watching
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(watcher_chat_id, target_chat_id)   -- One watch per pair; repeat
                                             -- promises are idempotent
);

CREATE INDEX IF NOT EXISTS idx_schedule_watches_target ON user_schedule_watches(target_chat_id);
