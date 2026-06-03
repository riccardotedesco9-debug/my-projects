#!/bin/bash
# Read the last N messages from conversation_log for a test chat_id.
# Usage: ./tools/read-bot-log.sh <chat_id> [limit]
#
# Uses a temp file instead of a pipe because on Windows, piping wrangler
# output straight into python sometimes yields an empty stdin.

set -euo pipefail

CHAT_ID="${1:-999999001}"
LIMIT="${2:-10}"
# Use Windows-style path so the python on Windows can open it
TMP_OUT_BASH="/c/tmp/meetsync-log-${CHAT_ID}.json"
TMP_OUT_WIN="C:/tmp/meetsync-log-${CHAT_ID}.json"

cd "$(dirname "${BASH_SOURCE[0]}")/../worker"

SQL="SELECT role, message, created_at FROM conversation_log WHERE chat_id = '$CHAT_ID' ORDER BY created_at DESC LIMIT $LIMIT;"
npx wrangler d1 execute meetsync-db --remote --json --command="$SQL" > "$TMP_OUT_BASH" 2>/dev/null

PYTHONIOENCODING=utf-8 python -c "
import json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
with open(r'$TMP_OUT_WIN', encoding='utf-8') as f:
    data = json.load(f)
rows = data[0]['results']
if not rows:
    print('(no messages)')
    sys.exit(0)
for r in reversed(rows):
    role = r['role'].upper().ljust(4)
    ts = r['created_at'].split(' ')[1][:8]
    msg = r['message'].replace('\n', '\n       ')
    print(f'[{ts}] {role} | {msg}')
    print()
"
