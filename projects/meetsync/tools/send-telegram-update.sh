#!/bin/bash
# Send a synthetic Telegram `Update` to the MeetSync Worker webhook.
# Lets Claude (or anyone) test the bot end-to-end without a real Telegram account.
#
# Usage:
#   ./tools/send-telegram-update.sh <chat_id> "<message text>"
#   ./tools/send-telegram-update.sh 999999001 "hey i wanna meet alice next week"
#
# Requires: meetsync/.env.test with WORKER_URL + TELEGRAM_WEBHOOK_SECRET.
# Replies are intercepted by the test-user guard in telegram-client.ts — they show up
# in Trigger.dev run logs prefixed with [TEST], not in a real Telegram chat.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env.test"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found. Copy .env.test.example to .env.test and fill it in." >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

: "${WORKER_URL:?WORKER_URL not set in .env.test}"
: "${TELEGRAM_WEBHOOK_SECRET:?TELEGRAM_WEBHOOK_SECRET not set in .env.test}"

CHAT_ID="${1:-999999001}"
TEXT="${2:-hello}"

UPDATE_ID=$(( (RANDOM << 15) | RANDOM ))
MSG_ID=$(( RANDOM + 1 ))
NOW=$(date +%s)

# Build JSON payload via Python so newlines, quotes, unicode, and emojis are
# all properly escaped — the previous manual `${TEXT//\"/\\\"}` approach broke
# on any multi-line input (common for pasted schedules).
PAYLOAD_SCRIPT='
import json, os, sys
cid = int(os.environ["CHAT_ID"])
update = {
  "update_id": int(os.environ["UPDATE_ID"]),
  "message": {
    "message_id": int(os.environ["MSG_ID"]),
    "date": int(os.environ["NOW"]),
    "chat": {"id": cid, "type": "private", "first_name": "TestUser" + str(cid)},
    "from": {"id": cid, "is_bot": False, "first_name": "TestUser" + str(cid), "language_code": "en"},
    "text": os.environ["TEXT"],
  },
}
sys.stdout.write(json.dumps(update))
'
PAYLOAD=$(TEXT="$TEXT" CHAT_ID="$CHAT_ID" UPDATE_ID="$UPDATE_ID" MSG_ID="$MSG_ID" NOW="$NOW" python -c "$PAYLOAD_SCRIPT")

echo ">> POST $WORKER_URL/webhook  (chat_id=$CHAT_ID)"
echo ">> text: $TEXT"

# Capture status + body via curl's -w trailer rather than -o <file>. The
# old approach wrote the body to /tmp/meetsync-webhook-response.txt and
# cat'd it back, but on Windows git-bash with MSYS_NO_PATHCONV=1 (set by
# _lib.sh::send_webhook) `/tmp/...` resolves DIFFERENTLY for Windows
# curl (drive-relative C:\tmp\) and for bash (MinGW /tmp). The file
# was always being written and never being read. Streaming through
# stdout sidesteps the path-mismatch entirely.
RESPONSE=$(curl -sS \
  -X POST "$WORKER_URL/webhook" \
  -H "Content-Type: application/json" \
  -H "X-Telegram-Bot-Api-Secret-Token: $TELEGRAM_WEBHOOK_SECRET" \
  -d "$PAYLOAD" \
  -w $'\n__HTTP_CODE__:%{http_code}\n')

HTTP_CODE=$(echo "$RESPONSE" | grep -o '__HTTP_CODE__:[0-9]*' | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/^__HTTP_CODE__:/d')
echo "<< HTTP $HTTP_CODE"
[[ -n "$BODY" ]] && echo "$BODY"
echo
