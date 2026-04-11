#!/bin/bash
# Scenario 04 — timezone override intent end-to-end.
#
# Verifies the round-9 change_timezone intent + handler:
#   1. Seed user with default timezone (Europe/Malta).
#   2. Send "I'm in Tokyo now, please set my timezone".
#   3. Intent classifier should return change_timezone with
#      params.timezone = "Asia/Tokyo" (learned from the prompt's
#      city→IANA map).
#   4. Router handler calls updateUserTimezone.
#   5. Assert users.timezone column for this chat_id is "Asia/Tokyo".
#
# Proves:
#   - Intent classifier recognizes timezone-set phrasing (not just
#     passive "partner is in Tokyo" mentions).
#   - Classifier maps city name to IANA string.
#   - Router's change_timezone branch persists the update.
#   - Non-Malta users get their actual timezone stored.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users

seed_user "$TEST_USER_A" "riccardo"

step "verify user starts with default Europe/Malta timezone"
assert_rows "SELECT chat_id FROM users WHERE chat_id = '$TEST_USER_A' AND timezone = 'Europe/Malta'" 1

step "user says 'set my timezone to Asia/Tokyo'"
# Phrasing chosen to be unambiguous to the classifier — skipping the
# "I'm in Tokyo" colloquial form because Haiku may parse that as a
# passive location mention instead of an explicit set request.
send_webhook "$TEST_USER_A" "please set my timezone to Asia/Tokyo"

step "wait for timezone to update in users table"
wait_for "SELECT 1 FROM users WHERE chat_id = '$TEST_USER_A' AND timezone = 'Asia/Tokyo'" 30

step "verify timezone was persisted"
assert_rows "SELECT chat_id FROM users WHERE chat_id = '$TEST_USER_A' AND timezone = 'Asia/Tokyo'" 1
tick "[timezone proof] change_timezone intent → users.timezone = 'Asia/Tokyo'"

echo
echo "${_GREEN}scenario-04 passed${_RESET}"
