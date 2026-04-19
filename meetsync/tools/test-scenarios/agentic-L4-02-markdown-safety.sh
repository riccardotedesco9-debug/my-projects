#!/bin/bash
# L4.2 — Markdown parse-error fallback.
#
# A user message with unbalanced asterisks/underscores can cause Claude
# to echo them or include them in its reply. Previously Telegram's
# parse_mode=Markdown rejected such replies with HTTP 400 and the user
# saw silence. The new fallback strips parse_mode and retries plain text.
#
# We can't force Claude to generate malformed markdown reliably, but we
# CAN send a message that would trip naive pass-through. Assert that a
# reply arrives — i.e. the fallback kicks in if markdown parsing fails.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users
seed_user "$TEST_USER_A" "Alex" "en"

section "Send a message with unbalanced markdown chars"
# Several lone asterisks and underscores — if the bot echoes any without
# closure, naive Markdown parse would reject the send.
send_and_judge "$TEST_USER_A" "my name is Al*x, pronounced A-lex_underscore_thing. can you remember that?" \
  "Bot replies with a coherent acknowledgement (it remembers the name or offers to remember). The key is that a reply arrives at all — silent failure would indicate the Markdown fallback path did not engage." \
  45

echo
echo "${_GREEN}L4.2 passed${_RESET} — reply arrives even with tricky markdown input"
