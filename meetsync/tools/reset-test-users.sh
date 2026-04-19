#!/bin/bash
# Wipe all state for reserved test chat_ids (999999001-999999010).
# Run between scenarios so each starts clean.
#
# Updated for the agentic (post-migration-0020) schema: sessions/
# participants/pending_invites/free_slots were dropped. person_notes,
# reminders, user_schedule_watches and google_tokens are the per-chat
# tables that actually matter now.

set -euo pipefail

IDS="'999999001','999999002','999999003','999999004','999999005','999999006','999999007','999999008','999999009','999999010'"

cat > /c/tmp/meetsync-cleanup.sql <<SQL
-- Agentic-era test state cleanup. Order: dependent rows first, parent last.
DELETE FROM person_notes WHERE owner_chat_id IN ($IDS) OR linked_chat_id IN ($IDS);
DELETE FROM reminders WHERE chat_id IN ($IDS);
DELETE FROM user_schedule_watches WHERE watcher_chat_id IN ($IDS) OR target_chat_id IN ($IDS);
DELETE FROM google_tokens WHERE chat_id IN ($IDS);
DELETE FROM conversation_log WHERE chat_id IN ($IDS);
DELETE FROM rate_limits WHERE chat_id IN ($IDS);
DELETE FROM rate_strikes WHERE chat_id IN ($IDS);
DELETE FROM blocked_users WHERE chat_id IN ($IDS);
DELETE FROM session_events WHERE chat_id IN ($IDS);
DELETE FROM users WHERE chat_id IN ($IDS);
SQL

cd "$(dirname "${BASH_SOURCE[0]}")/../worker"
npx wrangler d1 execute meetsync-db --remote --file=/c/tmp/meetsync-cleanup.sql 2>&1 | tail -3
echo "test users reset."
