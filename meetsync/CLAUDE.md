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

## Available MCP Integrations (use these instead of building custom code)

Before writing any HTTP call, log scraper, or ad-hoc script, check whether one of these covers it. The parent workspace already registers all of them.

| MCP | When to use it on MeetSync |
|---|---|
| **Cloudflare** (`mcp__cloudflare__*`) | Query D1 directly for debugging (`SELECT * FROM sessions WHERE...`), inspect Worker logs, list secrets, check KV/R2 if we ever add them. Faster than `wrangler d1 execute` for one-off reads. |
| **Trigger.dev** (`mcp__trigger__*`) | Deploy tasks (`mcp__trigger__deploy`), fire test runs (`mcp__trigger__trigger_task`), tail run logs (`mcp__trigger__get_run_details`), list recent runs. Use instead of `npx trigger.dev@latest dev` loops when investigating a specific run. |
| **Google Calendar** (`mcp__claude_ai_Google_Calendar__*`) | Manually verify `/connect` worked — list events on Riccardo's calendar to confirm `deliver-results.ts` actually created the event after a match. This uses Claude's OWN Google OAuth (Anthropic-managed), NOT the bot's per-user OAuth, so it only proves events landed on Riccardo's account. |
| **Gmail** (`mcp__claude_ai_Gmail__*`) | Check for Google OAuth security notifications after adding test users to the OAuth consent screen. Verify consent emails arrived. |
| **Slack** (`mcp__claude_ai_Slack__*`) | Not used by the bot itself. Available if we ever want an admin alert channel instead of DMing `ADMIN_CHAT_ID` on Telegram. |

## Recommended Skills (activate when relevant)

- **`/debug`** — when a Trigger.dev run fails, a scenario test breaks, or D1 state looks wrong. Handles the "read logs → form hypothesis → reproduce → fix" loop.
- **`/fix`** — for surgical bug fixes (e.g. a specific state handler is too prescriptive). Forces root-cause analysis before edits.
- **`/test`** — regression-run the 5 synthetic scenarios in `tools/test-scenarios/` against a fresh deploy. Required after any router/state-handler change.
- **`/scout`** — when opening the codebase for the first time in a session, to map which file owns which concern (message-router vs state-handlers vs session-orchestrator).
- **`/plan`** — before adding any feature touching 2+ modules (e.g. the calendar OAuth flow that spanned Worker + Trigger.dev + D1 schema). Use `/plan --fast` for features under ~200 lines.
- **`/code-review`** — after any change to rate-limiting, OAuth, admin commands, or D1 schema. These are the high-blast-radius areas.
- **`/docs-seeker`** — when touching Telegram Bot API, Trigger.dev v4 SDK, Cloudflare Workers runtime APIs, or Google OAuth 2.0 semantics. Don't guess at parameter shapes — look them up.
- **`/journal`** — after a hardening round. Captures what broke, why, and how it was fixed so round-N+1 doesn't repeat round-N's mistakes.
- **`/watzup`** — end-of-session wrap-up. Summarize what changed, what's deployed, what's pending.

Engineering-local skills also inherited in this subdirectory: `backend-development`, `databases`, `devops`, `web-testing`, `mcp-builder`, `payment-integration`, `better-auth`. Available if a future feature needs them.

## Key Features

- **Central hub model** — no session codes. Users say who they want to schedule with by name
- **Per-user knowledge base** — `users` table stores chat_id, name, language, accumulated context (facts learned from conversations)
- **Deep link invites** — bot generates `t.me/bot?start=invite_XYZ` links for users to share with partners
- **Mediator mode** — bot can share creator's availability directly with partner who just picks a slot
- **Conversational AI** — natural language in all states, answers questions then redirects
- **Voice transcription** — audio messages transcribed via Cloudflare Workers AI (Whisper)
- **Admin controls** — block/unblock users via Telegram (admin chat_id only)
- **Rate limiting** — escalating cooldowns (5min → 30min → 2h → 24h) with admin notifications
- **Google Calendar auto-add** — `/connect` command triggers Worker-side OAuth flow (see `worker/src/google-oauth.ts`); after a match, `deliver-results.ts` silently adds the event to each connected participant's primary calendar. Falls back gracefully to the `.ics` attachment for users who haven't connected.

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
- `TELEGRAM_WEBHOOK_SECRET` — Random string for webhook validation (also HMAC key for `/connect` signed state)
- `ADMIN_CHAT_ID` — Admin Telegram chat ID (for block/unblock commands)
- `ANTHROPIC_API_KEY` — For admin intent classification
- `TRIGGERDEV_API_KEY` — Trigger.dev production API key
- `TRIGGERDEV_API_URL` — Trigger.dev API base URL
- `GOOGLE_CLIENT_ID` — Google OAuth 2.0 client ID (for `/connect` calendar flow)
- `GOOGLE_CLIENT_SECRET` — Google OAuth 2.0 client secret

### Trigger.dev (dashboard env vars)
- `TELEGRAM_BOT_TOKEN` — For sending replies
- `TELEGRAM_BOT_USERNAME` — For deep link generation (e.g., MeetSyncBot)
- `ANTHROPIC_API_KEY` — Claude API for intent/response/parsing
- `CLOUDFLARE_ACCOUNT_ID` — For D1 HTTP API access
- `CLOUDFLARE_API_TOKEN` — For D1 HTTP API access
- `CLOUDFLARE_D1_DATABASE_ID` — D1 database ID
- `MEETSYNC_USE_AI_RESPONSES` — Set to "false" to disable AI responses (kill switch)
- `GOOGLE_CLIENT_ID` — Same value as Worker secret; needed here so `google-calendar.ts::refreshAccessToken()` can refresh expired tokens
- `GOOGLE_CLIENT_SECRET` — Same value as Worker secret; same refresh-path reason

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
