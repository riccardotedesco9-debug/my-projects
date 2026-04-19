#!/bin/bash
# L2.1 — parse_schedule (text mode) saves shifts correctly.
#
# User types a casual schedule description; bot should call parse_schedule
# and persist a JSON array on users.latest_schedule_json covering the
# expected days.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users
seed_user "$TEST_USER_A" "Alex" "en"

section "Send a casual text schedule"
send_webhook "$TEST_USER_A" "I work mon-fri 9am to 5pm next week"
# Give the turn handler time to parse + save. Text path uses Sonnet so
# finishes fast but Trigger.dev cold-start can add 5-10s.
sleep 20

section "Verify users.latest_schedule_json is populated with 5 weekday shifts"
SCHED=$(d1_select "SELECT latest_schedule_json AS j FROM users WHERE chat_id='$TEST_USER_A'")
COUNT=$(python -c "
import json, sys
rows = json.loads(sys.argv[1])
if not rows: print(0); sys.exit()
j = rows[0]['j']
if not j: print(0); sys.exit()
arr = json.loads(j)
# Count entries where start_time != 00:00 OR end_time != 00:00 (i.e. non-off)
busy = [s for s in arr if not (s.get('start_time') == '00:00' and s.get('end_time') == '00:00')]
print(len(busy))" "$SCHED")

hint "busy-shift count in parsed schedule: $COUNT"
if (( COUNT < 5 )); then
  fail "expected at least 5 weekday shifts, got $COUNT. Raw: $SCHED"
fi
tick "schedule parsed and persisted"

echo
echo "${_GREEN}L2.1 passed${_RESET} — parse_schedule (text) works"
