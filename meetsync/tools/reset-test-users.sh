#!/bin/bash
# Wipe all state for reserved test chat_ids (999999001, 999999002).
# Run this between persona-test scenarios so each scenario starts clean.

set -euo pipefail

cat > /c/tmp/meetsync-cleanup.sql <<'SQL'
-- Delete in FK-safe order: children before parents.
DELETE FROM free_slots WHERE session_id IN (SELECT id FROM sessions WHERE creator_chat_id IN ('999999001','999999002'));
DELETE FROM pending_invites WHERE inviter_chat_id IN ('999999001','999999002') OR invitee_chat_id IN ('999999001','999999002');
DELETE FROM participants WHERE chat_id IN ('999999001','999999002') OR session_id IN (SELECT id FROM sessions WHERE creator_chat_id IN ('999999001','999999002'));
DELETE FROM sessions WHERE creator_chat_id IN ('999999001','999999002');
DELETE FROM conversation_log WHERE chat_id IN ('999999001','999999002');
DELETE FROM rate_limits WHERE chat_id IN ('999999001','999999002');
DELETE FROM rate_strikes WHERE chat_id IN ('999999001','999999002');
DELETE FROM users WHERE chat_id IN ('999999001','999999002');
SQL

cd "$(dirname "${BASH_SOURCE[0]}")/../worker"
npx wrangler d1 execute meetsync-db --remote --file=/c/tmp/meetsync-cleanup.sql 2>&1 | tail -3
echo "test users reset."
