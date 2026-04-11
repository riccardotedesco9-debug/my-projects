# Phase 04 — Unwrap reusable modules

**Priority:** P1 — prerequisite for phase 03's tool implementations.
**Status:** Pending
**Depends on:** none (pure mechanical refactor).

## Goal

The schedule parser, match-compute, and deliver-results currently only exist as Trigger.dev `schemaTask` entry points. The turn handler needs to call their core logic as plain async functions inside a running task (nested tasks via `triggerAndWait` add too much latency + complexity for per-turn sync calls).

## Refactor pattern

For each module, extract the core logic into an exported plain function. Keep the `schemaTask` wrapper as a thin caller so future scheduled/batched invocations still work.

### `schedule-parser.ts`

**Before:**
```ts
export const scheduleParser = schemaTask({
  id: "meetsync-schedule-parser",
  run: async (payload) => { ...big function that also updates state and sends replies... }
});
```

**After:**
```ts
// Pure extraction — no DB writes, no Telegram sends. Returns parsed shifts.
export async function extractSchedule(input: {
  media?: { base64: string; mediaType: string };
  text?: string;
  userName?: string;
  timezone: string;
  attributedToName?: string;
}): Promise<{ shifts: ParsedShift[]; detectedPersonName?: string }>;

// Trigger.dev wrapper kept for backwards compat / future batching.
// Removes the participant-state update and reply-send — those belonged
// to the old router flow and no longer make sense here.
export const scheduleParser = schemaTask({
  id: "meetsync-schedule-parser",
  run: async (payload) => {
    // Legacy callers: pass through to extractSchedule, persist results if owner given.
    // Most new usage goes through extractSchedule directly from the turn handler.
  }
});
```

**Cut from the task:**
- `updateParticipantState(participant_id, "AWAITING_CONFIRMATION", ...)` — state machine is gone.
- The `sendTextMessage` + `generateResponse` reply blocks — turn handler owns replies.
- The `yesNoKeyboard` attachment — moved to the reply tool's button schema.
- The `isOnBehalf` branching — the turn handler's `save_schedule` tool decides where to store.

### `match-compute.ts`

**Before:**
```ts
export const matchCompute = schemaTask({
  id: "meetsync-match-compute",
  run: async (payload) => { ...fetch participants, compute, write free_slots... }
});
```

**After:**
```ts
// Pure algorithm — takes schedules in, returns slots out.
export function computeOverlaps(
  schedules: Array<{ owner: string; shifts: ParsedShift[] }>,
  options?: { minBlockMinutes?: number; dayStart?: number; dayEnd?: number }
): FreeSlot[];

// Writer: for cases where we want to persist the computed slots on a session
// (kept separate from the compute itself so the turn handler can decide whether
// to persist or just use the slots in a proposed reply).
export async function persistComputedSlots(sessionId: string, slots: FreeSlot[]): Promise<void>;

// Trigger.dev wrapper (kept for scheduled/batch usage)
export const matchCompute = schemaTask({ ... });
```

The existing `computeSinglePersonSlots` is already a plain function — just move it next to `computeOverlaps`.

### `deliver-results.ts`

**Before:**
```ts
export const deliverResults = schemaTask({
  id: "meetsync-deliver-results",
  run: async (payload) => { ...read free_slots, pick best, send to each participant... }
});
```

**After:**
```ts
// Deliver a specific slot to all participants. Called by the turn handler.
// Sends .ics + Google Calendar event + notification to every participant.
// Marks session COMPLETED, emits session_events.
export async function deliverMatchToSession(sessionId: string, chosenSlot: FreeSlot): Promise<DeliverResult>;

export const deliverResults = schemaTask({ ... }); // kept
```

The slot-selection logic (longest + mutual preference + chronological tiebreaker) stays in `deliverResults` internally as a helper, because the turn handler may or may not want to choose itself — default is to call `computeOverlaps → deliverMatchToSession(best)` in one `compute_and_deliver_match` tool call.

## What the turn handler imports

```ts
import { extractSchedule }        from "./schedule-parser.js";
import { computeOverlaps }        from "./match-compute.js";
import { deliverMatchToSession }  from "./deliver-results.js";
import {
  loadSnapshot, registerUser, upsertPersonNote, setPersonNoteSchedule,
  saveParticipantSchedule, addParticipant, createPendingInvite,
  findUserByName, findUserByPhone, cancelSession, ... // all the small helpers
} from "./d1-client.js";
import { downloadMedia, transcribeAudio, sendTextMessage, sendDocumentMessage } from "./telegram-client.js";
```

No scenarios. No intents. No router-helpers.

## D1 client slimming

In the same phase, trim `d1-client.ts`:

- **Remove:** `getSessionSnapshot` (replaced by `loadSnapshot` with a cleaner shape), `getReplyContext` (folded into snapshot), `appendUserContext` (rename to `saveUserFact`), anything referencing `participants.state` state machine transitions.
- **Add:** `loadSnapshot(chat_id)` — the single entry point the turn handler uses.
- **Add:** `saveParticipantSchedule(participant_id, shifts)` — simple update, no state transition.
- **Add:** `cancelSession(session_id)` — status EXPIRED + notify others (replaces `handleCancel` logic).

## Output of this phase

- `schedule-parser.ts` restructured (core function + wrapper) — ~450 LOC → ~400 LOC
- `match-compute.ts` restructured — ~374 LOC → ~340 LOC
- `deliver-results.ts` restructured — ~187 LOC → ~180 LOC
- `d1-client.ts` trimmed — ~798 LOC → ~550 LOC

No behavior change in this phase — it's a mechanical refactor. Compile + run existing synthetic scenarios as smoke test before moving on.

## Unresolved questions

None. Mechanical.
