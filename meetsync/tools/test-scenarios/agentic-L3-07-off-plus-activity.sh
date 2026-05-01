#!/bin/bash
# L3.7 — OFF + activity coexistence on the same date.
#
# Encoding rule (turn-handler.ts buildSystemPrompt, "OFF day with activities"
# bullet): a single date may carry BOTH a 00:00–00:00 OFF marker AND one or
# more partial-busy entries. The OFF marker means "off from work / main
# commitment"; the partials are personal activities ON that off day. NOT
# contradictory.
#
# Persona requirement: when describing such a day, the bot MUST mention
# both the OFF status AND the activity in the same reply — never collapse
# to just "you're working 6–7pm" (loses OFF) or just "you're free all day"
# (loses gym block).
#
# This scenario seeds a schedule with an OFF + gym pair on a Tuesday,
# asks "what's my Tuesday look like?", and judges the reply. Catches
# regressions in: parser dedupe, snapshot rendering (formatDayEntries),
# system-prompt encoding rules, and the persona's natural-language reply
# path.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users
seed_user "$TEST_USER_A" "Sam" "en"

# Pick a Tuesday well in the future so it's never "today" (avoids
# tense ambiguity in the judge prompt). 2026-05-12 is a Tuesday.
SCHEDULE='[
  {"date":"2026-05-12","start_time":"00:00","end_time":"00:00","label":"off"},
  {"date":"2026-05-12","start_time":"18:00","end_time":"19:00","label":"gym"}
]'
seed_schedule "$TEST_USER_A" "$SCHEDULE"

section "Ask 'what's my Tuesday 12 May look like?' — bot must mention BOTH OFF and gym"
send_and_judge "$TEST_USER_A" \
  "what's my Tuesday 12 May look like?" \
  "the reply mentions BOTH that the user is off (or off work / off from work / day off / rest day / similar) on Tuesday AND that they have gym at 18:00–19:00 (or 6–7pm or 6pm–7pm). The reply must NOT say only 'you're working 6–7pm' (which loses the off status) and must NOT say only 'you're fully free' or 'free all day' (which loses the gym block). Both pieces of info must be present."

echo
echo "${_GREEN}L3.7 passed${_RESET} — OFF + activity coexistence preserved in reply"
