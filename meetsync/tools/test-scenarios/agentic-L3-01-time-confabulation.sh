#!/bin/bash
# L3.1 — time confabulation regression.
#
# Persona line 111: "when stating a specific time (e.g. 'you finish at
# midnight'), re-check against [STATE]. 15:00–00:00 ≠ 17:00–02:00."
#
# We seed a 17:00-02:00 shift (late night, crossing midnight — encoded as
# two segments: 17:00-23:59 on Sun + 00:00-02:00 on Mon). Ask when the
# shift ends. Bot must answer 02:00 (Mon) — not midnight.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users
seed_user "$TEST_USER_A" "Alex" "en"
# Shift spans midnight → two entries, same label for continuity.
seed_schedule "$TEST_USER_A" '[{"date":"2026-04-26","start_time":"17:00","end_time":"23:59","label":"work"},{"date":"2026-04-27","start_time":"00:00","end_time":"02:00","label":"work"}]'

section "Ask when Sunday's shift ends"
send_and_judge "$TEST_USER_A" "what time do I finish work on Sunday the 26th?" \
  "Bot says the shift ends at 02:00 (or 2am) on Monday, NOT midnight. It must correctly read the overnight shift as continuing past midnight." \
  45

echo
echo "${_GREEN}L3.1 passed${_RESET} — overnight shift end not confabulated"
