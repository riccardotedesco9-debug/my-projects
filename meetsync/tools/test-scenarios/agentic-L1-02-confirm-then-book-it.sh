#!/bin/bash
# L1.2 — "[tapped: Confirm]" + "I dunno just book it" must not loop.
#
# Regression for today's chat: after Riccardo tapped Confirm and said
# "I dunno just book it", the bot kept pushing back. Fix: defer-handling
# persona + book_meetup tool description authorising concrete values.
#
# Driver: simulate the confirm tap with a synthetic text message that
# matches the persona's "[tapped: Confirm]" convention the Worker emits,
# then follow with a "just book it" utterance. Bot should complete the
# booking without re-asking.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users
seed_user "$TEST_USER_A" "Alex" "en"
seed_schedule "$TEST_USER_A" '[{"date":"2026-04-22","start_time":"00:00","end_time":"00:00","label":"off"},{"date":"2026-04-23","start_time":"14:00","end_time":"20:00","label":"work"}]'
seed_contact "$TEST_USER_A" "Sofia"
d1_query "UPDATE person_notes SET schedule_json='[{\"date\":\"2026-04-22\",\"start_time\":\"09:00\",\"end_time\":\"13:00\",\"label\":\"work\"},{\"date\":\"2026-04-23\",\"start_time\":\"14:00\",\"end_time\":\"20:00\",\"label\":\"work\"}]' WHERE owner_chat_id='$TEST_USER_A' AND name_normalized='sofia'" >/dev/null

section "Turn 1 — get the bot to propose a slot"
send_and_judge "$TEST_USER_A" "Let's meet Sofia on Wednesday afternoon" \
  "Bot identifies an afternoon slot on Wednesday 2026-04-22 (or asks one clarifying question about duration) — must be concrete times, not open-ended." \
  45

section "Turn 2 — simulated [tapped: Confirm] + defer"
# Mirrors the callback-to-text bridge: the Worker turns button taps into
# sentences wrapped in "[tapped: …]" so the turn-handler sees them as
# normal input. Follow with an explicit "just book it" to verify the
# defer principle engages even after confirm.
send_and_judge "$TEST_USER_A" "[tapped: Confirm] I dunno just book it" \
  "Bot proceeds to book the meetup (or explicitly confirms it's booking) without re-asking for specifics. No 'what time exactly?' loop." \
  60

echo
echo "${_GREEN}L1.2 passed${_RESET} — confirm + defer flow works"
