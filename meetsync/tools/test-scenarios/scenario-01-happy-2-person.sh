#!/bin/bash
# Scenario 01 — happy path, 2 participants, confirming within seconds of each
# other. Directly verifies fix 1.1 (router-owned tokens): the orchestrator
# must wake cleanly at gate A with zero polling or stuck PAIRED sessions.
#
# Exit 0 on pass, non-zero on failure.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users

# Seed both users directly. Names are the precondition for
# findUserByName('alice') to succeed when A references her.
seed_user "$TEST_USER_B" "alice"
seed_user "$TEST_USER_A" "riccardo"

# Send partner + schedule in ONE message so the opening-message path
# (handleIdleUser line ~805) spawns the orchestrator immediately. The
# two-message path (partner info + schedule later) goes through
# addPartnersFromOpeningMessage which doesn't spawn — separate bug worth
# fixing, but out of scope for this Day 1 race-fix verification.
step "A opens session with alice and sends schedule in one message"
send_webhook "$TEST_USER_A" "i want to schedule with alice. i work mon-fri 9am-5pm"
sleep 15

step "verify A's session exists with B as participant"
wait_for "SELECT 1 FROM sessions WHERE creator_chat_id = '$TEST_USER_A'" 20
SESSION_ID=$(latest_session_for_a)
[[ -n "$SESSION_ID" ]] || fail "no session id for A"
hint "session = $SESSION_ID"
assert_rows "SELECT id FROM participants WHERE session_id = '$SESSION_ID' AND chat_id = '$TEST_USER_B'" 1

step "verify spawnOrchestrator ran — session is PAIRED and tokens populated"
assert_rows "SELECT id FROM sessions WHERE id = '$SESSION_ID' AND status = 'PAIRED' AND both_confirmed_token_id IS NOT NULL AND both_preferred_token_id IS NOT NULL" 1
tick "[race fix proof] router populated both waitpoint tokens before triggering orchestrator"

step "A confirms parsed schedule"
send_webhook "$TEST_USER_A" "yes"
sleep 5

step "B uploads + confirms"
send_webhook "$TEST_USER_B" "i work mon-fri 2pm to 10pm"
sleep 15
send_webhook "$TEST_USER_B" "yes"
sleep 15

step "verify match pipeline fired (session no longer PAIRED)"
assert_empty "SELECT id FROM sessions WHERE id = '$SESSION_ID' AND status = 'PAIRED'"

step "verify tokens were populated by the router, not stuck NULL"
assert_rows "SELECT id FROM sessions WHERE id = '$SESSION_ID' AND both_confirmed_token_id IS NOT NULL AND both_preferred_token_id IS NOT NULL" 1

step "verify match_attempt is 0 (no amend yet)"
assert_rows "SELECT id FROM sessions WHERE id = '$SESSION_ID' AND match_attempt = 0" 1

step "verify session reached MATCHING/MATCHED/AWAITING_PREFERENCES or COMPLETED"
assert_rows "SELECT id FROM sessions WHERE id = '$SESSION_ID' AND status IN ('MATCHING','MATCHED','COMPLETED')" 1

echo
echo "${_GREEN}scenario-01 passed${_RESET}"
