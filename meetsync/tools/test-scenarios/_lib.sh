#!/bin/bash
# Shared helpers for test scenarios. Source this at the top of every scenario:
#   source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

set -euo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLS_DIR="$(cd "$LIB_DIR/.." && pwd)"
MEETSYNC_DIR="$(cd "$TOOLS_DIR/.." && pwd)"

# Reserved synthetic chat_ids from docs/testing-via-synthetic-webhooks.md
export TEST_USER_A=999999001
export TEST_USER_B=999999002
export TEST_USER_C=999999003

# Colors for output
_RED=$'\033[31m'
_GREEN=$'\033[32m'
_YELLOW=$'\033[33m'
_DIM=$'\033[2m'
_RESET=$'\033[0m'

tick() { echo "  ${_GREEN}ok${_RESET} $*"; }
fail() { echo "  ${_RED}FAIL${_RESET} $*" >&2; exit 1; }
step() { echo "${_YELLOW}=>${_RESET} $*"; }
hint() { echo "  ${_DIM}$*${_RESET}"; }

# Send one synthetic webhook.
# MSYS_NO_PATHCONV=1 and MSYS2_ARG_CONV_EXCL='*' are git-bash specific:
# without them, any arg starting with `/` (like `/start`) gets rewritten
# to `C:/Program Files/Git/start` by MSYS's POSIX-to-Win32 translation.
# Took a test scenario failure to discover. Worth the two env vars.
send_webhook() {
  local chat_id="$1"
  local text="$2"
  MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' \
    "$TOOLS_DIR/send-telegram-update.sh" "$chat_id" "$text" >/dev/null
}

# Execute a SELECT against D1 and return JSON results on stdout.
# Usage: d1_query "SELECT status FROM sessions WHERE id = 'x'"
# Returns raw wrangler output (which includes headers, logs, and a JSON
# array); callers should pipe through _extract_d1_json to get just the rows.
d1_query() {
  local sql="$1"
  (
    cd "$MEETSYNC_DIR/worker"
    npx wrangler d1 execute meetsync-db --remote --json --command="$sql" 2>/dev/null
  )
}

# Extract the first result-set's rows from wrangler's --json output.
# wrangler returns a JSON array of result objects; we want .[0].results.
_extract_d1_json() {
  python -c 'import json,sys; data=json.load(sys.stdin); print(json.dumps(data[0]["results"]))'
}

# Run a SELECT and return rows as JSON. Pipe into `jq` or parse in python.
d1_select() {
  d1_query "$1" | _extract_d1_json
}

# Wait until a SELECT returns a non-empty result set, or fail after timeout.
# Usage: wait_for "SELECT 1 FROM sessions WHERE status='COMPLETED'" 30
wait_for() {
  local sql="$1"
  local timeout_sec="${2:-30}"
  local elapsed=0
  local interval=2
  while (( elapsed < timeout_sec )); do
    local rows
    rows=$(d1_select "$sql")
    if [[ "$rows" != "[]" ]]; then
      return 0
    fi
    sleep "$interval"
    elapsed=$(( elapsed + interval ))
  done
  fail "wait_for timed out after ${timeout_sec}s on: $sql"
}

# Assert that a SELECT returns exactly N rows.
assert_rows() {
  local sql="$1"
  local expected="$2"
  local rows
  rows=$(d1_select "$sql")
  local actual
  actual=$(python -c "import json,sys; print(len(json.loads(sys.argv[1])))" "$rows")
  if [[ "$actual" != "$expected" ]]; then
    fail "expected $expected rows, got $actual for: $sql"
  fi
  tick "$expected rows: $sql"
}

# Assert that a SELECT returns no rows (session not stuck, etc).
assert_empty() {
  local sql="$1"
  local rows
  rows=$(d1_select "$sql")
  if [[ "$rows" != "[]" ]]; then
    fail "expected no rows but got $rows for: $sql"
  fi
  tick "no rows: $sql"
}

# Reset both test users before running a scenario.
reset_test_users() {
  step "resetting test users"
  "$TOOLS_DIR/reset-test-users.sh" >/dev/null
  tick "test users reset"
}

# Seed a user row directly in D1, bypassing the conversational onboarding
# flow. Useful for tests where we want to focus on downstream behavior (like
# the race fix) without tripping over consolidation + intent classification
# of "/start" and "my name is X".
#
# Usage: seed_user <chat_id> <name> [language]
seed_user() {
  local chat_id="$1"
  local name="$2"
  local lang="${3:-en}"
  d1_query "INSERT OR REPLACE INTO users (chat_id, name, preferred_language, first_seen, last_seen) VALUES ('$chat_id', '$name', '$lang', datetime('now'), datetime('now'))" >/dev/null
  tick "seeded user $chat_id as '$name'"
}

# Extract the session id for the newest session created by TEST_USER_A.
latest_session_for_a() {
  d1_select "SELECT id FROM sessions WHERE creator_chat_id = '$TEST_USER_A' ORDER BY created_at DESC LIMIT 1" \
    | python -c 'import json,sys; rows=json.load(sys.stdin); print(rows[0]["id"] if rows else "")'
}
