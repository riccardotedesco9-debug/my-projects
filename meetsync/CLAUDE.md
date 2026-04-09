# MeetSync — Telegram Scheduling Bot

Telegram chatbot that acts as a shared personal assistant — helps two people find overlapping free time. Central hub model: the bot knows everyone who's messaged it, learns about them over time, and mediates scheduling conversations.

## Architecture

- **Interface**: Telegram Bot API (shared bot, one token)
- **Webhook Gateway**: Cloudflare Worker (`worker/`)
- **Processing**: Trigger.dev v4 tasks (`Engineering/trigger-automations/src/trigger/meetsync/`)
- **Database**: Cloudflare D1 (SQLite)
- **AI**: Claude Haiku (intent classification + response generation), Claude Sonnet (schedule parsing/vision)

## Project Layout

```
meetsync/
├── worker/          — Cloudflare Worker (webhook gateway + admin commands + rate limiting)
├── migrations/      — D1 SQL migrations (0001-0010)
├── shared/          — Types shared between Worker and Trigger.dev
└── CLAUDE.md        — This file
```

Trigger.dev tasks live in: `Engineering/trigger-automations/src/trigger/meetsync/`

## Key Features

- **Central hub model** — no session codes. Users say who they want to schedule with by name
- **Per-user knowledge base** — `users` table stores chat_id, name, language, accumulated context (facts learned from conversations)
- **Deep link invites** — bot generates `t.me/bot?start=invite_XYZ` links for users to share with partners
- **Mediator mode** — bot can share creator's availability directly with partner who just picks a slot
- **Conversational AI** — natural language in all states, answers questions then redirects
- **Voice transcription** — audio messages transcribed via Cloudflare Workers AI (Whisper)
- **Admin controls** — block/unblock users via Telegram (admin chat_id only)
- **Rate limiting** — escalating cooldowns (5min → 30min → 2h → 24h) with admin notifications

## Database Tables

| Table | Purpose |
|---|---|
| `users` | Knowledge base — chat_id, phone (optional), username, name, language, context, timestamps |
| `sessions` | Session lifecycle — creator, partner, status, mode, expiry |
| `participants` | Per-person state within a session |
| `partners` | Recurring pair tracking (auto-pair on return) |
| `pending_invites` | Async pairing for unknown partners (deep link based) |
| `free_slots` | Computed free time slots |
| `google_tokens` | Per-user Google Calendar OAuth tokens |
| `rate_limits` | Message throttling (sliding window) |
| `rate_strikes` | Escalating cooldown tracking |
| `blocked_users` | Admin blocklist |
| `conversation_log` | Recent message history per user |

## Environment Variables

### Worker (Cloudflare secrets)
- `TELEGRAM_BOT_TOKEN` — Bot token from @BotFather
- `TELEGRAM_WEBHOOK_SECRET` — Random string for webhook validation
- `ADMIN_CHAT_ID` — Admin Telegram chat ID (for block/unblock commands)
- `ANTHROPIC_API_KEY` — For admin intent classification
- `TRIGGERDEV_API_KEY` — Trigger.dev production API key
- `TRIGGERDEV_API_URL` — Trigger.dev API base URL

### Trigger.dev (dashboard env vars)
- `TELEGRAM_BOT_TOKEN` — For sending replies
- `TELEGRAM_BOT_USERNAME` — For deep link generation (e.g., MeetSyncBot)
- `ANTHROPIC_API_KEY` — Claude API for intent/response/parsing
- `CLOUDFLARE_ACCOUNT_ID` — For D1 HTTP API access
- `CLOUDFLARE_API_TOKEN` — For D1 HTTP API access
- `CLOUDFLARE_D1_DATABASE_ID` — D1 database ID
- `MEETSYNC_USE_AI_RESPONSES` — Set to "false" to disable AI responses (kill switch)

## Commands

```bash
# Deploy Worker
cd worker && npx wrangler deploy

# Run D1 migration (Telegram schema)
cd worker && npx wrangler d1 execute meetsync-db --remote --file=../migrations/0010-telegram-migration.sql

# Register Telegram webhook (one-time after deploy)
curl -X POST "https://api.telegram.org/bot{TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://meetsync-worker.{subdomain}.workers.dev/webhook","secret_token":"{SECRET}","allowed_updates":["message"]}'

# Deploy Trigger.dev (MUST copy to space-free path first)
rm -rf /c/tmp/trigger-deploy && mkdir -p /c/tmp/trigger-deploy
cp -r ../Engineering/trigger-automations/* /c/tmp/trigger-deploy/
cp -r ../Engineering/trigger-automations/.* /c/tmp/trigger-deploy/ 2>/dev/null
cp -r shared /c/tmp/trigger-deploy/shared
cd /c/tmp/trigger-deploy && npx trigger.dev@latest deploy

# Reset D1 data (careful — wipes everything)
cd worker && npx wrangler d1 execute meetsync-db --remote --command="DELETE FROM participants; DELETE FROM sessions; DELETE FROM partners; DELETE FROM free_slots; DELETE FROM rate_limits; DELETE FROM rate_strikes; DELETE FROM pending_invites; DELETE FROM users; DELETE FROM conversation_log; DELETE FROM blocked_users;"
```

## Deploy Note

Trigger.dev deploy fails if the path contains spaces ("My Projects"). Always copy to `/c/tmp/trigger-deploy/` first. This is a known Docker build limitation.

## Telegram-specific Notes

- **No templates**: Unlike WhatsApp, Telegram has no template system or 24h messaging window. Bot can message any user who has `/start`ed it at any time.
- **Deep links**: Partners who haven't used the bot receive an invite link (`t.me/bot?start=invite_XYZ`) from the inviter. Clicking it auto-pairs them.
- **Contact sharing**: Users can share their phone number via Telegram's contact button. This is optional but enables partner lookup by phone.
- **Webhook verification**: Telegram uses a `secret_token` header instead of HMAC-SHA256. Set via `setWebhook` call.
