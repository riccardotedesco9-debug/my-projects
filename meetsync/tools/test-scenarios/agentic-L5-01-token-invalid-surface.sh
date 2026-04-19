#!/bin/bash
# L5.1 — users.google_token_invalid flag is surfaced in [STATE] and the
# bot tells the user honestly to /connect again.
#
# Chaos: seed a google_tokens row AND flip google_token_invalid=1 on the
# user. Snapshot formatter should render "Google Calendar: ✗ token
# expired" so Claude caveats its answer.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users
seed_user "$TEST_USER_A" "Alex" "en"
# Insert a stale google_tokens row + flip the flag.
d1_query "INSERT OR REPLACE INTO google_tokens (chat_id, access_token, refresh_token, expires_at) VALUES ('$TEST_USER_A', 'stale_access', 'stale_refresh', datetime('now', '-1 day'))" >/dev/null
d1_query "UPDATE users SET google_token_invalid=1 WHERE chat_id='$TEST_USER_A'" >/dev/null
tick "seeded stale google_tokens + flipped invalid flag"

section "Ask about calendar — bot should say reconnect"
send_and_judge "$TEST_USER_A" "what's on my calendar tomorrow?" \
  "Bot tells the user their Google Calendar is disconnected / the token expired / they need to /connect again. It does NOT confidently assert 'you're free all day' or list events as if the calendar were readable." \
  45

echo
echo "${_GREEN}L5.1 passed${_RESET} — token-invalid flag surfaces honestly"
