-- Round 8: per-user timezone support.
--
-- Before: every timezone-sensitive operation hardcoded "Europe/Malta"
-- (match-compute's weekday lookup, deliver-results's .ics formatting,
-- google-calendar's event timezone). Worked for the sole user (Riccardo
-- in Malta) but would silently drift by 1+ hours for anyone else, and
-- break on DST transitions even for Malta users.
--
-- After: store an IANA timezone string per user. Defaulted from
-- Telegram's `language_code` on first message (best-effort guess) and
-- can be overridden explicitly by the user. Used by schedule-parser
-- when building the weekday lookup, by deliver-results for the .ics
-- floating-time representation, and by google-calendar for event
-- timezone.
--
-- Default 'Europe/Malta' keeps existing behavior identical for
-- Riccardo and other Malta users; everyone else gets a TZ that makes
-- their calendar events land at the right wall-clock time.

ALTER TABLE users ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Europe/Malta';

-- Session events observability — round-8 addition. Each material state
-- transition inserts a row here so a stuck session can be diagnosed
-- without re-reading Trigger.dev run logs. Indexed by session_id so the
-- common query "what happened in this session" is cheap.
CREATE TABLE session_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  event TEXT NOT NULL,
  data TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_session_events_session ON session_events(session_id, created_at);
