# MeetSync — WhatsApp Scheduling Bot

WhatsApp chatbot that acts as a shared personal assistant — helps two people find overlapping free time. Central hub model: the bot knows everyone who's messaged it, learns about them over time, and mediates scheduling conversations.

## Architecture

- **Interface**: WhatsApp Business Cloud API (shared bot, one number)
- **Webhook Gateway**: Cloudflare Worker (`worker/`)
- **Processing**: Trigger.dev v4 tasks (`Engineering/trigger-automations/src/trigger/meetsync/`)
- **Database**: Cloudflare D1 (SQLite)
- **AI**: Claude Haiku (intent classification + response generation), Claude Sonnet (schedule parsing/vision)

## Project Layout

```
meetsync/
├── worker/          — Cloudflare Worker (webhook gateway + admin commands + rate limiting)
├── migrations/      — D1 SQL migrations (0001-0008)
├── shared/          — Types shared between Worker and Trigger.dev
└── CLAUDE.md        — This file
```

Trigger.dev tasks live in: `Engineering/trigger-automations/src/trigger/meetsync/`

## Key Features

- **Central hub model** — no session codes. Users say who they want to schedule with by name/phone
- **Per-user knowledge base** — `users` table stores name, language, accumulated context (facts learned from conversations)
- **Mediator mode** — bot can proactively message partners and share availability directly
- **Conversational AI** — natural language in all states, answers questions then redirects
- **Admin controls** — block/unblock users via WhatsApp (admin phone only)
- **Rate limiting** — escalating cooldowns (5min → 30min → 2h → 24h) with admin notifications

## Database Tables

| Table | Purpose |
|---|---|
| `users` | Knowledge base — phone, name, language, context, timestamps |
| `sessions` | Session lifecycle — creator, partner, status, mode, expiry |
| `participants` | Per-person state within a session |
| `partners` | Recurring pair tracking (auto-pair on return) |
| `pending_invites` | Async pairing for unknown partners |
| `free_slots` | Computed free time slots |
| `google_tokens` | Per-user Google Calendar OAuth tokens |
| `rate_limits` | Message throttling (sliding window) |
| `rate_strikes` | Escalating cooldown tracking |
| `blocked_phones` | Admin blocklist |

## Environment Variables

### Worker (Cloudflare secrets)
- `WHATSAPP_PHONE_NUMBER_ID` — Bot's phone number ID
- `WHATSAPP_ACCESS_TOKEN` — System User permanent token
- `WHATSAPP_VERIFY_TOKEN` — Webhook verification secret
- `WHATSAPP_APP_SECRET` — For x-hub-signature-256 validation
- `ADMIN_PHONE` — Admin phone number (for block/unblock commands)
- `ANTHROPIC_API_KEY` — For admin intent classification
- `TRIGGERDEV_API_KEY` — Trigger.dev production API key
- `TRIGGERDEV_API_URL` — Trigger.dev API base URL

### Trigger.dev (dashboard env vars)
- `WHATSAPP_ACCESS_TOKEN` — For sending replies
- `WHATSAPP_PHONE_NUMBER_ID` — For sending replies
- `ANTHROPIC_API_KEY` — Claude API for intent/response/parsing
- `CLOUDFLARE_ACCOUNT_ID` — For D1 HTTP API access
- `CLOUDFLARE_API_TOKEN` — For D1 HTTP API access
- `CLOUDFLARE_D1_DATABASE_ID` — D1 database ID
- `MEETSYNC_OUTREACH_TEMPLATE` — WhatsApp template name for proactive outreach
- `MEETSYNC_USE_AI_RESPONSES` — Set to "false" to disable AI responses (kill switch)

## Commands

```bash
# Deploy Worker
cd worker && npx wrangler deploy

# Run D1 migration
cd worker && npx wrangler d1 execute meetsync-db --remote --file=../migrations/0008-user-context.sql

# Deploy Trigger.dev (MUST copy to space-free path first)
rm -rf /c/tmp/trigger-deploy && mkdir -p /c/tmp/trigger-deploy
cp -r ../Engineering/trigger-automations/* /c/tmp/trigger-deploy/
cp -r ../Engineering/trigger-automations/.* /c/tmp/trigger-deploy/ 2>/dev/null
cp -r shared /c/tmp/trigger-deploy/shared
cd /c/tmp/trigger-deploy && npx trigger.dev@latest deploy

# Reset D1 data (careful — wipes everything)
cd worker && npx wrangler d1 execute meetsync-db --remote --command="DELETE FROM participants; DELETE FROM sessions; DELETE FROM partners; DELETE FROM free_slots; DELETE FROM rate_limits; DELETE FROM rate_strikes; DELETE FROM pending_invites; DELETE FROM users;"
```

## Deploy Note

Trigger.dev deploy fails if the path contains spaces ("My Projects"). Always copy to `/c/tmp/trigger-deploy/` first. This is a known Docker build limitation.
