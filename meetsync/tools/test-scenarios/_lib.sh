#!/bin/bash
# Shared helpers for the agentic-era test scenarios.
# Source at the top of every scenario: source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
#
# Post-rewrite shape: no sessions, no participants, no state-machine seeding.
# Scenarios drive the bot via synthetic webhooks and assert on outcomes
# (D1 rows + Claude-judged bot replies), not on exact wording.

set -euo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLS_DIR="$(cd "$LIB_DIR/.." && pwd)"
MEETSYNC_DIR="$(cd "$TOOLS_DIR/.." && pwd)"

# Reserved synthetic chat_ids. Must match telegram-client.ts TEST_CHAT_IDS.
export TEST_USER_A=999999001
export TEST_USER_B=999999002
export TEST_USER_C=999999003
export TEST_USER_D=999999004
export TEST_USER_E=999999005

# Colors for output
_RED=$'\033[31m'
_GREEN=$'\033[32m'
_YELLOW=$'\033[33m'
_BLUE=$'\033[34m'
_DIM=$'\033[2m'
_RESET=$'\033[0m'

tick() { echo "  ${_GREEN}ok${_RESET} $*"; }
fail() { echo "  ${_RED}FAIL${_RESET} $*" >&2; exit 1; }
step() { echo "${_YELLOW}=>${_RESET} $*"; }
hint() { echo "  ${_DIM}$*${_RESET}"; }
section() { echo; echo "${_BLUE}[${1}]${_RESET}"; }

# --- Primitive senders (delegate to the toolkit's one-off scripts) ---

# Send a synthetic Telegram text update. MSYS_NO_PATHCONV/MSYS2_ARG_CONV_EXCL
# are git-bash specific: without them any arg starting with `/` (like `/start`)
# gets rewritten to `C:/Program Files/Git/start`.
send_webhook() {
  local chat_id="$1"
  local text="$2"
  MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' \
    "$TOOLS_DIR/send-telegram-update.sh" "$chat_id" "$text" >/dev/null
}

send_callback() {
  local chat_id="$1"
  local callback_data="$2"
  MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' \
    "$TOOLS_DIR/send-telegram-callback.sh" "$chat_id" "$callback_data" >/dev/null
}

# --- D1 helpers (read-only by default; mutations are explicit via seed_*) ---

d1_query() {
  local sql="$1"
  (
    cd "$MEETSYNC_DIR/worker"
    npx wrangler d1 execute meetsync-db --remote --json --command="$sql" 2>/dev/null
  )
}

_extract_d1_json() {
  python -c 'import json,sys; data=json.load(sys.stdin); print(json.dumps(data[0]["results"]))'
}

d1_select() {
  d1_query "$1" | _extract_d1_json
}

# Poll a SELECT until it returns at least one row, or fail.
# Usage: wait_for "SELECT 1 FROM reminders WHERE chat_id='X' AND status='FIRED'" 30
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
  fail "wait_for timed out after ${timeout_sec}s: $sql"
}

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
  tick "$expected row(s): $sql"
}

assert_empty() {
  local sql="$1"
  local rows
  rows=$(d1_select "$sql")
  if [[ "$rows" != "[]" ]]; then
    fail "expected no rows but got $rows for: $sql"
  fi
  tick "no rows: $sql"
}

# Non-assertion variant — useful for optional precondition checks.
rows_json() { d1_select "$1"; }

# --- Bot reply helpers (agentic bot: reply text lives in conversation_log) ---

# Get the MOST RECENT bot reply for a chat_id, as a plain string (no quoting).
# Empty string if no reply yet. Use wait_for_bot_reply_since for race-free
# polling after a send.
last_bot_reply() {
  local chat_id="$1"
  d1_select "SELECT message FROM conversation_log WHERE chat_id='$chat_id' AND role='bot' ORDER BY created_at DESC, id DESC LIMIT 1" \
    | python -c 'import json,sys; rows=json.load(sys.stdin); print(rows[0]["message"] if rows else "")'
}

