#!/bin/bash
# L2.2 — add_contact creates a person_notes row on first mention.
#
# Naming a new contact conversationally should trigger add_contact and
# persist the row. Phone is optional — bot must not gatekeep.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users
seed_user "$TEST_USER_A" "Alex" "en"

section "Mention a brand-new contact"
send_webhook "$TEST_USER_A" "I want to schedule something with Laura next week"
sleep 20

section "Verify person_notes row exists"
assert_rows "SELECT id FROM person_notes WHERE owner_chat_id='$TEST_USER_A' AND name_normalized='laura'" 1

section "Bot should not have asked for Laura's phone unprompted"
REPLY=$(last_bot_reply "$TEST_USER_A")
assert_reply_matches_judge "$REPLY" "Bot did not demand Laura's phone number as a precondition for moving forward — if it mentions phone at all, it's optional, not gating."

echo
echo "${_GREEN}L2.2 passed${_RESET} — add_contact works without phone gating"
