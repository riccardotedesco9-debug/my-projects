#!/bin/bash
# L3.4 — travel-time reasoning based on stored location.
#
# Persona line 150/154: contact stored facts ("lives in Gozo") should
# factor into suggested meeting times via realistic Malta commute.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users
seed_user "$TEST_USER_A" "Alex" "en"
seed_schedule "$TEST_USER_A" '[{"date":"2026-05-04","start_time":"00:00","end_time":"00:00","label":"off"}]'
seed_contact "$TEST_USER_A" "Kurt"
# Kurt lives in Gozo, finishes work at 15:30 on the day in question.
d1_query "UPDATE person_notes SET schedule_json='[{\"date\":\"2026-05-04\",\"start_time\":\"08:00\",\"end_time\":\"15:30\",\"label\":\"work in Victoria, Gozo\"}]', notes='Lives in Gozo; commutes via ferry.' WHERE owner_chat_id='$TEST_USER_A' AND name_normalized='kurt'" >/dev/null

section "Ask whether 4pm Valletta meet works"
send_and_judge "$TEST_USER_A" "can Kurt meet me in Valletta at 4pm on 2026-05-04?" \
  "Bot factors in the ferry-and-drive commute from Gozo to Valletta, noting 4pm is probably too tight after a 3:30pm finish. It should suggest a later time (e.g. 5pm or after) or explicitly acknowledge the travel time. Blind 'yes, 4pm is fine' is a fail." \
  45

echo
echo "${_GREEN}L3.4 passed${_RESET} — travel-time reasoning engaged"
