#!/bin/bash
# L8.1 — observability: the new [snapshot] log line actually emits.
#
# Today's hardening added a per-turn log:
#   [snapshot] chat=X targets=N events=N degraded=true|false
# We can't read Trigger.dev traces from bash directly, but we CAN trigger
# a turn and verify it completed within typical window — then prompt the
# operator to verify the log line in the Trigger dashboard.
#
# This scenario primarily proves the turn completes cleanly with the new
# logging code path active. The actual log-line grep is a manual step.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users
seed_user "$TEST_USER_A" "Alex" "en"
seed_schedule "$TEST_USER_A" '[{"date":"2026-05-20","start_time":"09:00","end_time":"17:00","label":"work"}]'

section "Fire a turn to populate trace"
send_webhook "$TEST_USER_A" "what's my schedule on May 20th?"
sleep 25

section "Verify bot replied (proves turn-handler ran to completion)"
REPLY=$(last_bot_reply "$TEST_USER_A")
if [[ -z "$REPLY" ]]; then fail "no bot reply — turn-handler did not complete"; fi
tick "turn completed: ${REPLY:0:80}..."

hint "MANUAL: verify the Trigger.dev run log contains:"
hint "  [snapshot] chat=$TEST_USER_A targets=1 events=0 degraded=false"
hint "Dashboard: https://cloud.trigger.dev/projects/v3/proj_njxprjwjwpnxifasacvr/runs"

echo
echo "${_GREEN}L8.1 passed${_RESET} — turn completed (verify log line manually)"
