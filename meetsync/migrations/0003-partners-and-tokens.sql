-- Partners: remember recurring scheduling pairs
CREATE TABLE IF NOT EXISTS partners (
  id TEXT PRIMARY KEY,
  phone_a TEXT NOT NULL,
  phone_b TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_session_id TEXT,
  UNIQUE(phone_a, phone_b)
);

CREATE INDEX IF NOT EXISTS idx_partners_phone_a ON partners(phone_a);
CREATE INDEX IF NOT EXISTS idx_partners_phone_b ON partners(phone_b);

-- Google Calendar OAuth tokens per user
CREATE TABLE IF NOT EXISTS google_tokens (
  phone TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
