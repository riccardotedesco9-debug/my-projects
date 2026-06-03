#!/bin/bash
# L5.2 — corrupt schedule_json doesn't crash snapshot.
#
# The enrich path has a try/catch around JSON.parse; a corrupt row should
# result in overwrite-with-events behavior, not a thrown exception.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users
seed_user "$TEST_USER_A" "Alex" "en"
# Write garbage into latest_schedule_json.
d1_query "UPDATE users SET latest_schedule_json='this is not json {oops' WHERE chat_id='$TEST_USER_A'" >/dev/null
tick "seeded corrupt schedule_json"

section "Send any message — turn should complete without crashing"
send_and_judge "$TEST_USER_A" "hey — what do you know about my schedule?" \
  "Bot replies coherently without crashing. It may say it doesn't have a schedule on file, or suggest uploading one. A silent timeout / no reply is a hard fail." \
  45

echo
echo "${_GREEN}L5.2 passed${_RESET} — corrupt schedule_json survived"
