#!/bin/bash
# L2.6 — reset_conversation clears chat history but preserves schedules
# and contacts. Critical invariant: "Your contacts and schedules stay
# until you change them" (per persona line 162).

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users
seed_user "$TEST_USER_A" "Alex" "en"
seed_schedule "$TEST_USER_A" '[{"date":"2026-04-30","start_time":"09:00","end_time":"17:00","label":"work"}]'
seed_contact "$TEST_USER_A" "Marco"

# Drop some chatter into the log to verify it gets cleared.
send_webhook "$TEST_USER_A" "hey bot"
sleep 10

HIST_BEFORE=$(d1_select "SELECT COUNT(*) AS n FROM conversation_log WHERE chat_id='$TEST_USER_A'" | python -c 'import json,sys; print(json.load(sys.stdin)[0]["n"])')
hint "conversation_log rows before reset: $HIST_BEFORE"
if (( HIST_BEFORE < 1 )); then fail "log should have at least one row before reset"; fi

section "Request reset"
send_webhook "$TEST_USER_A" "reset the conversation"
sleep 15

section "Verify conversation_log is (close to) empty for this chat"
# Reset + the bot's acknowledgement + the reset request itself may leave a
# few rows. Accept up to 3 residual entries.
HIST_AFTER=$(d1_select "SELECT COUNT(*) AS n FROM conversation_log WHERE chat_id='$TEST_USER_A'" | python -c 'import json,sys; print(json.load(sys.stdin)[0]["n"])')
hint "conversation_log rows after reset: $HIST_AFTER"
if (( HIST_AFTER > 3 )); then
  fail "expected conversation_log trimmed (≤3 rows), got $HIST_AFTER"
fi
tick "chat history cleared"

section "Verify schedule AND contact survived"
assert_rows "SELECT latest_schedule_json FROM users WHERE chat_id='$TEST_USER_A' AND latest_schedule_json IS NOT NULL" 1
assert_rows "SELECT id FROM person_notes WHERE owner_chat_id='$TEST_USER_A' AND name_normalized='marco'" 1

echo
echo "${_GREEN}L2.6 passed${_RESET} — reset preserves data, clears history"
