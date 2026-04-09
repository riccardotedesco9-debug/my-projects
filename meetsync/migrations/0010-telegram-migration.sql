-- MeetSync Telegram Migration — fresh schema with chat_id as primary identifier
-- Drops all WhatsApp-era tables and recreates for Telegram Bot API

DROP TABLE IF EXISTS conversation_log;
DROP TABLE IF EXISTS free_slots;
DROP TABLE IF EXISTS pending_invites;
DROP TABLE IF EXISTS participants;
DROP TABLE IF EXISTS google_tokens;
DROP TABLE IF EXISTS rate_strikes;
DROP TABLE IF EXISTS rate_limits;
DROP TABLE IF EXISTS blocked_phones;
DROP TABLE IF EXISTS blocked_users;
DROP TABLE IF EXISTS partners;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;

-- Central knowledge base — everyone who's messaged the bot
CREATE TABLE users (
  chat_id TEXT PRIMARY KEY,
  phone TEXT,                           -- optional, from Telegram "share contact"
  username TEXT,                        -- optional, from Telegram @username
  name TEXT,
  preferred_language TEXT DEFAULT 'en',
  context TEXT,                         -- accumulated facts from conversations
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Session lifecycle (supports any number of participants via participants table)
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  creator_chat_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  mode TEXT,                            -- NULL = classic, 'MEDIATED' = share availability
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  both_confirmed_token_id TEXT,
  both_preferred_token_id TEXT
);
CREATE INDEX idx_sessions_code ON sessions(code);
CREATE INDEX idx_sessions_status ON sessions(status);

-- Per-person state within a session
CREATE TABLE participants (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('creator', 'partner')),
  state TEXT NOT NULL DEFAULT 'IDLE',
  schedule_json TEXT,
  preferred_slots TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(session_id, chat_id)
);
CREATE INDEX idx_participants_chat_id ON participants(chat_id);
CREATE INDEX idx_participants_session ON participants(session_id);

-- Computed free time slots
CREATE TABLE free_slots (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  slot_number INTEGER NOT NULL,
  day TEXT NOT NULL,
  day_name TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  UNIQUE(session_id, slot_number)
);
CREATE INDEX idx_free_slots_session ON free_slots(session_id);

-- Async pairing — when creator names someone the bot doesn't know yet
CREATE TABLE pending_invites (
  id TEXT PRIMARY KEY,
  inviter_chat_id TEXT NOT NULL,
  invitee_chat_id TEXT,                 -- NULL if invitee hasn't started bot yet
  invitee_phone TEXT,                   -- optional, if inviter provided phone
  session_id TEXT NOT NULL REFERENCES sessions(id),
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_pending_invites_invitee ON pending_invites(invitee_chat_id, status);

-- Per-user Google Calendar OAuth tokens
CREATE TABLE google_tokens (
  chat_id TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Sliding-window rate counting
CREATE TABLE rate_limits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX idx_rate_limits_chat_id ON rate_limits(chat_id, ts);

-- Escalating cooldown tracking
CREATE TABLE rate_strikes (
  chat_id TEXT PRIMARY KEY,
  strike_count INTEGER NOT NULL DEFAULT 0,
  cooldown_until TEXT,
  last_strike TEXT
);

-- Admin blocklist
CREATE TABLE blocked_users (
  chat_id TEXT PRIMARY KEY,
  blocked_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Short conversation log per user
CREATE TABLE conversation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'bot')),
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_convo_chat_id ON conversation_log(chat_id, created_at DESC);
