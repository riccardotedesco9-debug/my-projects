-- 0016: hidden flag on person_notes
-- Lets callers exclude a contact from their "who's available" pool without
-- deleting data ("not interested in Sofia anymore" / "bring Sofia back").
-- Default 0 keeps all existing rows active.

ALTER TABLE person_notes ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;

-- Supports the snapshot query "WHERE owner_chat_id = ? AND hidden = 0 ORDER BY updated_at DESC"
CREATE INDEX IF NOT EXISTS idx_person_notes_owner_active ON person_notes(owner_chat_id, hidden, updated_at);
