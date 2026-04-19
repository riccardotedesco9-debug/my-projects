#!/bin/bash
# L4.5 — burst-grace fail-open under send flurry.
#
# Fire 3 messages in quick succession. The turn-handler's burst-grace
# logic (wrapped in try/catch as of today's hardening) should handle all
# 3 without crashing; the final message should get a reply.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users
seed_user "$TEST_USER_A" "Alex" "en"

section "Fire 3 messages within a second"
send_webhook "$TEST_USER_A" "hey"
send_webhook "$TEST_USER_A" "wait actually"
send_webhook "$TEST_USER_A" "nevermind — tell me a joke"
# Give all 3 turns time to process + dedupe. Burst-grace sleep is 1200ms;
# early messages bail out and only the latest replies.
sleep 45

section "Verify the latest message got a reply"
REPLY=$(last_bot_reply "$TEST_USER_A")
if [[ -z "$REPLY" ]]; then
  fail "no bot reply for any of the 3 burst messages"
fi
tick "bot replied: ${REPLY:0:100}"
assert_reply_matches_judge "$REPLY" "Bot's reply addresses the most recent message (a joke request) rather than the earlier 'hey' or 'wait'. Or at minimum, the bot responded SOMETHING coherent — burst-grace should have collapsed duplicates, not crashed."

echo
echo "${_GREEN}L4.5 passed${_RESET} — burst messages survive"
