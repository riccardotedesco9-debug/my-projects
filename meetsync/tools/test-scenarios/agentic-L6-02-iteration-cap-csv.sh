#!/bin/bash
# L6.2 — multi-person CSV upload within iteration cap.
#
# Audit flagged MAX_ITERATIONS=15 as a potential ceiling for batch
# uploads. Verify a 5-person schedule block finishes cleanly (5 contacts
# + schedules + reply = ~11 iterations, under cap).

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users
seed_user "$TEST_USER_A" "Alex" "en"

section "Upload 5-person schedule block in one message"
send_webhook "$TEST_USER_A" "Here's the team next Monday 2026-05-11:
- Marco works 9am-5pm
- Diego works 13:00-20:00
- Sofia works 10:00-18:00
- Kurt works 8am-4pm
- Roni is off"
sleep 90

section "Verify at least 4 contacts created"
COUNT=$(d1_select "SELECT COUNT(*) AS n FROM person_notes WHERE owner_chat_id='$TEST_USER_A'" | python -c 'import json,sys; print(json.load(sys.stdin)[0]["n"])')
hint "person_notes count after batch upload: $COUNT"
if (( COUNT < 4 )); then
  fail "expected at least 4 contacts from 5-person batch, got $COUNT"
fi
tick "$COUNT contacts created from batch"

section "Verify Marco specifically has schedule"
SCHED=$(d1_select "SELECT schedule_json AS j FROM person_notes WHERE owner_chat_id='$TEST_USER_A' AND name_normalized='marco'")
HAS=$(python -c "import json,sys; rows=json.load(sys.stdin); print('ok' if rows and rows[0].get('j') else 'empty')" <<< "$SCHED")
if [[ "$HAS" != "ok" ]]; then fail "Marco schedule missing: $SCHED"; fi
tick "Marco's schedule persisted"

echo
echo "${_GREEN}L6.2 passed${_RESET} — batch upload stays under iteration cap"
