-- 0021: users.email + stale-schedule nudge tracking
--
-- email: captured on Google OAuth completion. Lets book_meetup send ONE
-- calendar event with all participants as attendees (true shared event)
-- instead of creating parallel events per person.
--
-- last_stale_nudge_at: rate-limits the proactive "your schedule's past-
-- dated, want to refresh?" cron so a user isn't pinged daily.

ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN last_stale_nudge_at TEXT;
