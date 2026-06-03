#!/bin/bash
# L5.3 — reminder atomic-lease pattern: a due reminder fires exactly once.
#
# Seed a reminder with fire_at just past now. Wait for the next cron tick
# (up to 5 min). Verify status transitions PENDING → FIRED (via FIRING
# briefly). Duplicate send would leave the reminder PENDING after the
# first fire; we assert no duplicates.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users
seed_user "$TEST_USER_A" "Alex" "en"

# Seed a one-shot reminder fire_at=now-60 (already overdue).
RID="test-reminder-$(date +%s)"
PAST=$(( $(date +%s) - 60 ))
d1_query "INSERT INTO reminders (id, chat_id, text, fire_at, status, timezone) VALUES ('$RID', '$TEST_USER_A', 'L5.3 test reminder', $PAST, 'PENDING', 'Europe/Malta')" >/dev/null
tick "seeded overdue reminder $RID"

section "Wait for fire-reminders cron to tick (up to 6 min)"
wait_for "SELECT id FROM reminders WHERE id='$RID' AND status='FIRED'" 360

section "Verify exactly one FIRED row, no duplicates"
assert_rows "SELECT id FROM reminders WHERE id='$RID' AND status='FIRED'" 1
assert_empty "SELECT id FROM reminders WHERE id='$RID' AND status IN ('PENDING','FIRING')"

echo
echo "${_GREEN}L5.3 passed${_RESET} — reminder fired once and settled to FIRED"
