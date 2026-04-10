#!/bin/bash
# Send a synthetic Telegram photo update with a fake file_id.
# Worker will try to downloadMedia() via Bot API and get a 400 error.
# Tests the graceful error path for unparseable media.
#
# Usage:
#   ./tools/send-telegram-photo.sh <chat_id> <fake_file_id>

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../.env.test"
: "${WORKER_URL:?}"; : "${TELEGRAM_WEBHOOK_SECRET:?}"

CHAT_ID="${1:-999999001}"
FAKE_FILE_ID="${2:-AgACAgIAAxkBAAICfakefileidfortest1234567890}"
UPDATE_ID=$(( (RANDOM << 15) | RANDOM ))
MSG_ID=$(( RANDOM + 1 ))
NOW=$(date +%s)

PAYLOAD=$(cat <<JSON
{
  "update_id": $UPDATE_ID,
  "message": {
    "message_id": $MSG_ID,
    "date": $NOW,
    "chat": {"id": $CHAT_ID, "type": "private", "first_name": "TestUser$CHAT_ID"},
    "from": {"id": $CHAT_ID, "is_bot": false, "first_name": "TestUser$CHAT_ID", "language_code": "en"},
    "photo": [
      {"file_id": "$FAKE_FILE_ID", "file_unique_id": "UNIQ1", "width": 1280, "height": 960, "file_size": 100000}
    ]
  }
}
JSON
)

echo ">> POST photo update to $WORKER_URL/webhook"
HTTP_CODE=$(curl -sS -o /tmp/resp.txt -w "%{http_code}" \
  -X POST "$WORKER_URL/webhook" \
  -H "Content-Type: application/json" \
  -H "X-Telegram-Bot-Api-Secret-Token: $TELEGRAM_WEBHOOK_SECRET" \
  -d "$PAYLOAD")
echo "<< HTTP $HTTP_CODE"
cat /tmp/resp.txt
echo
