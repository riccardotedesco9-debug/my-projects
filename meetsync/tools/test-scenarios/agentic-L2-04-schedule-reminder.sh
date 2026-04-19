#!/bin/bash
# L2.4 — schedule_reminder / list_reminders / cancel_reminder happy path.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users
seed_user "$TEST_USER_A" "Alex" "en"

section "Create a reminder"
send_webhook "$TEST_USER_A" "Remind me tomorrow at 10am to water the plants"
sleep 20

section "Verify one PENDING reminders row exists"
assert_rows "SELECT id FROM reminders WHERE chat_id='$TEST_USER_A' AND status='PENDING'" 1

section "List reminders — bot should mention the plant reminder"
send_and_judge "$TEST_USER_A" "what reminders do I have?" \
  "Bot lists the plant-watering reminder scheduled for tomorrow morning." \
  30

section "Cancel it"
send_webhook "$TEST_USER_A" "cancel the plant reminder"
sleep 15

section "Verify the reminder is cancelled"
assert_rows "SELECT id FROM reminders WHERE chat_id='$TEST_USER_A' AND status='CANCELLED'" 1
assert_empty "SELECT id FROM reminders WHERE chat_id='$TEST_USER_A' AND status='PENDING'"

echo
echo "${_GREEN}L2.4 passed${_RESET} — reminders create/list/cancel work"
