#!/bin/bash
# L4.8 — Out-of-window history retrieval via query_schedule_history.
#
# Motivator: with the per-date merge fix, full schedule history is kept
# forever in users.latest_schedule_json. To keep snapshot tokens bounded
# the [STATE] block only inlines today−14d → today+60d. Anything older
# (or further future) is reachable via the new query_schedule_history
# tool. This scenario seeds shifts at three positions — far past, active
# window, far future — and verifies the bot recalls each on demand.
#
# Catches regressions in: window math (turn-handler-snapshot constants),
# tool wiring (TOOL_DEFINITIONS includes queryScheduleHistoryTool),
# system prompt nudge ("call query_schedule_history for out-of-window
# dates"), executor (filter by date range from the JSON blob).

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users
seed_user "$TEST_USER_A" "Sam" "en"

# Three buckets:
#   - 90 days ago: far past, OUTSIDE window
#   - 7 days from now: INSIDE window (sanity baseline)
#   - 120 days from now: far future, OUTSIDE window
#
# Date math runs once at seed time so the scenario stays deterministic
# vs. the bot's "today" anchor when it processes the turns.
PAST_DATE=$(python -c 'import datetime as dt; print((dt.date.today() - dt.timedelta(days=90)).isoformat())')
NOW_DATE=$(python -c 'import datetime as dt; print((dt.date.today() + dt.timedelta(days=7)).isoformat())')
FUTURE_DATE=$(python -c 'import datetime as dt; print((dt.date.today() + dt.timedelta(days=120)).isoformat())')

SCHEDULE=$(python -c "
import json, sys
shifts = [
  {'date': '$PAST_DATE',   'start_time': '09:00', 'end_time': '17:00', 'label': 'work-historic'},
  {'date': '$NOW_DATE',    'start_time': '09:00', 'end_time': '17:00', 'label': 'work-current'},
  {'date': '$FUTURE_DATE', 'start_time': '14:00', 'end_time': '20:00', 'label': 'work-future'},
]
print(json.dumps(shifts))
")
seed_schedule "$TEST_USER_A" "$SCHEDULE"

section "Sanity: in-window query (no tool needed) — bot must surface the +7d shift directly"
send_and_judge "$TEST_USER_A" \
  "what's my schedule for $NOW_DATE?" \
  "the reply describes a working/busy slot starting around 09:00 (or 9am) on the requested date. The bot should NOT say it has no info for that date." \
  60

section "Past: out-of-window — bot must call query_schedule_history and recall the 90d-ago shift"
send_and_judge "$TEST_USER_A" \
  "did I work on $PAST_DATE? was 90 days ago" \
  "the reply confirms the user worked on that date with a shift starting around 09:00 (or 9am) and ending around 17:00 (or 5pm). The bot must NOT claim it doesn't have data that old or refuse to look it up — out-of-window history is supposed to be queryable on demand." \
  60

section "Future: out-of-window — bot must surface the 120d-ahead shift via the tool"
send_and_judge "$TEST_USER_A" \
  "do I have anything on $FUTURE_DATE? thats 120 days out" \
  "the reply mentions a shift on that date with hours around 14:00–20:00 (or 2pm–8pm). The bot must NOT claim there's nothing on file for a date that far out — history is preserved forever and reachable via the tool." \
  60

echo
echo "${_GREEN}L4.8 passed${_RESET} — out-of-window history is queryable both directions"
