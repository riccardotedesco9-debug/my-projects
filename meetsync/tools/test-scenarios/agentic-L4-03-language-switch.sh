#!/bin/bash
# L4.3 — user switches language mid-conversation.
# Bot should match the caller's language and update preferred_language.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users
seed_user "$TEST_USER_A" "Alex" "en"

section "Greet in English"
send_webhook "$TEST_USER_A" "hey how are you"
sleep 15

section "Switch to Italian"
send_and_judge "$TEST_USER_A" "possiamo parlare in italiano d'ora in poi?" \
  "Bot replies in Italian (e.g. 'certo', 'ok', 'volentieri'), not English. Acknowledging the switch and continuing in English is a fail." \
  45

echo
echo "${_GREEN}L4.3 passed${_RESET} — language switch honoured"
