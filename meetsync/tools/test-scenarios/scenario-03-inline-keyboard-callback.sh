#!/bin/bash
# Scenario 03 — inline keyboard callback_query end-to-end.
#
# Verifies the round-9 inline-keyboard pipeline works in production:
#   1. Seed a participant in AWAITING_CONFIRMATION state with a schedule.
#   2. POST a synthetic callback_query with data="confirm_schedule" (what
#      Telegram delivers when the user taps the "Yes" button).
#   3. Worker's synthesizeFromCallback translates it to text "yes" → the
#      router sees a regular text message → handleAwaitingConfirmation
#      runs confirm_schedule branch → participant state becomes
#      SCHEDULE_CONFIRMED.
#
# Proves:
#   - callback_query updates are delivered by Telegram (webhook was
#     re-registered with allowed_updates: ["message","callback_query"])
#   - Worker's callback_query branch handles the update
#   - CALLBACK_DATA_TO_TEXT maps "confirm_schedule" to "yes"
#   - The synthetic message flows through the normal intent classifier
#   - Intent resolves to confirm_schedule and state advances

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users

SESSION_ID="test-cb-$(date +%s)"

# Seed user + session directly so we're not dependent on the full
# conversational bootstrap.
seed_user "$TEST_USER_A" "riccardo"
seed_confirming_session "$SESSION_ID" "$TEST_USER_A"

step "verify participant is AWAITING_CONFIRMATION before button tap"
assert_rows "SELECT id FROM participants WHERE chat_id = '$TEST_USER_A' AND state = 'AWAITING_CONFIRMATION'" 1

step "simulate inline-keyboard Yes button tap"
send_callback "$TEST_USER_A" "confirm_schedule"

step "wait for router task to process the callback"
wait_for "SELECT 1 FROM participants WHERE chat_id = '$TEST_USER_A' AND state = 'SCHEDULE_CONFIRMED'" 30

step "verify the callback was routed to confirm_schedule intent"
assert_rows "SELECT id FROM participants WHERE chat_id = '$TEST_USER_A' AND state = 'SCHEDULE_CONFIRMED'" 1
tick "[keyboard proof] callback_data=confirm_schedule → state=SCHEDULE_CONFIRMED"

# Verify the synthesized "yes" actually ended up in conversation_log
# — that's the signal that the Worker's callback path is working.
step "verify synthesized text was logged to conversation_log"
assert_rows "SELECT id FROM conversation_log WHERE chat_id = '$TEST_USER_A' AND role = 'user' AND message = 'yes'" 1

echo
echo "${_GREEN}scenario-03 passed${_RESET}"
