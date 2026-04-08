# MeetSync — WhatsApp Scheduling Bot

WhatsApp chatbot that helps two people find overlapping free time from their work schedules.

## Architecture

- **Interface**: WhatsApp Business Cloud API (shared bot, one number)
- **Webhook Gateway**: Cloudflare Worker (`worker/`)
- **Processing**: Trigger.dev v4 tasks (`Engineering/trigger-automations/src/trigger/meetsync/`)
- **Database**: Cloudflare D1 (SQLite)
- **Schedule Parsing**: Claude API (Anthropic SDK)

## Project Layout

```
meetsync/
├── worker/          — Cloudflare Worker (webhook gateway)
├── migrations/      — D1 SQL migrations
├── shared/          — Types shared between Worker and Trigger.dev
├── plans/           — Implementation plans
└── docs/            — Project documentation
```

Trigger.dev tasks live in: `Engineering/trigger-automations/src/trigger/meetsync/`

## Environment Variables

### Worker (Cloudflare)
- `WHATSAPP_PHONE_NUMBER_ID` — Bot's phone number ID from Meta dashboard
- `WHATSAPP_ACCESS_TOKEN` — System User permanent token
- `WHATSAPP_VERIFY_TOKEN` — Webhook verification secret (you define this)
- `WHATSAPP_APP_SECRET` — For x-hub-signature-256 validation
- `TRIGGERDEV_API_KEY` — Trigger.dev API key for triggering tasks
- `TRIGGERDEV_API_URL` — Trigger.dev API base URL

### Trigger.dev
- `WHATSAPP_ACCESS_TOKEN` — For sending replies
- `WHATSAPP_PHONE_NUMBER_ID` — For sending replies
- `ANTHROPIC_API_KEY` — Claude API for schedule parsing
- `CLOUDFLARE_ACCOUNT_ID` — For D1 HTTP API access
- `CLOUDFLARE_API_TOKEN` — For D1 HTTP API access
- `CLOUDFLARE_D1_DATABASE_ID` — D1 database ID

## Commands

```bash
# Worker development
cd worker && npx wrangler dev

# Deploy Worker
cd worker && npx wrangler deploy

# Run D1 migration
cd worker && npx wrangler d1 execute meetsync-db --file=../migrations/0001-init.sql

# Trigger.dev development
cd ../Engineering/trigger-automations && npx trigger.dev@latest dev
```
