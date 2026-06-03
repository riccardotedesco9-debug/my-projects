#!/bin/bash
# L4.6 — Long-message recall: a fact buried near the END of a long user
# message must still be retrievable several turns later.
#
# Regression motivator: turn-handler-snapshot rendered each historical
# message as `User: <first 500 chars>…` inside a flat [RECENT HISTORY]
# block. Anything past char 500 vanished — therapy/exercise/partner
# facts buried at the tail of a long onboarding-style message were lost.
# Fix: history is now passed as proper alternating user/assistant turns
# in the messages[] API array, with no per-message slice. Long pasted
# context survives intact (logMessage cap raised 1000 → 4000 char).
#
# Test: send a ~900-char message that ends with "I do therapy every
# Tuesday at 5pm". Send 4 unrelated turns. Then ask "am I free Tuesday
# after 6?" — the reply must reference therapy or treat 5–6pm Tuesday
# as taken.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users
seed_user "$TEST_USER_A" "Sam" "en"

LONG_MSG="Quick brain-dump on my routines so you have context. Mornings I usually start slow with coffee around 7:30 and a walk by the harbour, sometimes I bring the dog. Work is hybrid — Mon and Thu I'm usually in the St Julian's office and Tue/Wed/Fri remote from home in Mellieha, but my hours flex 09:00–17:30 most days. Lunch I tend to skip or grab something fast around 13:00. Evenings I cook for my partner around 19:30 and we like to watch something together until 22:30 or so. Weekends I try to keep open for family, my parents come over Sundays usually for lunch around 12:30, and I do laundry and errands Saturday mornings. One important recurring thing — I do therapy every Tuesday at 5pm, it runs about an hour and I never miss it."

section "Send long onboarding-style message with therapy fact at the tail"
ts=$(chat_epoch)
send_webhook "$TEST_USER_A" "$LONG_MSG"
reply=$(wait_for_bot_reply_since "$TEST_USER_A" "$ts" 45)
hint "bot acknowledged onboarding (reply length=${#reply})"

section "Send four unrelated turns to push the long message back in history"
send_and_judge "$TEST_USER_A" \
  "what's the weather today, just kidding" \
  "the bot replies briefly without confabulating weather data — it can deflect, joke back, or note it doesn't do weather. Any reasonable conversational reply passes." \
  45
send_and_judge "$TEST_USER_A" \
  "do you remember my name?" \
  "the bot replies, addressing the user by their name (Sam) or otherwise acknowledging they have a name on file." \
  45
send_and_judge "$TEST_USER_A" \
  "I'm planning a quiet evening" \
  "the bot replies conversationally — anything reasonable passes." \
  45
send_and_judge "$TEST_USER_A" \
  "good chat" \
  "the bot replies briefly — anything reasonable passes." \
  45

section "Ask 'am I free Tuesday after 6?' — the therapy fact must surface"
send_and_judge "$TEST_USER_A" \
  "am I free Tuesday after 6pm?" \
  "the reply mentions therapy on Tuesday (or Tuesday 5pm appointment / a recurring weekly commitment ending around 6pm) and confirms the user is free AFTER it. If the bot answers as if Tuesday evening is fully free with no awareness of the therapy slot, the long-message recall regression is back — fail this test." \
  60

echo
echo "${_GREEN}L4.6 passed${_RESET} — facts at the tail of long messages survive multi-turn recall"
