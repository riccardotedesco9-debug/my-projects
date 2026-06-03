#!/bin/bash
# L3.2 — avoid misclassifying contacts when many are on file.
#
# Persona line 111: "when listing 'who's working / off today' across many
# contacts, go person by person through [STATE] and verify each one's
# entry for that specific date. With 10+ contacts it's easy to misread
# one entry and wrongly mark someone as OFF when they're working."
#
# Seed 6 contacts with an unambiguous setup for a specific date: Marco,
# Diego, Sofia working; Brooke, Roni, Cody off. Ask "who's working
# Wednesday?" and judge whether all three working names appear and none
# of the three off names are falsely marked as working.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users
seed_user "$TEST_USER_A" "Alex" "en"

# 3 working, 3 off on 2026-04-29 (a Wednesday).
DATE="2026-04-29"
for n in Marco Diego Sofia; do
  seed_contact "$TEST_USER_A" "$n"
  normalized=$(python -c "import sys; print(sys.argv[1].lower())" "$n")
  d1_query "UPDATE person_notes SET schedule_json='[{\"date\":\"$DATE\",\"start_time\":\"09:00\",\"end_time\":\"17:00\",\"label\":\"work\"}]' WHERE owner_chat_id='$TEST_USER_A' AND name_normalized='$normalized'" >/dev/null
done
for n in Brooke Roni Cody; do
  seed_contact "$TEST_USER_A" "$n"
  normalized=$(python -c "import sys; print(sys.argv[1].lower())" "$n")
  d1_query "UPDATE person_notes SET schedule_json='[{\"date\":\"$DATE\",\"start_time\":\"00:00\",\"end_time\":\"00:00\",\"label\":\"off\"}]' WHERE owner_chat_id='$TEST_USER_A' AND name_normalized='$normalized'" >/dev/null
done

section "Ask who's working Wednesday"
send_and_judge "$TEST_USER_A" "who's working on 2026-04-29?" \
  "Bot identifies Marco, Diego, and Sofia as working on that date. It does NOT misclassify Brooke, Roni, or Cody as working — they should be shown as OFF or simply not listed among the workers." \
  45

echo
echo "${_GREEN}L3.2 passed${_RESET} — no person misclassification across 6 contacts"
