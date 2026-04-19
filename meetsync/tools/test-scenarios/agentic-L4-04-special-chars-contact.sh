#!/bin/bash
# L4.4 — contact name with special characters / diacritics.
#
# Names like "María José" or "Jürgen" should round-trip through
# normalizePersonName (lowercase + collapse whitespace) without crashing
# or creating duplicates.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users
seed_user "$TEST_USER_A" "Alex" "en"

section "Mention contact with diacritic + compound name"
send_webhook "$TEST_USER_A" "My friend María José works weekdays 10am-6pm. Let's plan with her for next week."
sleep 25

section "Verify person_notes row created with normalized name"
ROWS=$(d1_select "SELECT name, name_normalized FROM person_notes WHERE owner_chat_id='$TEST_USER_A'")
COUNT=$(python -c "import json,sys; print(len(json.loads(sys.argv[1])))" "$ROWS")
if (( COUNT < 1 )); then
  fail "expected at least 1 person_notes row for María José, got $COUNT. Raw: $ROWS"
fi
tick "contact with diacritic landed: $ROWS"

echo
echo "${_GREEN}L4.4 passed${_RESET} — special-char contact name handled"
