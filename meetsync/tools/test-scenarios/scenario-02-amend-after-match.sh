#!/bin/bash
# Scenario 02 — post-amend orchestrator orphan (fix 1.2). FLAKY.
#
# This scenario depends on a long chain of stochastic AI classifications:
#   intent(partner+schedule) → parse → confirm → parse (alice) → confirm
#   → amend-text classification → re-parse → re-confirm → checkAllConfirmed
#   Case B → restartOrchestratorForAmend → match_attempt++.
#
# Any single classification bailing (Claude Haiku intent classifier produces
# a different JSON shape under slight prompt variance) causes the flow to
# stall short of the amend path, giving a false failure that has nothing
# to do with the race fix.
#
# Known limitations:
#   - scenarios run against prod Claude, prod Trigger.dev, prod D1 — no
#     deterministic replay.
#   - sleep durations are tuned for typical latency; cold-start spikes bust
#     them.
#   - amend flow needs ~3 full LLM roundtrips to reach the assertion point.
#
# Until a direct-task-trigger harness exists (bypassing the conversational
# layer), this scenario should be treated as best-effort. Scenario-01 proves
# the core router-owned-tokens fix (1.1) deterministically; scenario-02 is
# supplementary evidence for fix 1.2 when the stars align.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users

# Seed B and A directly (see scenario-01 for rationale).
seed_user "$TEST_USER_B" "alice"
seed_user "$TEST_USER_A" "riccardo"

step "[phase 1] A opens session with alice + schedule in one message"
send_webhook "$TEST_USER_A" "i want to schedule with alice. i work mon-fri 9am-5pm"
sleep 15

wait_for "SELECT 1 FROM sessions WHERE creator_chat_id = '$TEST_USER_A'" 20
SESSION_ID=$(latest_session_for_a)
[[ -n "$SESSION_ID" ]] || fail "no session id for A"
hint "session = $SESSION_ID"
assert_rows "SELECT id FROM participants WHERE session_id = '$SESSION_ID' AND chat_id = '$TEST_USER_B'" 1

step "A confirms"
send_webhook "$TEST_USER_A" "yes"
sleep 5

step "B uploads + confirms (triggers match)"
send_webhook "$TEST_USER_B" "i work mon-fri 2pm to 10pm"
sleep 15
send_webhook "$TEST_USER_B" "yes"
sleep 18

step "verify match pipeline fired (not stuck in PAIRED/MATCHING)"
assert_empty "SELECT id FROM sessions WHERE id = '$SESSION_ID' AND status IN ('PAIRED','OPEN')"

# Capture pre-amend token IDs so we can verify rotation.
PRE_TOKEN=$(d1_select "SELECT both_confirmed_token_id as t FROM sessions WHERE id = '$SESSION_ID'" \
  | python -c 'import json,sys; print(json.load(sys.stdin)[0]["t"])')
hint "pre-amend confirmed_token_id = $PRE_TOKEN"

step "[phase 2] A amends schedule"
send_webhook "$TEST_USER_A" "actually i also work saturday 10am to 4pm, can you update that"
# Give the parser time to finish re-parsing the merged schedule. Parser
# involves a Claude Sonnet call on a 28-day lookup window → 10-20s realistic.
sleep 25

step "A re-confirms the amended schedule"
send_webhook "$TEST_USER_A" "yes"
sleep 20

step "verify match_attempt advanced (amend triggered fresh orchestrator)"
assert_rows "SELECT id FROM sessions WHERE id = '$SESSION_ID' AND match_attempt >= 1" 1

step "verify token IDs rotated (new tokens, not the pre-amend ones)"
POST_TOKEN=$(d1_select "SELECT both_confirmed_token_id as t FROM sessions WHERE id = '$SESSION_ID'" \
  | python -c 'import json,sys; rows=json.load(sys.stdin); print(rows[0]["t"] if rows and rows[0]["t"] else "")')
hint "post-amend confirmed_token_id = $POST_TOKEN"
if [[ -z "$POST_TOKEN" || "$POST_TOKEN" == "$PRE_TOKEN" ]]; then
  fail "confirmed_token_id did not rotate after amend (pre=$PRE_TOKEN, post=$POST_TOKEN)"
fi
tick "token rotated"

step "verify session is not stuck (status MATCHED or COMPLETED, not MATCHING forever)"
sleep 5
assert_empty "SELECT id FROM sessions WHERE id = '$SESSION_ID' AND status IN ('PAIRED','OPEN')"
assert_rows "SELECT id FROM sessions WHERE id = '$SESSION_ID' AND status IN ('MATCHING','MATCHED','COMPLETED')" 1

echo
echo "${_GREEN}scenario-02 passed${_RESET}"
