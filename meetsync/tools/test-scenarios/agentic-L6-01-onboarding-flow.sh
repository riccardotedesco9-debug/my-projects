#!/bin/bash
# L6.1 — end-to-end onboarding: name → schedule → contact → overlap.
#
# Covers the fresh-user golden path, exercises several tools in sequence,
# and verifies D1 side effects accumulate correctly.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users
# Deliberately do NOT seed a user — let the webhook path register one.

section "Turn 1 — introduce self"
send_webhook "$TEST_USER_A" "Hey, I'm Alex"
sleep 15

section "Turn 2 — upload schedule"
send_webhook "$TEST_USER_A" "I work Monday to Thursday 9am-5pm"
sleep 25

section "Verify schedule landed"
SCHED=$(d1_select "SELECT latest_schedule_json AS j FROM users WHERE chat_id='$TEST_USER_A'")
COUNT=$(python -c "
import json, sys
rows = json.loads(sys.argv[1])
if not rows or not rows[0].get('j'): print(0); sys.exit()
arr = json.loads(rows[0]['j'])
busy = [s for s in arr if not (s.get('start_time') == '00:00' and s.get('end_time') == '00:00')]
print(len(busy))" "$SCHED")
if (( COUNT < 4 )); then fail "expected at least 4 weekday shifts, got $COUNT"; fi
tick "schedule has $COUNT busy shifts"

section "Turn 3 — add contact + their schedule"
send_webhook "$TEST_USER_A" "My friend Sofia works weekends — saturdays 10-6 and sundays 12-8"
sleep 25

section "Verify Sofia row + schedule"
assert_rows "SELECT id FROM person_notes WHERE owner_chat_id='$TEST_USER_A' AND name_normalized='sofia'" 1
SOFIA=$(d1_select "SELECT schedule_json AS j FROM person_notes WHERE owner_chat_id='$TEST_USER_A' AND name_normalized='sofia'")
SOFIA_HAS=$(python -c "
import json, sys
rows = json.loads(sys.argv[1])
if not rows or not rows[0].get('j'): print('empty'); sys.exit()
print('has-schedule' if json.loads(rows[0]['j']) else 'empty')
" "$SOFIA")
if [[ "$SOFIA_HAS" != "has-schedule" ]]; then fail "Sofia's schedule missing"; fi
tick "Sofia's schedule captured"

section "Turn 4 — ask for overlap"
send_and_judge "$TEST_USER_A" "when are Sofia and I both free next weekend?" \
  "Bot describes overlap windows for the weekend based on both schedules. Alex is off weekends (no busy shifts), Sofia busy in the day, so evenings should be free on Saturday/Sunday. Bot should reference concrete times in those windows."

echo
echo "${_GREEN}L6.1 passed${_RESET} — onboarding → schedule → contact → overlap works end-to-end"
