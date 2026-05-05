#!/bin/bash
# L4.7 — Multi-turn context: a fact stated in turn 1 must survive several
# unrelated turns and still be recallable.
#
# Regression motivator: history was inlined as a flat-text block in the
# single user-role message — Claude saw a narrative, not a conversation,
# and could not pattern-match against role-tagged turns. Fix: history is
# now passed as proper alternating user/assistant turns in messages[]
# (the same shape Claude.ai uses natively), so multi-turn recall feels
# normal again.
#
# Test: turn 1 mentions partner's name "Lara". Turns 2–5 are off-topic.
# Turn 6 asks "what's my partner's name again?" — the bot must answer
# "Lara" or equivalent without re-asking.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users
seed_user "$TEST_USER_A" "Sam" "en"

section "Turn 1: introduce partner's name"
send_and_judge "$TEST_USER_A" \
  "btw my partner is Lara, we usually do dinner together on weekends" \
  "the bot acknowledges, anything reasonable passes." \
  45

section "Turn 2: switch topic"
send_and_judge "$TEST_USER_A" \
  "what does Tuesday usually look like for most people in Malta?" \
  "the bot replies — anything reasonable passes (it doesn't need to know the answer)." \
  45

section "Turn 3: random small talk"
send_and_judge "$TEST_USER_A" \
  "did you ever try pastizzi" \
  "the bot replies briefly to the small talk." \
  45

section "Turn 4: more small talk"
send_and_judge "$TEST_USER_A" \
  "I love them honestly" \
  "the bot replies briefly." \
  45

section "Turn 5: random question"
send_and_judge "$TEST_USER_A" \
  "what time is it usually polite to call someone in Malta" \
  "the bot answers conversationally." \
  45

section "Turn 6: ask for partner's name — must recall 'Lara' without re-asking"
send_and_judge "$TEST_USER_A" \
  "remind me, what's my partner's name?" \
  "the reply contains the name 'Lara' (case-insensitive). The bot must NOT say it doesn't know, ask for the name again, or guess a different name. If it can't recall, the multi-turn context regression is back — fail this test." \
  60

echo
echo "${_GREEN}L4.7 passed${_RESET} — multi-turn context survives across unrelated turns"
