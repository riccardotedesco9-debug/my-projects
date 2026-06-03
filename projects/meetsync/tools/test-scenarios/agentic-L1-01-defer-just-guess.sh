#!/bin/bash
# L1.1 — "just guess" defer handling.
#
# Regression for today's chat (2026-04-19): bot kept re-asking for specifics
# after the user said "yes guess" / "I dunno just book it". Fix: persona now
# treats defer as explicit permission to pick a sensible default, and the
# book_meetup tool description authorises Claude to choose concrete values.
#
# Assertion path: send "you pick" after the bot has been shown a date range
# of candidates. Judge the reply: did the bot commit to a specific slot and
# either book or offer a one-tap confirm, WITHOUT re-asking what time?

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users
seed_user "$TEST_USER_A" "Alex" "en"
seed_schedule "$TEST_USER_A" '[{"date":"2026-04-20","start_time":"09:00","end_time":"13:00","label":"work"},{"date":"2026-04-21","start_time":"14:00","end_time":"20:00","label":"work"}]'
seed_contact "$TEST_USER_A" "Kristina"
seed_contact "$TEST_USER_A" "Kristina" "" "" 2>/dev/null || true
# Give Kristina a schedule directly on person_notes so Claude has real
# overlap data to pick from.
d1_query "UPDATE person_notes SET schedule_json='[{\"date\":\"2026-04-20\",\"start_time\":\"13:00\",\"end_time\":\"20:00\",\"label\":\"work\"},{\"date\":\"2026-04-21\",\"start_time\":\"00:00\",\"end_time\":\"14:00\",\"label\":\"off\"}]' WHERE owner_chat_id='$TEST_USER_A' AND name_normalized='kristina'" >/dev/null

section "Turn 1 — ask when we're free with Kristina"
send_and_judge "$TEST_USER_A" "When am I free with Kristina next Monday or Tuesday?" \
  "Bot lists specific free windows for Monday and/or Tuesday with Kristina, using concrete times." \
  45

section "Turn 2 — defer ('you pick, just guess')"
# The regression: bot should pick + proceed, NOT re-ask "what time works?".
send_and_judge "$TEST_USER_A" "you pick, just guess" \
  "Bot commits to a specific date and time slot (or offers a single one-tap Confirm button) and does NOT re-ask the user what time they'd prefer. Booking directly is also acceptable." \
  60

echo
echo "${_GREEN}L1.1 passed${_RESET} — defer handling works"
