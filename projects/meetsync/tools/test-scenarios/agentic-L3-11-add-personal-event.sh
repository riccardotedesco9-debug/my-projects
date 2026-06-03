#!/bin/bash
# L3.11 — One-off future occasions mentioned in chat must be persisted
# via add_personal_event so they survive the nightly conversation_log
# prune (50 rows/chat). Without this tool, the bot used to reply "got
# it!" and the mention lived only in chat history — forgotten in 1–2
# days. This was the recurring "bot forgot my X AGAIN" bug.
#
# Regression motivator: the fix added the add_personal_event tool
# (turn-handler-tools.ts) and a system-prompt paragraph at
# turn-handler.ts:127 instructing Claude to call it whenever the caller
# mentions a specific dated future commitment that isn't a shift rota
# or a meetup with named attendees.
#
# This scenario tells the bot about dad's 60th on a Saturday, then in a
# follow-up turn asks "anything Saturday?" and verifies the bot recalls
# it. It also asserts the entry landed in latest_schedule_json (the
# durable surface), not just in chat history.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users
seed_user "$TEST_USER_A" "Sam" "en"

# Sat 16 May 2026 — well within the 60d snapshot window from today.
EVENT_DATE="2026-05-16"

section "Tell the bot about dad's 60th — a one-off occasion"
send_and_judge "$TEST_USER_A" \
  "I have my dad's 60th birthday Saturday 16 May at 7pm — don't let me forget" \
  "the bot acknowledges the birthday warmly. It must NOT just say 'noted' without persisting (the fix requires a tool call). It must NOT ask the user to RSVP, re-confirm, or add it to a separate calendar manually." \
  60

section "D1 check: latest_schedule_json contains a Sat 16 May entry around 19:00"
ROWS=$(d1_select "SELECT latest_schedule_json FROM users WHERE chat_id='$TEST_USER_A'")
HAS_EVENT=$(python -c '
import json, sys
rows = json.loads(sys.argv[1])
if not rows or not rows[0].get("latest_schedule_json"):
  print("0"); sys.exit()
sched = json.loads(rows[0]["latest_schedule_json"])
hit = [s for s in sched if s.get("date") == "'"$EVENT_DATE"'" and s.get("start_time","").startswith("19")]
print("1" if hit else "0")
' "$ROWS")
if [[ "$HAS_EVENT" != "1" ]]; then
  echo "  ${_DIM}schedule_json: ${ROWS:0:300}${_RESET}"
  fail "bot did not persist dad'\''s 60th to latest_schedule_json — add_personal_event was not called or did not land"
fi
tick "Sat 16 May entry around 19:00 found in latest_schedule_json"

section "Follow-up: ask the bot about Saturday — must recall the birthday"
send_and_judge "$TEST_USER_A" \
  "anything saturday 16 may?" \
  "the bot's reply mentions the dad's 60th birthday around 7pm. If the bot says 'nothing on file' or 'looks free' or asks 'which Saturday?' the persistence has failed and the recurring forgot-occasions bug has come back." \
  60

echo
echo "${_GREEN}L3.11 passed${_RESET} — add_personal_event persists one-off occasions"
