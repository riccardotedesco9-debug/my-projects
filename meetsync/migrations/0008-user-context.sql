-- Per-person accumulated context (facts the bot learns from conversations)
ALTER TABLE users ADD COLUMN context TEXT DEFAULT NULL;
