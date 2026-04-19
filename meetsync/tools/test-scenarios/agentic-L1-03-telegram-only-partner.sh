#!/bin/bash
# L1.3 — booking with a Telegram-only partner (not /connect'd to GCal)
# must not be blocked.
#
# Regression for today's chat: bot refused to add an event to the caller's
# calendar because the partner wasn't on Telegram-with-OAuth. Fix: persona
# clarifies caller's own calendar never requires contact consent; tool path
# already created the caller's event unconditionally, persona just caught up.
#
# Driver: seed a contact with NO linked_chat_id (pure Telegram-only), ask
# the bot to book, assert the bot doesn't gatekeep on /connect.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users
seed_user "$TEST_USER_A" "Alex" "en"
seed_schedule "$TEST_USER_A" '[{"date":"2026-04-24","start_time":"00:00","end_time":"00:00","label":"off"}]'
# Deliberately NO linked_chat_id: pure Telegram-only contact.
seed_contact "$TEST_USER_A" "Marco"
d1_query "UPDATE person_notes SET schedule_json='[{\"date\":\"2026-04-24\",\"start_time\":\"00:00\",\"end_time\":\"12:00\",\"label\":\"work\"}]' WHERE owner_chat_id='$TEST_USER_A' AND name_normalized='marco'" >/dev/null

section "Book with Telegram-only partner"
send_and_judge "$TEST_USER_A" "Book coffee with Marco Friday 2026-04-24 at 3pm for an hour" \
  "Bot proceeds with the booking (or offers a single one-tap confirm). It does NOT gatekeep on Marco needing /connect as a precondition. Mentioning that Marco won't receive a calendar invite is acceptable; refusing to proceed is not." \
  60

echo
echo "${_GREEN}L1.3 passed${_RESET} — Telegram-only partner not a blocker"
