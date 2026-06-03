#!/bin/bash
# L3.10 — Vacation upload must AUGMENT, not WIPE, prior partial-busy
# entries on the same dates.
#
# Regression motivator: prior to the fix at turn-handler-tools.ts
# mergeShiftsByDate (round 2 of the 2026-05-08 bug-fix sweep), a vacation
# declaration "I'm on vacation Mon–Fri" produced 5 OFF entries (00:00–
# 00:00) which the per-date REPLACE merge used to drop EVERY existing
# entry on those dates — including a doctor's appointment on Wed and any
# meetup busy-block previously written via book_meetup. The user
# experienced this as "the bot forgot my appointment".
#
# The fix: when ALL new entries on a date are OFF-only, augment instead
# of replace — preserve existing partial-busy entries, drop just the
# duplicate OFF.
#
# This scenario seeds a Wed doctor's appointment, declares vacation
# Mon–Fri, then verifies the doctor entry still exists on disk AND
# surfaces in the bot's reply when asked about Wed.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users
seed_user "$TEST_USER_A" "Sam" "en"

# Pre-seed Wed 13 May 2026 with a doctor's appointment (partial busy).
# This is the entry the vacation upload must NOT wipe.
SCHEDULE='[{"date":"2026-05-13","start_time":"14:00","end_time":"15:00","label":"doctor"}]'
seed_schedule "$TEST_USER_A" "$SCHEDULE"

section "Declare vacation Mon 11 May to Fri 15 May 2026"
send_and_judge "$TEST_USER_A" \
  "I'm on vacation Mon 11 May to Fri 15 May" \
  "the bot acknowledges the vacation. It must NOT say it cleared / wiped / replaced existing appointments. It must NOT ask the user to re-add the doctor's appointment." \
  60

section "D1 check: Wed 13 May still has the doctor entry"
ROWS=$(d1_select "SELECT latest_schedule_json FROM users WHERE chat_id='$TEST_USER_A'")
HAS_DOCTOR=$(python -c '
import json, sys
rows = json.loads(sys.argv[1])
if not rows:
  print("0"); sys.exit()
sched = json.loads(rows[0]["latest_schedule_json"])
hit = [s for s in sched if s.get("date") == "2026-05-13" and s.get("start_time") == "14:00" and s.get("end_time") == "15:00"]
print("1" if hit else "0")
' "$ROWS")
if [[ "$HAS_DOCTOR" != "1" ]]; then
  fail "vacation upload wiped the Wed 13 May 14:00–15:00 doctor entry — augment regression"
fi
tick "Wed 13 May still has doctor 14:00–15:00 in latest_schedule_json"

# Also confirm the OFF marker for Wed was added (vacation was actually persisted).
HAS_WED_OFF=$(python -c '
import json, sys
rows = json.loads(sys.argv[1])
sched = json.loads(rows[0]["latest_schedule_json"])
hit = [s for s in sched if s.get("date") == "2026-05-13" and s.get("start_time") == "00:00" and s.get("end_time") == "00:00"]
print("1" if hit else "0")
' "$ROWS")
if [[ "$HAS_WED_OFF" != "1" ]]; then
  fail "vacation OFF marker for Wed 13 May was not persisted — vacation never landed"
fi
tick "Wed 13 May has BOTH the OFF marker and the doctor entry"

section "Bot must surface BOTH OFF and doctor when asked about Wed"
send_and_judge "$TEST_USER_A" \
  "what's my Wed 13 May look like" \
  "the bot's reply mentions BOTH that Wed is off / on vacation / not at work AND that there's a doctor appointment around 2pm (14:00 / 14–15). If the reply only says 'off' or only says 'doctor' — it's a partial regression. If the reply says 'nothing on file' or denies the appointment, the augment fix has broken." \
  60

echo
echo "${_GREEN}L3.10 passed${_RESET} — vacation augments, doesn't wipe"
