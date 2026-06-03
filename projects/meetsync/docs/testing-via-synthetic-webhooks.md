# Testing MeetSync via Synthetic Webhooks

Lets Claude (or a human) drive the bot end-to-end without a real Telegram account
or Riccardo needing to message the live bot himself.

## How it works

1. `tools/send-telegram-update.sh` POSTs a fake Telegram `Update` JSON to the Worker's
   `/webhook` endpoint with the real `X-Telegram-Bot-Api-Secret-Token` header.
2. The Worker processes it as if Telegram delivered it (rate limit → session logic →
   forward to Trigger.dev `message-router` task).
3. Reserved fake `chat_id`s (`999999001`, `999999002`) are intercepted inside both
   `sendReply` (Worker, [handle-message.ts](../worker/src/handle-message.ts)) and
   `sendTextMessage` / `sendDocumentMessage` (Trigger.dev,
   [telegram-client.ts](../../Engineering/trigger-automations/src/trigger/meetsync/telegram-client.ts)).
   Instead of hitting the Bot API (which would 400 "chat not found"), they log the
   intended reply prefixed with `[TEST]`.
4. Inspect state via Cloudflare MCP (D1) and Trigger.dev MCP (run logs) to verify
   conversation flow, DB mutations, and the bot's intended responses.

## Setup (one-time per machine)

```bash
cp meetsync/.env.test.example meetsync/.env.test
# Fill in WORKER_URL and TELEGRAM_WEBHOOK_SECRET.
# Find WORKER_URL via Cloudflare dashboard (Workers → meetsync-worker → Triggers)
# or from the setWebhook command stored in meetsync/CLAUDE.md.
# If you forgot the webhook secret, rotate it:
#   cd meetsync/worker
#   npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
# then re-register the webhook:
#   curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
#     -H "Content-Type: application/json" \
#     -d "{\"url\":\"$WORKER_URL/webhook\",\"secret_token\":\"$NEW_SECRET\",\"allowed_updates\":[\"message\"]}"
```

`.env.test` is gitignored via the root `.env.*` rule — never commit it.

## Reserved test chat_ids

| chat_id     | role              |
|-------------|-------------------|
| `999999001` | Test user A       |
| `999999002` | Test user B (partner) |

Using any other chat_id will cause the bot to call the real Telegram API, which
will fail (and log errors) for nonexistent chats — or worse, DM a real person if
the id happens to belong to one. Always use the reserved ids.

## Sending a test message

```bash
cd meetsync
./tools/send-telegram-update.sh 999999001 "hey, i wanna meet alice next week"
# → HTTP 200 OK. Bot has received the update. Processing is async via Trigger.dev.
```

Because the Worker uses `ctx.waitUntil()`, the HTTP 200 comes back instantly. The
real work happens asynchronously inside Trigger.dev — wait a few seconds before
inspecting state.

## Inspecting results

### 1. D1 database (Cloudflare MCP)

```sql
-- User state
SELECT chat_id, name, preferred_language, context, first_seen, last_seen
  FROM users WHERE chat_id IN ('999999001', '999999002');

-- Sessions
SELECT id, creator_chat_id, partner_chat_id, status, mode, created_at
  FROM sessions
  WHERE creator_chat_id IN (999999001, 999999002)
     OR partner_chat_id IN (999999001, 999999002)
  ORDER BY created_at DESC LIMIT 5;

-- Conversation log (user + bot messages — THIS is where bot replies land even for test chat_ids)
SELECT role, message, created_at FROM conversation_log
  WHERE chat_id = '999999001'
  ORDER BY created_at DESC LIMIT 20;

-- Free slots (after schedule parsing)
SELECT * FROM free_slots WHERE chat_id IN (999999001, 999999002);
```

Via Cloudflare MCP: `mcp__cloudflare__d1_database_query`.
Database id: `a750c8fe-0b58-410c-b07c-fc2972b2c35d` (see `worker/wrangler.toml`).

### 2. Trigger.dev run logs (Trigger.dev MCP)

```
mcp__trigger__list_runs                     → latest runs
mcp__trigger__get_run_details runId=...     → full trace + logs
```

Look for lines starting with `[TEST] sendTextMessage chat_id=999999001: ...` —
that's what the bot would have sent back to the user. This is the primary signal
for verifying response content.

### 3. Worker logs (`wrangler tail`)

```bash
cd meetsync/worker && npx wrangler tail --format pretty
```

Use this to watch requests hitting the Worker in real time. `[TEST] worker
sendReply ...` lines mean a Worker-level reply (admin response, rate limit
notification) was intercepted.

## Multi-turn conversations

Send sequential updates with the same chat_id, wait for each to process (read
Trigger.dev run to confirm), then send the next. Example — test the happy path:

```bash
./tools/send-telegram-update.sh 999999001 "/start"
./tools/send-telegram-update.sh 999999001 "my name is riccardo"
./tools/send-telegram-update.sh 999999001 "i want to schedule with alice"
# later, as alice:
./tools/send-telegram-update.sh 999999002 "hi, riccardo sent me here"
```

## Cleanup

After a test session, wipe the test users' state to keep the DB clean:

```sql
DELETE FROM conversation_log WHERE chat_id IN (999999001, 999999002);
DELETE FROM free_slots       WHERE chat_id IN (999999001, 999999002);
DELETE FROM participants     WHERE chat_id IN (999999001, 999999002);
DELETE FROM sessions         WHERE creator_chat_id IN (999999001, 999999002)
                                OR partner_chat_id IN (999999001, 999999002);
DELETE FROM partners         WHERE user_a IN (999999001, 999999002)
                                OR user_b IN (999999001, 999999002);
DELETE FROM rate_limits      WHERE chat_id IN (999999001, 999999002);
DELETE FROM rate_strikes     WHERE chat_id IN (999999001, 999999002);
DELETE FROM pending_invites  WHERE creator_chat_id IN (999999001, 999999002);
DELETE FROM users            WHERE chat_id IN (999999001, 999999002);
```

## Limitations

- **Media (photos/voice)**: the script only sends text. Testing schedule parsing
  (images) or voice transcription requires crafting a payload with a real
  `file_id` — Telegram-hosted media cannot be uploaded from outside Telegram.
  Workaround: mock the `parse-schedule` task directly via
  `mcp__trigger__trigger_task` with a synthetic image URL or pre-parsed slots.
- **Deep links** (`/start invite_XYZ`): work fine — the invite code is in the
  `text` field of the message, nothing special needed.
- **Contact sharing**: payload must include a `contact` object instead of `text`.
  Extend the script if needed, or send the structured payload directly via curl.
- **Admin commands**: use `ADMIN_CHAT_ID` from `.env.test`, not a fake id, if you
  want to test the admin intent classifier. Be aware that admin replies go to the
  real admin chat unless the admin id is also in `TEST_CHAT_IDS`.
