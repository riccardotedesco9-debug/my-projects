-- Blocked phones table for admin-managed access control
CREATE TABLE IF NOT EXISTS blocked_phones (
  phone TEXT PRIMARY KEY,
  blocked_at TEXT NOT NULL DEFAULT (datetime('now')),
  reason TEXT
);
