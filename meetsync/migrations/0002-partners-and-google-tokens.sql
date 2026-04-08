-- Partners table for auto-pairing returning users
CREATE TABLE IF NOT EXISTS partners (
  id TEXT PRIMARY KEY,
  phone_a TEXT NOT NULL,
  phone_b TEXT NOT NULL,
  last_session_id TEXT REFERENCES sessions(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(phone_a, phone_b)
);

CREATE INDEX IF NOT EXISTS idx_partners_phone_a ON partners(phone_a);
CREATE INDEX IF NOT EXISTS idx_partners_phone_b ON partners(phone_b);

-- Google Calendar OAuth tokens for opt-in calendar integration
CREATE TABLE IF NOT EXISTS google_tokens (
  phone TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
