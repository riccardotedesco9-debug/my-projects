# Phase 06 — Worker + schema cleanup

**Priority:** P1
**Status:** Pending
**Depends on:** phase 05 (new handler is live via the shim).

## Goal

Eliminate the `message-router` shim, point the Worker directly at `meetsync-turn-handler`, and clean up any dead metadata on D1 rows that the old orchestration needed.

## Worker changes

### `worker/src/handle-message.ts`

1. **Change the task id** in `triggerMessageRouter`:
   ```ts
   const url = `${env.TRIGGERDEV_API_URL}/api/v1/tasks/meetsync-turn-handler/trigger`;
   ```
2. **Remove the callback_data synthetic-text translation block.** The turn handler accepts `callback_data` as a typed payload field and interprets it directly. Specifically:
   - Delete `CALLBACK_DATA_TO_TEXT`.
   - Change `synthesizeFromCallback` to pass `callback_data` through as a new optional field on `MessageRouterPayload` (rename to `TurnPayload` while we're at it).
   - The turn handler's `loadSnapshot` + system prompt tells Claude about button taps naturally: "the user tapped the *confirm* button".
3. **Keep** the pre-logging of user text to `conversation_log`. The turn handler relies on the Worker-side log for burst consolidation (no change from today).

### `shared/types.ts`

Add `callback_data?: string` to `MessageRouterPayload` (or rename to `TurnPayload`).

## Migration file: `meetsync/migrations/0016-deprecate-router-columns.sql`

Actually — re-reading the verdicts in phase 01, we decided **not** to add a structural migration for the state column. Keep YAGNI. This file does not exist.

**Cleanup SQL (optional, one-time, not a migration):**
```sql
-- Optional cleanup of dead pointers after the rewrite is live.
-- Run manually via wrangler d1 execute if we want a clean slate.
UPDATE sessions
   SET both_confirmed_token_id = NULL,
       both_preferred_token_id = NULL,
       match_attempt = 0
 WHERE status NOT IN ('COMPLETED', 'EXPIRED');
```

## Delete the shim

Once the Worker points at `meetsync-turn-handler`, delete `message-router.ts` entirely. Redeploy Trigger.dev with the task removed. The task id `meetsync-message-router` will no longer exist — any stale triggers from pre-upgrade Worker deployments will 404, which is acceptable (we control the Worker, so we can coordinate the swap in one deploy window).

## Coordination: Worker + Trigger.dev deploy order

The Worker trigger URL MUST land at the same moment the new task is deployed. Three valid orderings:

1. **Safe rolling:** deploy the new Trigger.dev task (keeps the old `meetsync-message-router` shim alive) → deploy Worker pointing at `meetsync-turn-handler` → delete the shim in a follow-up deploy. Three steps.
2. **Hard cutover:** during a maintenance window, deploy Trigger.dev with the shim gone and the Worker pointing at the new task in the same window. One window, zero coordination issues.
3. **Feature-flag:** env var `MEETSYNC_TASK_ID=meetsync-turn-handler | meetsync-message-router` on the Worker. Flip it when ready. Adds complexity for no real benefit on a personal bot.

**Pick #2** — it's a personal tool, maintenance is cheap, no users to notify.

## Dashboard check

`worker/src/dashboard.ts` queries `session_events`. The new turn handler emits a different set of event names (see phase 03). The stuck-session query uses a hardcoded terminal-event list:
```sql
AND event NOT IN ('match_delivered', 'no_overlap_final', 'session_expired', 'delivery_failed')
```
Ensure the new handler still emits these exact event names for the terminal cases so the dashboard doesn't suddenly flag completed sessions as stuck. If names change, update the query in the same commit.

## LOC impact

- `handle-message.ts`: 555 → ~480 (−75) from removing the callback translation table + synth
- `shared/types.ts`: +1 field

## Unresolved questions

1. **Should we drop `participants.state` column entirely?** YAGNI says no — the column is 10 bytes per row, zero users right now, and the rewrite is already a big change. Revisit in 3 months if the column still isn't being read.
