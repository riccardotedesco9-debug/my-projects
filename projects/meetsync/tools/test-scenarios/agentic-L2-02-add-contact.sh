#!/bin/bash
# L2.2 — add_contact creates a person_notes row on first mention.
#
# Naming a new contact conversationally should trigger add_contact and
# persist the row. Phone is optional — bot must not gatekeep.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users
seed_user "$TEST_USER_A" "Alex" "en"

section "Mention a brand-new contact with a concrete ask"
# Include a schedule signal so Claude has a reason to materialise the
# contact: "Laura works weekdays 9-5". That's enough context for the
# bot to both add her AND save a schedule for her in one turn.
send_webhook "$TEST_USER_A" "My friend Laura works weekdays 9am-5pm. When can we meet next week?"
sleep 25

section "Verify person_notes row exists for Laura"
assert_rows "SELECT id FROM person_notes WHERE owner_chat_id='$TEST_USER_A' AND name_normalized='laura'" 1

section "Bot should not have gated on Laura's phone number"
REPLY=$(last_bot_reply "$TEST_USER_A")
assert_reply_matches_judge "$REPLY" "Bot did not demand Laura's phone number as a precondition for moving forward. Mentioning phone as optional is fine; making it gating is not."

echo
echo "${_GREEN}L2.2 passed${_RESET} — add_contact materialises on first mention"
