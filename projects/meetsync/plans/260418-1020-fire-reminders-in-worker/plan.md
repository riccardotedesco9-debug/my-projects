# Move reminder-firer into the Cloudflare Worker

**Status:** proposed
**Created:** 2026-04-18
**Supersedes quick-fix:** cron slowed to `*/5 * * * *` on `meetsync-fire-reminders` (deploy `20260418.1`)

## Why

`meetsync-fire-reminders` runs on Trigger.dev and reaches D1 via the Cloudflare REST API (`api.cloudflare.com/.../d1/database/.../query`). The REST path is rate-limited (HTTP 429, code 971) far more aggressively than the native Worker binding. Every-minute polling was burning the quota; every-5-min buys headroom but does not fix the cause. Native Worker binding has no such ceiling.

## Target architecture

Cloudflare Worker (`meetsync/worker/`) already holds the D1 binding. Add a `scheduled()` handler plus a `[triggers] crons = ["*/1 * * * *"]` entry in `wrangler.toml`. The Trigger.dev `fire-reminders` task is deleted.

```
[cron] → Worker.scheduled() → env.DB (native D1 binding) → Telegram sendMessage
```

Key wins:
- No REST rate limit — per-Worker D1 reads are cheap and bundled with the Workers plan.
- One less moving part (task deleted, fewer env vars to keep in sync).
- Lower latency — a single fetch-free round-trip per reminder.
- Reminders fire every minute again (restores minute-precision UX).

## Scope

### Files to change
- `meetsync/worker/src/index.ts` — add `scheduled(event, env, ctx)` export alongside `fetch`.
- `meetsync/worker/src/fire-reminders.ts` *(new)* — port logic from `Engineering/trigger-automations/src/trigger/meetsync/fire-reminders.ts`. Uses `env.DB.prepare(...).all()` instead of HTTP client.
- `meetsync/worker/wrangler.toml` — add `[triggers]\ncrons = ["*/1 * * * *"]`.
- `meetsync/worker/src/types.ts` — add `Reminder` and `ReminderRecurrence` types (copy from trigger shared types).

### Files to delete (after verification)
- `Engineering/trigger-automations/src/trigger/meetsync/fire-reminders.ts`
- Related reminder-firer helpers in `d1-client.ts` that only the firer uses: `getDueReminders`, `markReminderFired`, `advanceRecurringReminder` — **keep** if the turn-handler also calls them, otherwise drop.

### Files to keep as-is
- `turn-handler-tools.ts` still owns **creating/cancelling** reminders (user-facing). Only the firing loop moves.
- D1 schema unchanged — `reminders` table already exists.

## Implementation steps

1. **Port the firing loop** to `meetsync/worker/src/fire-reminders.ts`:
   - Query due rows via `env.DB.prepare("SELECT * FROM reminders WHERE status='PENDING' AND fire_at <= ? ORDER BY fire_at ASC LIMIT 50").bind(nowEpoch).all<Reminder>()`.
   - For each: send Telegram message, then either UPDATE status='FIRED' or advance `fire_at` for recurring.
   - Keep the same failure policy — one bad send does not stop the batch; no `markFired` on error so next tick retries.
   - Expose a single `fireDueReminders(env)` function.
2. **Wire `scheduled()`** in `index.ts`:
   ```ts
   export default {
     fetch: handleFetch,
     async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
       ctx.waitUntil(fireDueReminders(env));
     },
   };
   ```
3. **Add cron trigger** in `wrangler.toml`:
   ```toml
   [triggers]
   crons = ["*/1 * * * *"]
   ```
4. **Deploy Worker**: `cd meetsync/worker && wrangler deploy`.
5. **Smoke test**: create a test reminder 2 min in the future via the bot, watch Worker logs (`wrangler tail`) for the tick.
6. **Remove Trigger.dev task**: delete `fire-reminders.ts` from trigger-automations, redeploy trigger project. Confirms no orphan cron entry.
7. **Clean up**: drop any `d1-client.ts` helpers used only by the removed task.

## Risk & rollback

- **Risk:** Worker cron fires on *all* deployed versions in rare edge cases during deploy. Mitigation: accept — reminder send is idempotent at the message level (Telegram sendMessage has no dedupe, but duplicate reminder within the same minute is harmless).
- **Risk:** Telegram API errors inside `scheduled()` do not surface in the dashboard like Trigger.dev runs. Mitigation: `console.error` + `wrangler tail` during rollout; add a Cloudflare Logpush later if noise warrants.
- **Rollback:** revert the Worker changes, re-enable the Trigger.dev task (keep `*/5 * * * *` until rewrite is hardened).

## Success criteria

- Zero 429 errors for 24h after cutover.
- At least one one-shot and one recurring reminder fire correctly in production.
- `wrangler tail` shows the `scheduled` event firing every minute.
- Trigger.dev `meetsync-fire-reminders` task no longer exists (cron unregistered).

## Open questions

- Does the Worker's free-tier cron allocation cover ~43k invocations/month (every minute)? Check plan before shipping.
- Should the firing loop also write an observability event row for each fired reminder, mirroring what turn-handler does? Not required for correctness; defer unless debugging needs it.
