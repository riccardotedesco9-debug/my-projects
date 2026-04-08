-- Users table — central knowledge base for everyone who's messaged the bot
CREATE TABLE IF NOT EXISTS users (
  phone TEXT PRIMARY KEY,
  name TEXT,
  preferred_language TEXT DEFAULT 'en',
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Pending invites — when inviter names someone the bot doesn't know yet
CREATE TABLE IF NOT EXISTS pending_invites (
  id TEXT PRIMARY KEY,
  inviter_phone TEXT NOT NULL,
  invitee_phone TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pending_invites_invitee ON pending_invites(invitee_phone, status);
