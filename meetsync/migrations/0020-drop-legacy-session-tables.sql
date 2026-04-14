-- 0020: drop legacy session-layer tables
--
-- The shared-hub refactor (migration 0018) moved schedules onto users and
-- contacts onto person_notes; sessions, participants, pending_invites and
-- free_slots have had zero writes from the runtime since then. Dropping
-- them reclaims D1 space and removes the shadow schema that would
-- otherwise drift from reality.
--
-- session_events is kept — it's append-only telemetry the turn handler
-- still writes to with a "no-session" placeholder; useful for debugging
-- even without sessions as a concept. Can be dropped later if noise.

DROP TABLE IF EXISTS free_slots;
DROP TABLE IF EXISTS participants;
DROP TABLE IF EXISTS pending_invites;
DROP TABLE IF EXISTS sessions;
