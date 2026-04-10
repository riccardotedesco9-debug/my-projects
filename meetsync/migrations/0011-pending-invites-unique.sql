-- Round 4: harden pending_invites against duplicate rows for the same
-- (session, invitee) pair. Previously nothing prevented two rows if a creator
-- raced two invites for the same partner, leading to double deep-link noise.
--
-- Partial UNIQUE index: only enforced when invitee_chat_id is NOT NULL (so
-- multiple "unknown invitee" rows can still share a session_id while they
-- wait for /start) AND only for PENDING rows (so an ACCEPTED row followed
-- by a new PENDING invite after a DECLINE flow doesn't collide).

CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_invites_no_dup
  ON pending_invites(session_id, invitee_chat_id)
  WHERE invitee_chat_id IS NOT NULL AND status = 'PENDING';
