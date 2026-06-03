-- Round 6: Move waitpoint token ownership from orchestrator to router.
--
-- Before: session-orchestrator created the confirmed/preferred tokens inside
-- its own task body, then message-router polled `sessions.both_*_token_id`
-- with a 5x2s retry loop hoping the orchestrator had cold-started in time.
-- Under load the poll window expired silently and sessions got stuck in
-- PAIRED forever. The `setTimeout(3000)` "race guard" in the router was
-- cargo-cult, not synchronization.
--
-- After: message-router calls `wait.createToken()` BEFORE triggering the
-- orchestrator, writes both IDs to the sessions row in a single UPDATE,
-- then triggers the orchestrator with the token IDs embedded in the
-- payload. The orchestrator just does `wait.forToken(payload.id)` on a
-- token that already exists. Zero poll loops. Zero sleeps.
--
-- Breaking change: in-flight sessions (anything not COMPLETED/EXPIRED) rely
-- on the old token-creation flow and will be stuck after this migration.
-- We wipe them here — confirmed safe because MeetSync is pre-launch.
--
-- Note: an earlier draft of this migration also added a
-- `consolidation_winner_log_id` column to `users` for an "atomic" burst
-- consolidation guard. Walking through the scenarios showed the existing
-- sleep-then-query guard in message-router.ts is actually correct — the
-- sleep exists specifically to buffer for "messages that haven't reached
-- the Worker yet", which no amount of DB atomicity can fix. Column dropped.

-- 1. Add a match attempt counter on sessions. Incremented every time the
--    amend flow spawns a fresh orchestrator; used as a version suffix in
--    waitpoint idempotency keys so reusing a key (with completed status)
--    from a prior attempt doesn't return the stale waitpoint back. See
--    spawnOrchestrator / restartOrchestratorForAmend in message-router.ts.
ALTER TABLE sessions ADD COLUMN match_attempt INTEGER NOT NULL DEFAULT 0;

-- 2. Wipe in-flight sessions that rely on the old token-creation flow.
--    Keep COMPLETED and EXPIRED rows for history.
DELETE FROM free_slots
  WHERE session_id IN (
    SELECT id FROM sessions WHERE status NOT IN ('COMPLETED', 'EXPIRED')
  );

DELETE FROM participants
  WHERE session_id IN (
    SELECT id FROM sessions WHERE status NOT IN ('COMPLETED', 'EXPIRED')
  );

DELETE FROM pending_invites
  WHERE session_id IN (
    SELECT id FROM sessions WHERE status NOT IN ('COMPLETED', 'EXPIRED')
  );

DELETE FROM sessions WHERE status NOT IN ('COMPLETED', 'EXPIRED');
