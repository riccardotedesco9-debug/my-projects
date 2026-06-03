#!/bin/bash
# L3.12 — Adding a shift on a date that already has a personal block
# (or vice versa) must AUGMENT, not WIPE, when the time windows don't
# overlap.
#
# Regression motivator: user complaint 2026-05-08 — "Friday I had
# exercising as well, you booked work and overwrote it". The previous
# per-date REPLACE merge silently dropped the exercising entry the
# moment a non-overlapping work shift was added.
#
# Fix: mergeShiftsByDate is now overlap-driven. Existing entries on a
# date covered by a new upload are kept unless they overlap in time
# with a new entry (correction semantics). Non-overlapping entries
# coexist on the same date.
#
# Seeds Fri 22 May 2026 with exercising 18:00–19:00, then sends "I'm
# working Fri 22 May 09:00–17:00" — a NON-overlapping addition. After
# the merge, BOTH entries must remain on Fri.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users
seed_user "$TEST_USER_A" "Sam" "en"

# Pre-seed Fri 22 May 2026 with exercising 18:00–19:00.
SCHEDULE='[{"date":"2026-05-22","start_time":"18:00","end_time":"19:00","label":"exercising"}]'
seed_schedule "$TEST_USER_A" "$SCHEDULE"

section "Add Fri 22 May work shift 09:00–17:00 (non-overlapping with existing exercising)"
send_and_judge "$TEST_USER_A" \
  "I'm working Fri 22 May 09:00 to 17:00" \
  "the bot acknowledges the work shift. It must NOT say it cleared / replaced the exercising block. It must NOT ask the user to re-add exercising." \
  60

section "D1 check: Fri 22 May has BOTH exercising 18-19 AND work 09-17"
ROWS=$(d1_select "SELECT latest_schedule_json FROM users WHERE chat_id='$TEST_USER_A'")
HAS_BOTH=$(python -c '
import json, sys
rows = json.loads(sys.argv[1])
if not rows or not rows[0].get("latest_schedule_json"):
  print("0,0,empty"); sys.exit()
sched = json.loads(rows[0]["latest_schedule_json"])
fri = [s for s in sched if s.get("date") == "2026-05-22"]
has_ex = any(s.get("start_time") == "18:00" and s.get("end_time") == "19:00" for s in fri)
has_work = any(s.get("start_time") == "09:00" and s.get("end_time") == "17:00" for s in fri)
print(f"{int(has_ex)},{int(has_work)},{len(fri)}")
' "$ROWS")
EX=$(echo "$HAS_BOTH" | cut -d, -f1)
WORK=$(echo "$HAS_BOTH" | cut -d, -f2)
COUNT=$(echo "$HAS_BOTH" | cut -d, -f3)
if [[ "$EX" != "1" ]]; then
  fail "Fri 22 May exercising 18:00–19:00 was wiped — augment regression. Found $COUNT entries on Fri."
fi
if [[ "$WORK" != "1" ]]; then
  fail "Fri 22 May work 09:00–17:00 was not persisted. Found $COUNT entries on Fri."
fi
tick "Fri 22 May has both exercising and work entries ($COUNT total)"

section "Bot must surface BOTH entries when asked about Fri"
send_and_judge "$TEST_USER_A" \
  "what's my Fri 22 May look like" \
  "the bot's reply mentions BOTH the work shift around 9 to 5 (or 09:00 to 17:00) AND the exercising block around 6 to 7pm (or 18:00 to 19:00). If only one is mentioned, the augment fix has regressed." \
  60

echo
echo "${_GREEN}L3.12 passed${_RESET} — non-overlapping additions coexist on the same date"
