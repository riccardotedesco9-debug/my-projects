#!/bin/bash
# L2.3 — compute_overlap (via "when are we free" query) returns
# human-readable overlap windows across the caller + their contacts.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users
seed_user "$TEST_USER_A" "Alex" "en"
seed_schedule "$TEST_USER_A" '[{"date":"2026-04-27","start_time":"09:00","end_time":"13:00","label":"work"}]'
seed_contact "$TEST_USER_A" "Marco"
d1_query "UPDATE person_notes SET schedule_json='[{\"date\":\"2026-04-27\",\"start_time\":\"14:00\",\"end_time\":\"20:00\",\"label\":\"work\"}]' WHERE owner_chat_id='$TEST_USER_A' AND name_normalized='marco'" >/dev/null

section "Ask when we're both free"
# Caller free 13:00-23:59, Marco free 00:00-14:00 and 20:00-23:59.
# Valid overlaps: 13:00-14:00 (short) OR 20:00+ (longer evening).
# Both are correct; bot usually picks the longer evening.
send_and_judge "$TEST_USER_A" "When am I free with Marco on 2026-04-27?" \
  "Bot identifies a valid overlap window on 2026-04-27. Either the 13:00-14:00 window (tight) or the 20:00 onwards window (evening) is correct. The bot must NOT claim they're both free during 09:00-13:00 (caller at work) or during 14:00-20:00 (Marco at work)." \
  45

echo
echo "${_GREEN}L2.3 passed${_RESET} — compute_overlap returns correct windows"
