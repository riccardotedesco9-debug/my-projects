#!/bin/bash
# L4.1 — empty state: new user, no schedule, no contacts, no calendar.
# Bot should not hallucinate availability or claim facts not in [STATE].

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users
seed_user "$TEST_USER_A" "Alex" "en"

section "Empty-state 'who's free?'"
send_and_judge "$TEST_USER_A" "who's free tomorrow?" \
  "Bot does NOT invent contact names or availability. It acknowledges there are no contacts on file and/or no schedule yet, and may ask the user to add someone or share a schedule. Hallucinating names is a hard fail." \
  45

echo
echo "${_GREEN}L4.1 passed${_RESET} — empty state handled gracefully"
