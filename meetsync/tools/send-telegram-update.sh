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

HTTP_CODE=$(curl -sS -o /tmp/meetsync-webhook-response.txt -w "%{http_code}" \
  -X POST "$WORKER_URL/webhook" \
  -H "Content-Type: application/json" \
  -H "X-Telegram-Bot-Api-Secret-Token: $TELEGRAM_WEBHOOK_SECRET" \
  -d "$PAYLOAD")

echo "<< HTTP $HTTP_CODE"
cat /tmp/meetsync-webhook-response.txt
echo
