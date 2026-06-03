#!/bin/bash
# L3.9 — Partial re-upload: re-uploading a single date replaces only that
# date, leaves all others untouched.
#
# Regression motivator: same root cause as L3.8 (REPLACE-everything in
# persistShifts). The merge fix uses per-date semantics so the user can
# correct one day's hours without rebuilding the whole schedule.
#
# Seeds Mon–Fri at 09:00–17:00, then re-uploads ONLY Wednesday with a
# different shift (12:00–20:00). Final state must show the new Wed shift
# AND the original Mon/Tue/Thu/Fri shifts intact.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users
seed_user "$TEST_USER_A" "Sam" "en"

# Pre-seed Mon–Fri 09:00–17:00 directly via D1 so the test starts from a
# known good state without depending on a parse_schedule prior turn.
SCHEDULE='[{"date":"2026-05-18","start_time":"09:00","end_time":"17:00","label":"work"},{"date":"2026-05-19","start_time":"09:00","end_time":"17:00","label":"work"},{"date":"2026-05-20","start_time":"09:00","end_time":"17:00","label":"work"},{"date":"2026-05-21","start_time":"09:00","end_time":"17:00","label":"work"},{"date":"2026-05-22","start_time":"09:00","end_time":"17:00","label":"work"}]'
seed_schedule "$TEST_USER_A" "$SCHEDULE"

section "Re-upload Wed 20 May only — different hours (12:00–20:00)"
send_and_judge "$TEST_USER_A" \
  "actually Wed 20 May I'm working 12:00–20:00 instead, can you update that" \
  "the bot acknowledges updating Wednesday's hours. It must NOT say the rest of the week was wiped or that it needs the user to re-upload Mon/Tue/Thu/Fri." \
  60

section "Verify: Wed has the NEW 12–20 shift, Mon/Tue/Thu/Fri keep 09–17"
send_and_judge "$TEST_USER_A" \
  "give me my Mon-Fri 18-22 May overview" \
  "the reply must show Wed 20 May with hours starting at 12 (noon) and ending at 20 (8pm). The OTHER FOUR days (Mon 18, Tue 19, Thu 21, Fri 22) must still show 09:00–17:00 (or 9–5 / 9am–5pm). If any of Mon/Tue/Thu/Fri is missing, marked 'unknown', or shows different hours, the partial-reupload regression has come back." \
  60

echo
echo "${_GREEN}L3.9 passed${_RESET} — partial re-upload replaces target date only"
