# MeetSync — Telegram Scheduling Bot

Domain: Engineering — lives in `projects/` (uses global + Engineering skills/agents).
> Toolkit + mandatory gates: [agents/Engineering/CLAUDE.md](../../agents/Engineering/CLAUDE.md) — your agents, skills, and the code-reviewer-before-deploy/push gate.

Conversational Telegram bot that helps people find time to meet. **Shared-hub model**: every user is a node in one global graph, each user has a private contacts list, schedules live on the user, Google Calendar is the source of truth for actual bookings.

## Architecture

- **Interface**: Telegram Bot API (single bot, one token)
- **Webhook gateway**: Cloudflare Worker (`worker/`)
- **Processing**: Trigger.dev v4 task per turn (`projects/trigger-automations/src/trigger/meetsync/`)
- **Database**: Cloudflare D1 (SQLite)
- **AI**: Claude Sonnet for the agentic turn handler; Claude Opus 4.8 + adaptive thinking for image/PDF schedule parsing, Claude Sonnet for text schedule parsing
- **Calendar**: Google OAuth per user (read primary calendar, write events with attendees)

## Project Layout

```
meetsync/
├── worker/          — Cloudflare Worker: webhook gateway, /connect OAuth, dashboard
├── migrations/      — D1 SQL migrations (0010 → 0021)
├── shared/          — Types shared between Worker and Trigger.dev
├── tools/           — Synthetic webhook test scripts
└── CLAUDE.md        — This file

projects/trigger-automations/src/trigger/meetsync/
├── turn-handler.ts          — Main entry: loadSnapshot → enrich → Claude → tools → reply
├── turn-handler-tools.ts    — 15 tool definitions Claude can call
├── turn-handler-snapshot.ts — Renders [STATE] block from Snapshot
├── d1-client.ts             — D1 HTTP API client + all DB helpers
├── google-calendar.ts       — OAuth refresh, event read/write/delete, calendar fan-out
├── telegram-client.ts       — Telegram Bot API client
├── schedule-parser.ts       — Claude-assisted schedule extraction
├── match-compute.ts         — Pure overlap computation
├── fire-reminders.ts        — Cron task (every 5 min — D1 rate limit; reminders fire ±4 min)
└── nudge-stale-schedules.ts — Cron task (daily 09:00 UTC)
```

## Tools the agentic turn-handler exposes (21)

| Tool | Purpose |
|---|---|
| `parse_schedule` | Save the caller's own schedule, or an on-behalf one. Overlap-aware merge: replaces overlapping prior entries on a date, preserves non-overlapping ones |
| `add_personal_event` | Append a one-off future occasion ("doctor Wed 3pm") to caller's schedule. Pure append, survives nightly chat-log prune. Auto-mirrors to Google Calendar when /connect'd |
| `remove_schedule_entry` | Delete a stored entry (and its GCal mirror) by date+time. Auto-dedupes identical duplicates; falls back to Calendar-only delete when D1 has no match; bulk delete via `delete_all_matching` |
| `mirror_to_calendar` | Push an existing D1 entry to Google Calendar without writing to D1 — closes sync gaps for entries that pre-date the auto-mirror |
| `add_contact` | Link a contact by name+phone (shadow-tracks unmatched phones) |
| `forget_contact` | Hard-delete a person_note |
| `set_person_hidden` | Soft-hide a contact from overlap |
| `compute_overlap` | Find free time across caller + non-hidden contacts (reads live calendars) |
| `book_meetup` | Create one Google Calendar event with attendees + busy-block memory. Hard-blocks on 9h sleep+commute window unless `override_sleep_warning=true` |
| `cancel_meetup` | Two-stage delete from caller's calendar (preview → confirm) |
| `upsert_knowledge` | Update caller profile (target='user') or freeform fact about contact (target='person') |
| `query_schedule_history` | Look up dates outside the active 14d-back / 60d-forward [STATE] window (prose Q&A about a specific date) |
| `show_schedule` | Deterministically render + send the caller's WHOLE upcoming schedule (today→last stored date, no cap). Terminal. Replaces LLM hand-typing the schedule so an entry can't be silently dropped |
| `show_availability` | Deterministically render + send the who's-free grid (caller + non-hidden contacts, grouped by day). Terminal. Same anti-drop guarantee as show_schedule |
| `schedule_reminder` | One-shot or recurring (daily/weekly/monthly) ping |
| `list_reminders` / `cancel_reminder` | Manage active reminders |
| `relay_message` | Ghostwrite a message from caller to a contact (confirmation-gated) |
| `watch_schedule_upload` | Auto-ping caller when a contact next uploads a schedule |
| `reset_conversation` | Clear chat history; contacts and schedules survive |
| `reply` | Terminal — send the user's reply (text + optional buttons) |

## Privacy & sleep guardrails (added 2026-05-23)

- **Sleep + commute buffer**: `book_meetup` and `add_personal_event` compute a 9h window (8h sleep + 1h commute) around adjacent work shifts. Only flags gaps that overlap typical sleep hours (22:00–10:00) with ≥4h overlap, so same-day daytime gaps don't false-positive. Overrideable on book_meetup with explicit caller consent.
- **Sensitive label redaction**: rendered [STATE] schedule lines abstract sensitive labels (therapy, psychiatrist, medical specialists, addiction recovery, reproductive health, legal trouble, job interviews, etc.) to `(appointment)`. Underlying D1 row + Google Calendar event keep the real label — only the bot's rendered output is generic, so schedule screenshots are safe to share.

