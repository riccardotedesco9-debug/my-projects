#!/bin/bash
# L3.8 — Multi-upload merge: two separate-week uploads must coexist.
#
# Regression motivator: prior to the per-date merge fix, every parse_schedule
# call REPLACED users.latest_schedule_json wholesale. So if the user uploaded
# Mon–Wed, then later in the same chat uploaded Thu–Fri, the second upload
# wiped Mon–Wed silently — the user saw "schedule got mixed up from what it
# originally was". Fix: persistShifts now merges per-date (turn-handler-tools
# mergeShiftsByDate). Dates the new upload covers are owned by the new
# upload; everything else is preserved.
#
# This scenario seeds Mon–Wed via parse_schedule, then sends a second text
# describing Thu–Fri, and asks the bot what the full week looks like. The
# judge requires the reply to surface ALL FIVE weekdays.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users
seed_user "$TEST_USER_A" "Sam" "en"

# Use a future week so dates aren't ambiguous around "today". 2026-05-11 is
# a Monday.
section "Upload week-1: Mon 11–Wed 13 May, 09:00–17:00"
send_and_judge "$TEST_USER_A" \
  "I work Mon 11 May 09:00–17:00, Tue 12 May 09:00–17:00, Wed 13 May 09:00–17:00" \
  "the bot acknowledges saving the schedule for those three days (Mon Tue Wed). It must NOT claim it has more days than what was sent." \
  60

section "Upload week-1 follow-up: Thu 14–Fri 15 May, 09:00–17:00"
send_and_judge "$TEST_USER_A" \
  "and Thu 14 May + Fri 15 May 09:00–17:00 too" \
  "the bot acknowledges saving Thu and Fri. It must NOT say the prior Mon–Wed days were wiped or replaced — those should still be on file." \
  60

section "Ask 'what does my week look like?' — bot must surface ALL FIVE days"
send_and_judge "$TEST_USER_A" \
  "what does my week look like 11–15 May?" \
  "the reply mentions a working/busy slot on EACH of the five weekdays Mon 11 May, Tue 12 May, Wed 13 May, Thu 14 May, Fri 15 May. If any of those five dates is missing or described as unknown/no-data, the test fails — the merge regression dropped earlier-uploaded days." \
  60

echo
echo "${_GREEN}L3.8 passed${_RESET} — multi-upload merge preserves earlier dates"
