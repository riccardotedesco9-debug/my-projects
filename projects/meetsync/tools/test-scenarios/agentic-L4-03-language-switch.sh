#!/bin/bash
# L4.3 — user switches language mid-conversation.
# Bot should match the caller's language and update preferred_language.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users
seed_user "$TEST_USER_A" "Alex" "en"

section "Greet in Italian and ask a concrete question"
# Context-light Italian was confusing Sonnet. Make the Italian intent
# unambiguous by asking a concrete scheduling question in Italian; Sonnet
# should respond in Italian.
send_and_judge "$TEST_USER_A" "ciao! parlami in italiano per favore. che cosa puoi fare per me?" \
  "Bot replies in Italian, not English. Italian reply (anything using 'posso', 'ti aiuto', 'certo', 'programma', 'disponibilità' or similar Italian words) is a pass. A fully-English reply is a fail." \
  45

echo
echo "${_GREEN}L4.3 passed${_RESET} — language switch honoured"
