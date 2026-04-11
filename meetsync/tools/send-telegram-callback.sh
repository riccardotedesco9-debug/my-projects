#!/bin/bash
# Send a synthetic Telegram `callback_query` update to the MeetSync Worker
# webhook. Simulates a user tapping an inline-keyboard button.
#
# Usage:
#   ./tools/send-telegram-callback.sh <chat_id> <callback_data>
#   ./tools/send-telegram-callback.sh 999999001 confirm_schedule
#
# Requires: meetsync/.env.test with WORKER_URL + TELEGRAM_WEBHOOK_SECRET.
# The Worker translates callback_data into a synthetic text message via
# CALLBACK_DATA_TO_TEXT (see handle-message.ts), so e.g.
# "confirm_schedule" becomes a "yes" message flowing through the normal
# router pipeline. Reserved test chat_ids are intercepted the same way
# as regular text sends — replies land in conversation_log with [TEST]
# prefix, not in a real Telegram chat.

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
CALLBACK_DATA="${2:-confirm_schedule}"

UPDATE_ID=$(( (RANDOM << 15) | RANDOM ))
CALLBACK_ID="${CHAT_ID}-$(date +%s%N)"
NOW=$(date +%s)

# Build JSON payload via Python — same escape-safety argument as the
# text version of this script.
PAYLOAD_SCRIPT='
import json, os, sys
cid = int(os.environ["CHAT_ID"])
update = {
  "update_id": int(os.environ["UPDATE_ID"]),
  "callback_query": {
    "id": os.environ["CALLBACK_ID"],
    "from": {
      "id": cid,
      "is_bot": False,
      "first_name": "TestUser" + str(cid),
      "language_code": "en",
    },
    "message": {
      "message_id": 1,
      "date": int(os.environ["NOW"]),
      "chat": {"id": cid, "type": "private", "first_name": "TestUser" + str(cid)},
      "text": "[placeholder bot message the button was attached to]",
    },
    "data": os.environ["CALLBACK_DATA"],
  },
}
sys.stdout.write(json.dumps(update))
'
PAYLOAD=$(CALLBACK_DATA="$CALLBACK_DATA" CHAT_ID="$CHAT_ID" UPDATE_ID="$UPDATE_ID" CALLBACK_ID="$CALLBACK_ID" NOW="$NOW" python -c "$PAYLOAD_SCRIPT")

echo ">> POST $WORKER_URL/webhook  (callback_query chat_id=$CHAT_ID data=$CALLBACK_DATA)"

HTTP_CODE=$(curl -sS -o /tmp/meetsync-webhook-response.txt -w "%{http_code}" \
  -X POST "$WORKER_URL/webhook" \
  -H "Content-Type: application/json" \
  -H "X-Telegram-Bot-Api-Secret-Token: $TELEGRAM_WEBHOOK_SECRET" \
  -d "$PAYLOAD")

echo "<< HTTP $HTTP_CODE"
cat /tmp/meetsync-webhook-response.txt
echo
