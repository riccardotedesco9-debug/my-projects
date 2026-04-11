-- Migration 0015 — per-person knowledge notes
--
-- Stores structured per-person data for people MENTIONED by a user, not just
-- people who have messaged the bot themselves. Closes the gap where "Diego"
-- mentioned as a partner could only live as freeform text inside the
-- inviter's users.context blob.
--
-- Each row is owned by a specific user (owner_chat_id) and describes another
-- person (name). When that described person eventually joins the bot (e.g.
-- taps an invite link), the row is LINKED via linked_chat_id rather than
-- duplicated — so Diego's accumulated notes from a year ago still apply when
-- he finally joins.
--
-- Also used by schedule-on-behalf: if the inviter uploads "Diego's schedule"
-- as a photo, the parser writes the extracted shifts into person_notes.schedule_json
-- and match-compute picks them up as a proxy for a real participant upload.

CREATE TABLE IF NOT EXISTS person_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_chat_id TEXT NOT NULL,
  -- Display name the user gave us (may be mixed case, with typos, etc.)
  name TEXT NOT NULL,
  -- Lowercased, trimmed version used for matching + uniqueness. Prevents
  -- "Diego" and "diego" from creating two separate rows for the same person.
  name_normalized TEXT NOT NULL,
  -- Optional phone number the user provided for this person.
  phone TEXT,
  -- If this person has joined the bot (clicked an invite link, etc.), this
  -- is their chat_id. Prior to joining it's NULL. On join we UPDATE this
  -- field rather than creating a second row, preserving all accumulated notes.
  linked_chat_id TEXT,
  -- Parsed schedule data uploaded "on behalf of" this person. JSON matching
  -- the shape used in participants.schedule_json. Populated by schedule-parser
  -- when the user uploads a file with an explicit per-person attribution
  -- ("here's Diego's schedule"). Used by match-compute if the person hasn't
  -- joined yet.
  schedule_json TEXT,
  -- Accumulated freeform facts about this person (work pattern, preferences,
  -- relationship to the owner, timezone, etc.). Append-only via intent-router
  -- learned_facts extraction when the fact is about a named third party.
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(owner_chat_id, name_normalized)
);

-- Fast lookup of "all people known to this user"
CREATE INDEX IF NOT EXISTS idx_person_notes_owner
  ON person_notes(owner_chat_id);

-- Fast reverse lookup "has this chat_id already been linked to a person_note?"
-- Used during invite-accept to find the pre-existing notes row to merge into.
CREATE INDEX IF NOT EXISTS idx_person_notes_linked
  ON person_notes(linked_chat_id)
  WHERE linked_chat_id IS NOT NULL;
