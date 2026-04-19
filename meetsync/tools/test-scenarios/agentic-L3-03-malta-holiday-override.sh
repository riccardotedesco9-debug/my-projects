#!/bin/bash
# L3.3 — Malta public holiday override.
#
# Persona line 156: when a stored schedule shows "work" on a Malta public
# holiday, bot should flag the holiday as "almost certainly stale" and
# treat the day as likely FREE.
#
# Seed a "work" shift on 2026-12-13 (Republic Day). Ask if the user is
# free. Bot should mention the holiday.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users
seed_user "$TEST_USER_A" "Alex" "en"
# Dec 13 2026 = Republic Day (Malta public holiday).
seed_schedule "$TEST_USER_A" '[{"date":"2026-12-13","start_time":"09:00","end_time":"17:00","label":"work"}]'

section "Ask about Republic Day availability"
send_and_judge "$TEST_USER_A" "am I free on the 13th of December?" \
  "Bot mentions that the date is a Malta public holiday (Republic Day) and flags the stored 'work' shift as likely stale — suggesting the user is probably off or asking to confirm. Simply saying 'you're working 9-5' without flagging the holiday is a fail." \
  45

echo
echo "${_GREEN}L3.3 passed${_RESET} — Malta holiday override applied"
