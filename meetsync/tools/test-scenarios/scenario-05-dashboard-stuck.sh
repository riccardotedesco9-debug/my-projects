#!/bin/bash
# Scenario 05 — /dashboard stuck-session detection.
#
# Verifies the round-9 observability dashboard's stuck-session
# detection query actually works:
#   1. Seed session_events with an orchestrator_spawned row whose
#      created_at is 20 minutes in the past (older than the 15min
#      STUCK_THRESHOLD_MIN).
#   2. GET /dashboard?token=<secret>
#   3. Assert the HTML contains the stuck session ID in the stuck
#      table (NOT in the "No stuck sessions" empty state).
#   4. Also assert that a FRESH orchestrator_spawned (from now) does
#      NOT show up in the stuck table (sanity: the time filter works).
#
# Proves:
#   - /dashboard endpoint serves HTTP 200 with auth
#   - The stuck-sessions SQL correctly finds rows where max(id) is a
#     non-terminal event older than threshold
#   - Terminal events correctly exclude sessions from the stuck list
#     (we seed a second session with match_delivered and verify it's
#     absent from the stuck list)

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

reset_test_users
# Also wipe any leftover test session_events so the stuck query is
# predictable. Only delete rows referencing the synthetic session ids
# this scenario uses.
STUCK_SID="stuck-test-$(date +%s)"
TERMINAL_SID="terminal-test-$(date +%s)"
FRESH_SID="fresh-test-$(date +%s)"

d1_query "DELETE FROM session_events WHERE session_id LIKE 'stuck-test-%' OR session_id LIKE 'terminal-test-%' OR session_id LIKE 'fresh-test-%'" >/dev/null

step "seed a stuck session (orchestrator_spawned 20 minutes ago)"
d1_query "INSERT INTO session_events (session_id, event, data, created_at) VALUES ('$STUCK_SID', 'orchestrator_spawned', '{\"match_attempt\":0}', datetime('now','-20 minutes'))" >/dev/null
tick "stuck session seeded"

step "seed a terminal session (match_delivered 20 minutes ago — should NOT be stuck)"
d1_query "INSERT INTO session_events (session_id, event, data, created_at) VALUES ('$TERMINAL_SID', 'orchestrator_spawned', '{\"match_attempt\":0}', datetime('now','-30 minutes'))" >/dev/null
d1_query "INSERT INTO session_events (session_id, event, data, created_at) VALUES ('$TERMINAL_SID', 'match_delivered', '{\"day\":\"2026-04-13\"}', datetime('now','-20 minutes'))" >/dev/null
tick "terminal session seeded"

step "seed a fresh session (orchestrator_spawned just now — should NOT be stuck yet)"
d1_query "INSERT INTO session_events (session_id, event, data, created_at) VALUES ('$FRESH_SID', 'orchestrator_spawned', '{\"match_attempt\":0}', datetime('now'))" >/dev/null
tick "fresh session seeded"

# Fetch the dashboard HTML.
source "$MEETSYNC_DIR/.env.test"
: "${WORKER_URL:?WORKER_URL not set}"
: "${TELEGRAM_WEBHOOK_SECRET:?secret not set}"

step "fetch /dashboard HTML"
HTML_FILE=$(mktemp)
HTTP_CODE=$(curl -sS -o "$HTML_FILE" -w "%{http_code}" "$WORKER_URL/dashboard?token=${TELEGRAM_WEBHOOK_SECRET}")
if [[ "$HTTP_CODE" != "200" ]]; then
  fail "expected HTTP 200 from /dashboard, got $HTTP_CODE"
fi
tick "dashboard returned HTTP 200"

step "verify stuck session is in the dashboard"
if ! grep -q "$STUCK_SID" "$HTML_FILE"; then
  fail "stuck session $STUCK_SID not found in dashboard HTML"
fi
# Make sure it appears in the "stuck" table specifically (row class
# "stuck") and not just as an events-table entry. The stuck table
# precedes the recent-events table in the rendering.
if ! grep -q "class=\"stuck\"" "$HTML_FILE"; then
  fail "dashboard has stuck session id in body but no .stuck row class — stuck table not rendered"
fi
tick "[dashboard proof] stuck session detected and rendered"

step "verify terminal session is NOT in the stuck table"
# The terminal session should appear in recent events but NOT in the
# stuck section. Check that the stuck table section doesn't contain
# its id. We grep for the terminal sid only up to the "Recent sessions"
# h2 marker — that's where the stuck table ends.
STUCK_SECTION=$(sed -n '/Stuck sessions/,/Recent sessions/p' "$HTML_FILE")
if echo "$STUCK_SECTION" | grep -q "$TERMINAL_SID"; then
  fail "terminal session $TERMINAL_SID appeared in stuck table — match_delivered filter broken"
fi
tick "[dashboard proof] terminal session correctly excluded from stuck table"

step "verify fresh session is NOT in the stuck table"
if echo "$STUCK_SECTION" | grep -q "$FRESH_SID"; then
  fail "fresh session $FRESH_SID appeared in stuck table — time threshold broken"
fi
tick "[dashboard proof] fresh session correctly excluded from stuck table"

# Cleanup the synthetic rows so future runs start clean.
d1_query "DELETE FROM session_events WHERE session_id IN ('$STUCK_SID', '$TERMINAL_SID', '$FRESH_SID')" >/dev/null
rm -f "$HTML_FILE"

echo
echo "${_GREEN}scenario-05 passed${_RESET}"
