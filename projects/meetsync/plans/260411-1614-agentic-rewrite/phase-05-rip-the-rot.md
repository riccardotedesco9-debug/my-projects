# Phase 05 — Rip the rot

**Priority:** P0 — the actual deletion.
**Status:** Pending
**Depends on:** phases 03 + 04 (new handler compiles and tools work).

## What gets deleted

From `Engineering/trigger-automations/src/trigger/meetsync/`:

```
intent-router.ts          (259 LOC) — DELETE
intent-handlers.ts        (350 LOC) — DELETE
state-handlers.ts         (690 LOC) — DELETE
response-generator.ts     (366 LOC) — DELETE
router-helpers.ts          (95 LOC) — DELETE (reply-splitting merged into telegram-client.ts)
session-orchestrator.ts   (196 LOC) — DELETE
session-sync.ts           (315 LOC) — DELETE
message-router.ts        (1027 LOC) — REWRITTEN AS THIN SHIM (~60 LOC)
```

**Total deleted: 3,298 LOC**. New replacement code from phase 03: ~1,050 LOC. **Net: −2,248 LOC**.

## The new `message-router.ts` (kept for backwards compatibility with the Worker's task trigger path)

```ts
// meetsync-message-router — thin compatibility shim that forwards to turnHandler.
// Kept under this task id so the Worker's existing /trigger call doesn't break
// during the swap. Once the Worker is updated in phase 06, this file can be
// deleted entirely and the Worker can call `meetsync-turn-handler` directly.

import { schemaTask } from "@trigger.dev/sdk";
import { payloadSchema } from "./turn-handler.js";
import { runTurn } from "./turn-handler.js";

export const messageRouter = schemaTask({
  id: "meetsync-message-router",
  schema: payloadSchema,
  maxDuration: 120,
  run: async (payload) => runTurn(payload),
});
```

## Order of operations

1. **Verify** phase 03/04 compile: `cd Engineering/trigger-automations && npx tsc --noEmit`.
2. **Run existing synthetic scenarios** (`meetsync/tools/test-scenarios/`) against the OLD router one more time — save the output for regression comparison.
3. **Delete** the 7 files above in one commit so git-blame cleanly points at the rewrite commit.
4. **Rewrite** `message-router.ts` to the shim above.
5. **Update imports** in any remaining file that referenced the deleted modules:
   - `schedule-parser.ts` — used to import `generateResponse`, `sendTextMessage`, `updateParticipantState`. Now just imports the core Sonnet caller and nothing else.
   - `deliver-results.ts` — used to import `generateResponse`. Now composes its own message strings directly (short, static templates OK for match delivery — the turn handler handles the conversational part before/after).
   - `session-orchestrator.ts` / `session-sync.ts` — being deleted.
6. **Compile** again, fix any stragglers.
7. **Run synthetic scenarios** against the new pipeline. Compare output to step 2's baseline. Any regression = stop and fix before phase 06.

## What breaks (and what we accept)

- **Any in-flight sessions at deploy time lose their waitpoint-token dance.** Acceptable: wipe in-flight sessions before deploy (the `0012-router-owned-tokens.sql` migration already has precedent for this).
- **The `SCENARIO` contract with `generateResponse` is gone.** All callers have been rewritten.
- **Participant state machine branches in old code referenced `AWAITING_CONFIRMATION` etc.** — these branches go. The `state` column stays on the row (YAGNI — no migration) but is no longer read or written except as `'ACTIVE'` on insert.

## Dependency graph after the rip

```
turn-handler.ts ──── imports ──┬── d1-client.ts  (slimmed)
                                ├── schedule-parser.ts (core fn + wrapper)
                                ├── match-compute.ts (core fn + wrapper)
                                ├── deliver-results.ts (core fn + wrapper)
                                ├── telegram-client.ts (+ reply-splitter)
                                └── google-calendar.ts

message-router.ts ── forwards to ── turn-handler.ts   (temporary shim)
```

9 files total. Down from 14.

## Test suite impact

- `meetsync/tools/test-scenarios/*.sh` — need review. Many assert specific bot-reply strings from the response-generator static fallbacks. Those fallbacks are gone — replies are now LLM-generated and will vary in phrasing.
- **Fix strategy:** switch scenario assertions from exact-match to "contains one of N keywords" OR use LLM-as-judge (cheap Haiku call) to decide if a reply matches the intent. Phase 07 covers this in detail.

## Unresolved questions

1. Do we snapshot the OLD `response-generator.ts` static fallbacks somewhere as a reference for what the bot USED to say, in case we need to grep for phrasings later? **Yes — commit a copy to `plans/260411-1614-agentic-rewrite/reports/old-scenario-dump.md` before deleting.** Easy paste of the SCENARIO_INSTRUCTIONS + STATIC_FALLBACKS objects.
