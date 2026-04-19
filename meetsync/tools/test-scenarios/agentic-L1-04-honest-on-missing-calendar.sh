#!/bin/bash
# L1.4 — when the caller's Google Calendar isn't connected, the bot must
# say so honestly and not hallucinate availability for calendar-only events.
#
# Regression for today's chat: Riccardo asked about his therapy appt on
# the 20th (on Google Calendar, unaccepted invite). Bot didn't know. Several
# causes were possible: silent fetch failure, filter drop, or no OAuth at all.
#
# This scenario exercises the "no OAuth" case: test user has no google_tokens
# row. The snapshot flags `callerCalendarConnected: false`. Bot should not
# assert certainty about calendar-only events — it should admit it has no
# calendar data for the caller.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users
seed_user "$TEST_USER_A" "Alex" "en"
seed_schedule "$TEST_USER_A" '[{"date":"2026-04-25","start_time":"00:00","end_time":"00:00","label":"off"}]'

section "Ask about a specific appointment that would only live on Google Calendar"
send_and_judge "$TEST_USER_A" "When's my dentist appointment on the 25th?" \
  "Bot admits it doesn't have that appointment on file, or tells the user it doesn't see their Google Calendar connected. It does NOT assert 'you're free all day' as if it could see the calendar. Suggesting /connect is acceptable but not required." \
  45

echo
echo "${_GREEN}L1.4 passed${_RESET} — bot honest about missing calendar data"
