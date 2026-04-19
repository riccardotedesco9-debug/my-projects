#!/bin/bash
# L2.5 — upsert_knowledge target=user persists caller facts to users.context.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users
seed_user "$TEST_USER_A" "Alex" "en"

section "Tell the bot a fact about yourself"
send_webhook "$TEST_USER_A" "btw I live in Valletta and I don't drive"
sleep 20

section "Verify users.context contains Valletta"
CTX=$(d1_select "SELECT context FROM users WHERE chat_id='$TEST_USER_A'")
FOUND=$(python -c "import json,sys; rows=json.load(sys.stdin); print('1' if rows and 'valletta' in (rows[0].get('context') or '').lower() else '0')" <<< "$CTX")
if [[ "$FOUND" != "1" ]]; then
  fail "expected 'Valletta' in users.context, got: $CTX"
fi
tick "users.context absorbed the Valletta fact"

section "Later question uses the stored fact"
send_and_judge "$TEST_USER_A" "recommend a coffee spot I can walk to" \
  "Bot takes into account that the user is in Valletta (or that they don't drive) when suggesting — it should reference the stored location or mobility context, not ask where they are." \
  30

echo
echo "${_GREEN}L2.5 passed${_RESET} — upsert_knowledge (user target) works"