# Epoch second — used to checkpoint before a send.
chat_epoch() { date +%s; }

# Wait for a NEW bot reply to appear after a checkpoint epoch. Returns the
# reply text on stdout. Fails after timeout.
# Usage:
#   ts=$(chat_epoch); send_webhook "$CHAT" "hello"; reply=$(wait_for_bot_reply_since "$CHAT" "$ts" 30)
wait_for_bot_reply_since() {
  local chat_id="$1"
  local since_epoch="$2"
  local timeout_sec="${3:-30}"
  local elapsed=0
  local interval=2
  while (( elapsed < timeout_sec )); do
    local row
    row=$(d1_select "SELECT message, strftime('%s', created_at) AS ts FROM conversation_log WHERE chat_id='$chat_id' AND role='bot' ORDER BY id DESC LIMIT 1")
    local ts
    ts=$(python -c 'import json,sys; rows=json.load(sys.stdin); print(int(float(rows[0]["ts"])) if rows else 0)' <<< "$row")
    if (( ts >= since_epoch )); then
      python -c 'import json,sys; rows=json.load(sys.stdin); print(rows[0]["message"])' <<< "$row"
      return 0
    fi
    sleep "$interval"
    elapsed=$(( elapsed + interval ))
  done
  fail "no bot reply for $chat_id after ${timeout_sec}s since epoch $since_epoch"
}

# --- Claude-as-judge assertion ---
# Separated into _judge.sh so chaos scripts can use it too.
# shellcheck source=./_judge.sh
source "$LIB_DIR/_judge.sh"

# --- State setup helpers (seed D1 directly, bypass conversational flow) ---

reset_test_users() {
  step "resetting test users"
  "$TOOLS_DIR/reset-test-users.sh" >/dev/null
  tick "test users reset"
}

# Create a users row directly. Bypasses the "what should I call you" onboarding.
# Usage: seed_user <chat_id> <name> [language] [timezone]
seed_user() {
  local chat_id="$1"
  local name="$2"
  local lang="${3:-en}"
  local tz="${4:-Europe/Malta}"
  d1_query "INSERT OR REPLACE INTO users (chat_id, name, preferred_language, timezone, first_seen, last_seen) VALUES ('$chat_id', '$name', '$lang', '$tz', datetime('now'), datetime('now'))" >/dev/null
  tick "seeded user $chat_id as '$name'"
}

# Write a schedule_json onto users.latest_schedule_json. seed_schedule runs
# AFTER seed_user for the same chat_id.
# Usage: seed_schedule <chat_id> '<schedule_json_array>'
seed_schedule() {
  local chat_id="$1"
  local json="$2"
  d1_query "UPDATE users SET latest_schedule_json='$json', last_seen=datetime('now') WHERE chat_id='$chat_id'" >/dev/null
  tick "seeded schedule for $chat_id"
}

# Create a person_notes row for an owner. linked_chat_id is optional —
# omit for Telegram-only / unbot-known contacts.
# Usage: seed_contact <owner_chat_id> <name> [linked_chat_id] [phone]
seed_contact() {
  local owner="$1"
  local name="$2"
  local linked="${3:-}"
  local phone="${4:-}"
  local normalized
  normalized=$(python -c "import sys; print(sys.argv[1].strip().lower())" "$name")
  local linked_sql="NULL"
  local phone_sql="NULL"
  if [[ -n "$linked" ]]; then linked_sql="'$linked'"; fi
  if [[ -n "$phone" ]]; then phone_sql="'$phone'"; fi
  d1_query "INSERT OR REPLACE INTO person_notes (owner_chat_id, name, name_normalized, linked_chat_id, phone, updated_at, hidden) VALUES ('$owner', '$name', '$normalized', $linked_sql, $phone_sql, datetime('now'), 0)" >/dev/null
  tick "seeded contact $name for owner $owner"
}
