#!/bin/bash
# L3.5 — schedule encoding: "free from noon" = 00:00-12:00 BUSY.
#
# Persona line 126: "'Free from noon' → store 00:00–12:00 busy, NOT
# 12:00–23:59". Easy to get wrong if Claude inverts the semantics.
#
# Upload text, then check the stored schedule_json encodes the morning
# as busy (not the afternoon).

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users
seed_user "$TEST_USER_A" "Alex" "en"

section "Upload 'free from noon Monday'"
send_webhook "$TEST_USER_A" "I'm free from noon on Monday 2026-05-11"
sleep 25

section "Verify schedule encodes 00:00-12:00 as BUSY, not 12:00-23:59"
SCHED=$(d1_select "SELECT latest_schedule_json AS j FROM users WHERE chat_id='$TEST_USER_A'")
VERDICT=$(python -c "
import json, sys
rows = json.loads(sys.argv[1])
if not rows or not rows[0].get('j'): print('empty'); sys.exit()
arr = json.loads(rows[0]['j'])
# Look for a 2026-05-11 entry.
day = [s for s in arr if s.get('date') == '2026-05-11']
if not day: print('no-entry'); sys.exit()
# Correct encoding: start=00:00 end=12:00 (morning busy). Wrong: start
# 12:00 end 23:59 (afternoon busy, implies morning free).
morning_busy = any(s.get('start_time') == '00:00' and s.get('end_time') in ('12:00','11:59') for s in day)
afternoon_busy = any(s.get('start_time') == '12:00' and s.get('end_time') in ('23:59','00:00') for s in day)
if morning_busy and not afternoon_busy:
  print('ok')
elif afternoon_busy:
  print('inverted')
else:
  print('unclear: ' + json.dumps(day))
" "$SCHED")

if [[ "$VERDICT" != "ok" ]]; then
  fail "schedule encoding wrong: $VERDICT (raw: $SCHED)"
fi
tick "'free from noon' encoded as 00:00-12:00 busy"

echo
echo "${_GREEN}L3.5 passed${_RESET} — schedule encoding correct"
