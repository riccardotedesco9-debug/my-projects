#!/bin/bash
# Claude Haiku as judge. One call decides whether a bot reply satisfies an
# expected-behavior description, with a brief rationale on failure.
#
# Why: the agentic bot composes replies from Sonnet per turn, so exact-string
# matching is brittle. We ask Haiku a focused yes/no question that describes
# the INTENT we expect ("bot should confirm a booking and not re-ask for
# time"), and let the judge decide if the actual reply matches.
#
# Cost: ~$0.0002 per call. A full 25-scenario run is under $0.02.
# Dependency: ANTHROPIC_API_KEY in env.test.

# Source guard: already sourced by _lib.sh so doesn't need its own shebang,
# but `set -euo pipefail` from _lib already applies here.

# Usage:
#   assert_reply_matches_judge <reply_text> "<expected behavior, one sentence>"
# Returns 0 on pass, fails scenario on no-match (with judge rationale).
assert_reply_matches_judge() {
  local reply="$1"
  local expected="$2"
  if [[ -z "$reply" ]]; then
    fail "judge: bot reply is empty — nothing to evaluate"
  fi
  if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
    # send-telegram-update.sh also sources .env.test. Try .env.test first
    # (the test-specific file), then fall back to .env (where the key
    # actually lives if the user pastes it from Trigger.dev secrets).
    local CANDIDATE
    for CANDIDATE in "$MEETSYNC_DIR/.env.test" "$MEETSYNC_DIR/.env"; do
      if [[ -f "$CANDIDATE" ]]; then
        # shellcheck disable=SC1090
        source "$CANDIDATE"
      fi
      if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then break; fi
    done
  fi
  # Export so the child python process inherits it. Sourced vars without
  # `export` stay shell-local and child processes see nothing.
  if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
    export ANTHROPIC_API_KEY
  fi
  # Force UTF-8 so Python on Windows doesn't crash when the bot reply or
  # the judge verdict contains en-dashes / emoji / other non-cp1252 chars.
  export PYTHONIOENCODING=utf-8
  export PYTHONUTF8=1
  if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
    # Non-fatal: skip this specific assertion but record the fact. run-all.sh
    # reads the counter at the end and flags the suite result as unreliable
    # if any judge skipped — otherwise 14/27 scenarios with only-judge
    # assertions would silently pass without actually testing anything.
    echo "  ${_YELLOW}skip${_RESET} judge: $expected — ANTHROPIC_API_KEY not in env (add it to meetsync/.env.test to enable Haiku-as-judge)"
    local COUNTER_FILE="${MEETSYNC_TEST_JUDGE_SKIP_COUNTER:-/c/tmp/meetsync-judge-skips.count}"
    local prev=0
    [[ -f "$COUNTER_FILE" ]] && prev=$(cat "$COUNTER_FILE" 2>/dev/null || echo 0)
    echo $((prev + 1)) > "$COUNTER_FILE"
    return 0
  fi

  local verdict
  verdict=$(python -c '
import json, os, sys, urllib.request
reply = sys.argv[1]
expected = sys.argv[2]
system = (
  "You are a strict QA judge for a scheduling chatbot. "
  "The user will give you (1) the bot reply text and (2) a one-sentence "
  "description of expected behavior. Decide whether the reply satisfies the "
  "expectation. Output ONE LINE of JSON: {\"pass\": true|false, \"why\": \"<one short sentence>\"}. "
  "Be generous on wording variance — match intent, not exact phrases. Be strict on the bot doing "
  "the opposite of what was expected (e.g. re-asking a question it should have skipped)."
)
user = f"BOT REPLY:\n{reply}\n\nEXPECTED BEHAVIOR:\n{expected}\n\nVerdict JSON:"
body = json.dumps({
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 200,
  "system": system,
  "messages": [{"role": "user", "content": user}],
}).encode("utf-8")
req = urllib.request.Request(
  "https://api.anthropic.com/v1/messages",
  data=body,
  headers={
    "Content-Type": "application/json",
    "x-api-key": os.environ["ANTHROPIC_API_KEY"],
    "anthropic-version": "2023-06-01",
  },
)
with urllib.request.urlopen(req, timeout=30) as r:
  data = json.load(r)
text = data["content"][0]["text"].strip()
# Slice first JSON object if the model wrapped it in anything.
i = text.find("{")
j = text.rfind("}")
if i < 0 or j < 0:
  print(json.dumps({"pass": False, "why": f"unparseable judge output: {text[:120]}"}))
else:
  print(text[i:j+1])
' "$reply" "$expected")

  local passed
  passed=$(python -c 'import json,sys; v=json.loads(sys.argv[1]); print("1" if v.get("pass") else "0")' "$verdict")
  local why
  why=$(python -c 'import json,sys; v=json.loads(sys.argv[1]); print(v.get("why",""))' "$verdict")

  if [[ "$passed" == "1" ]]; then
    tick "judge: $expected — ok ($why)"
  else
    echo "  ${_DIM}reply was: ${reply:0:200}${_RESET}"
    fail "judge: $expected — $why"
  fi
}

# Convenience wrapper: send, wait for reply, judge in one step.
# Usage:
#   send_and_judge <chat_id> "<user text>" "<expected behavior>"
send_and_judge() {
  local chat_id="$1"
  local text="$2"
  local expected="$3"
  local timeout_sec="${4:-45}"
  local ts
  ts=$(chat_epoch)
  send_webhook "$chat_id" "$text"
  local reply
  reply=$(wait_for_bot_reply_since "$chat_id" "$ts" "$timeout_sec")
  assert_reply_matches_judge "$reply" "$expected"
}
