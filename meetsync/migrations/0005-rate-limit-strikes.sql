-- Track repeat offenders with escalating cooldowns
CREATE TABLE IF NOT EXISTS rate_strikes (
  phone TEXT PRIMARY KEY,
  strike_count INTEGER NOT NULL DEFAULT 1,
  cooldown_until TEXT,
  last_strike TEXT NOT NULL DEFAULT (datetime('now'))
);