## Database tables (current)

| Table | Purpose |
|---|---|
| `users` | Global directory + canonical schedule (`latest_schedule_json`) + email + timezone |
| `person_notes` | Per-owner contact list with optional `linked_chat_id` and `hidden` flag |
| `google_tokens` | Per-user OAuth tokens for Google Calendar |
| `reminders` | Scheduled notifications (one-shot or recurring) |
| `user_schedule_watches` | One-shot "ping me when X uploads" watches |
| `conversation_log` | Recent message history per user |
| `rate_limits` / `rate_strikes` / `blocked_users` | Anti-abuse |
| `session_events` | Append-only telemetry (still written, vestigial otherwise) |

**Dropped in migration 0020:** `sessions`, `participants`, `pending_invites`, `free_slots`. The shared-hub refactor moved schedules onto `users` and contacts into `person_notes`; sessions had no remaining role.

## Available MCP integrations

| MCP | Use on MeetSync |
|---|---|
| **Cloudflare** | Query D1 for debugging (`SELECT * FROM users WHERE...`), list Worker secrets, tail Worker logs |
| **Trigger.dev** | Deploy, fire test runs, read run logs and errors |
| **Google Calendar** | Manually verify `/connect` worked using Claude's own OAuth |

## Environment variables

### Worker (Cloudflare secrets)
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ADMIN_CHAT_ID`
- `ANTHROPIC_API_KEY` (for admin intent classification)
- `TRIGGERDEV_API_KEY`, `TRIGGERDEV_API_URL` (forward turns to Trigger.dev)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (for `/connect` OAuth)

### Trigger.dev (dashboard env vars)
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`
- `ANTHROPIC_API_KEY` (Claude turn handler + schedule parser)
- `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_D1_DATABASE_ID`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (for token refresh — fetch fails silently if missing)

## Commands

```bash
# Deploy Worker
cd worker && npx wrangler deploy

# Run a D1 migration (latest is 0021)
cd worker && npx wrangler d1 execute meetsync-db --remote --file=../migrations/0021-user-email-last-nudge.sql

# Register Telegram webhook (one-time)
curl -X POST "https://api.telegram.org/bot{TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://meetsync-worker.{subdomain}.workers.dev/webhook","secret_token":"{SECRET}","allowed_updates":["message"]}'

# Deploy Trigger.dev (workaround for spaces in path)
rm -rf /c/tmp/trigger-deploy && mkdir -p /c/tmp/trigger-deploy
cp -r ../trigger-automations/* /c/tmp/trigger-deploy/
cp -r ../trigger-automations/.* /c/tmp/trigger-deploy/ 2>/dev/null
cp -r shared /c/tmp/trigger-deploy/shared
cd /c/tmp/trigger-deploy && npx trigger.dev@4.4.3 deploy

# Full reset (wipes all user state, schema stays)
cd worker && npx wrangler d1 execute meetsync-db --remote --command="DELETE FROM conversation_log; DELETE FROM person_notes; DELETE FROM reminders; DELETE FROM user_schedule_watches; DELETE FROM rate_limits; DELETE FROM rate_strikes; DELETE FROM session_events; DELETE FROM google_tokens; DELETE FROM users;"
```

## Deploy notes

- Trigger.dev deploy breaks on paths with spaces (`My Projects`). Always stage to `/c/tmp/trigger-deploy/` first.
- Pin the Trigger CLI version (`@4.4.3`) — newer/older mismatches with `@trigger.dev/sdk` cause a hard refusal in CI mode.
- After updating Google secrets, users must re-`/connect` (their refresh tokens stop working).

## Recommended skills

- **`/debug`** — when a Trigger.dev run fails, D1 state looks wrong, or Claude misfires
- **`/fix`** — surgical bug fixes; forces root-cause analysis
- **`/plan`** — before any feature crossing 2+ modules; `/plan --fast` for small ones
- **`/code-review`** — after touching OAuth, calendar code, or D1 schema
- **`/docs-seeker`** — when working with Telegram, Trigger.dev SDK, Cloudflare, or Google APIs

## Key invariants

- **Schedules live on `users`, not on a session.** A user has one canonical schedule, **merged per-date on every upload** — a new upload owns only the dates it covers; dates from earlier uploads stay put. So Mon–Wed today + Thu–Fri next week ends up as a full Mon–Fri schedule. Re-uploading a single date replaces just that date's entries. (Was a full overwrite before the merge fix.)
- **Visibility is per-caller.** Each user has their own `person_notes`. Snapshot enriches each linked contact with their live `latest_schedule_json` + Google Calendar events.
- **Calendar is the source of truth post-booking.** `book_meetup` creates events with attendees; the bot's job is over after that.
- **Privacy is one-way.** Caller sees their own events in full; sensitive events of others are abstracted by Claude when describing them across people.
- **Shadow-graph onboarding.** `add_contact` saves name+phone silently. When that phone joins the bot, the link auto-resolves and notifies the owner.
