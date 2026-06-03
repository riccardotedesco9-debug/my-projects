# Phase 01 — Ruthless per-file classification

**Priority:** P0 — decides what the rest of the plan touches.
**Status:** Pending
**Owner:** me (pre-execution — no code changes in this phase, only decisions).

## Scope

Walk every meaningful source file in `meetsync/worker/src` and `Engineering/trigger-automations/src/trigger/meetsync/`. For each, state: KEEP / TRIM / SCRAP, the reason, and the estimated LOC delta.

## Verdicts

### Worker (`meetsync/worker/src/`)

| File | LOC | Verdict | Reason |
|---|---:|---|---|
| `index.ts` | 115 | **KEEP** | Clean webhook entry point. Privacy policy, dashboard gate, `/setup-webhook`, Google OAuth callback, `/webhook`. Nothing rotten. |
| `handle-message.ts` | 555 | **TRIM** (−80 LOC) | Extraction + rate limiting + admin commands + callback_query synthesis are all fine. **Cut:** the pre-logging of text to conversation_log (lines 163–198). The new turn handler owns logging. Also cut the callback_data → synthetic-text translation (`CALLBACK_DATA_TO_TEXT`) — button taps can arrive as structured callback payloads and be dispatched by the turn handler directly. |
| `types.ts` | 90 | **KEEP** | Env + Telegram types. |
| `signature.ts` | 18 | **KEEP** | HMAC verification, tiny, correct. |
| `rate-limit.ts` | 122 | **KEEP** | Sliding window + escalating cooldowns + admin notify. Works. |
| `dashboard.ts` | 209 | **KEEP** | Observability, single-file HTML view, no deps. Stuck-session query may need `session_events` events the new handler emits — minor touchups. |
| `google-oauth.ts` | 189 | **KEEP** | `/connect` flow, signed state, token exchange. Clean. |

**Worker net delta:** −80 LOC. Keep the gateway essentially as-is.

### Trigger.dev tasks (`Engineering/trigger-automations/src/trigger/meetsync/`)

| File | LOC | Verdict | Reason |
|---|---:|---|---|
| `message-router.ts` | 1027 | **SCRAP → NEW** (~80 LOC shim) | Replace entire body with a thin `schemaTask` that loads media if needed and hands off to the new `turn-handler.ts`. Delete: 13 global-intent branches, the in-router consolidation race guard (move to turn handler), `handleIdleUser`, `handleNewSession`, `addPartnersFromOpeningMessage`, the state switch, the schedule-on-behalf hack, the fast-path routing. |
| `intent-router.ts` | 259 | **SCRAP** | The 29-intent + 180-line system prompt + image fast-path is the root cause of rigidity. Claude Sonnet in the turn handler does this job natively via tool selection. |
| `intent-handlers.ts` | 350 | **SCRAP** | `handleCancel`, `handleRemovePartner`, `handleSwapPartner`, `handleAmendSchedule`. Each becomes 1–5 lines of tool implementation (`cancel_session`, `remove_partner`, `add_or_invite_partner`, `save_schedule`). The candidate-disambiguation logic survives as a helper inside the `remove_partner` tool. |
| `state-handlers.ts` | 690 | **SCRAP** | 7 state-scoped handlers. The state machine they dispatch from stops existing in phase 06. Retain nothing — the remaining useful logic (invite link markdown, `partner_found` lookup, `addParticipant`) moves into tool implementations. |
| `response-generator.ts` | 366 | **SCRAP** | 80-scenario table + fallbacks. The turn handler composes replies directly via Sonnet — no intermediate scenario layer. Zero scenarios survive. The system prompt (personality, date, rules) moves to `turn-handler.ts::SYSTEM_PROMPT`. |
| `router-helpers.ts` | 95 | **TRIM → merge** | `canProceedToScheduling` dies with the state machine. `reply` message-splitting (>4000 chars) moves into `telegram-client.ts::sendTextMessage`. Payload schema moves to `turn-handler.ts`. File deleted. |
| `session-orchestrator.ts` | 196 | **SCRAP** | Waitpoint token dance + ghost-reminder guard + match_attempt versioning. All exists because the old pipeline needed async gates for "both confirmed" and "both preferred". Agentic loop reads state each turn and decides; no tokens needed. Reminder-the-day-before can be a simple scheduled Trigger.dev task keyed on `free_slots.day` if we want it (P2, not in this rewrite). |
| `session-sync.ts` | 315 | **SCRAP** | Same as above — `spawnOrchestrator`, `restartOrchestratorForAmend`, `checkAllConfirmed`, `checkAllPreferred`. All dead when orchestrator dies. |
| `schedule-parser.ts` | 462 | **KEEP + UNWRAP** (−10 LOC) | The Sonnet vision extraction is the only thing worth keeping here verbatim — the weekday lookup table, the framing-A/B prompt, the timezone handling. **Unwrap** the core `parseTextWithClaude` / `parseMediaWithClaude` so they're callable as plain async functions from the turn handler, AND keep the `schemaTask` wrapper for the (future) ability to offload parsing to a separate run if latency matters. Drop the auto-state-update and auto-reply at the end of the task — the turn handler handles replies. |
| `match-compute.ts` | 374 | **KEEP + UNWRAP** | Pure algorithm: `getFreeTime`, `intersectBlocks`, `computeSinglePersonSlots`. Unwrap the core into a `matchSchedules(schedules[])` function callable from the turn handler. Retain the `schemaTask` wrapper for use by (future) scheduled tasks. |
| `deliver-results.ts` | 187 | **KEEP + UNWRAP** | Same pattern. Takes a `session_id` + a chosen `slot`, sends .ics + Google Calendar event + confirmation to every participant. The turn handler calls this as a function during a `deliver_match` tool call. |
| `telegram-client.ts` | 223 | **KEEP** (+10 LOC) | Add the 4000-char split from `router-helpers.ts`. Add a `callback_data` enum so button payloads are typed. |
| `google-calendar.ts` | 93 | **KEEP** | 93 LOC of OAuth refresh + create event. Nothing wasted. |
| `d1-client.ts` | 798 | **TRIM** (−250 LOC) | Most helpers stay. **Cut:** `getSessionSnapshot` (the turn handler builds its own snapshot structure — different shape), `getReplyContext` (folded into the snapshot), `appendUserContext` (becomes `save_user_fact` tool implementation — same SQL, different name), the `CONFIRMED_OR_LATER` state-family helper, anything referencing `participant.state` or `AWAITING_*`. |

### Migrations (`meetsync/migrations/`)

| File | LOC | Verdict |
|---|---:|---|
| `0010-telegram-migration.sql` | 126 | **KEEP** — baseline schema |
| `0011-pending-invites-unique.sql` | 18 | **KEEP** |
| `0012-router-owned-tokens.sql` | 51 | **KEEP history, columns become dead** — match_attempt + token IDs unused by the new handler. Leave the columns; don't add a removal migration (not worth the breaking change). |
| `0013-per-user-timezone.sql` | 33 | **KEEP** — timezone is still used |
| `0014-rate-limits-ts-index.sql` | 12 | **KEEP** |
| `0015-person-notes.sql` | 55 | **KEEP** — person_notes is central to the new flow |
| **NEW** `0016-drop-state-branching.sql` | ~15 | Add this in phase 06. Drops: nothing structurally. Sets `participants.state = 'ACTIVE'` for all rows and stops writing to the column. Or: leave column alone, just stop reading from it. Decision: **leave column alone**. YAGNI. |

## Net code delta

| Before | After | Delta |
|---:|---:|---:|
| Worker ~1,300 LOC | ~1,220 LOC | −80 |
| Trigger tasks ~5,435 LOC | ~2,300 LOC | **−3,135** |
| Total ~6,735 LOC | ~3,520 LOC | **−3,215 LOC (−48%)** |

## AI slop inventory (the smells, concretely)

1. **Scenario sprawl** — `response-generator.ts` has 80+ named scenarios. Each is an LLM-prompt override tailored to one state+intent combo. Every round added more. Dead giveaway: `unknown_intent` with `extraContext: "CRITICAL anti-nag rules: (a)... (b)... (c)..."` appears in three different call sites. The scenario layer was trying to flatten the conversation into a switch-case and losing.
2. **"Fall-through guards"** — every commit comment in `message-router.ts` says *"must come BEFORE unknown intent handler"*, *"must run BEFORE regular schedule-upload routing"*. This is the file telling you its own dispatch order is an accident of bugfix ordering, not a design.
3. **Comment-to-code ratio ~40 %** — most files spend more lines justifying why a guard exists than the guard itself. Scar tissue from rounds 1–11.
4. **"The AI was hallucinating" comments** — e.g. `d1-client.ts:258` for getSessionSnapshot, `state-handlers.ts:432` for anti-nag. Each is a structural failure patched by stuffing more instructions into an already-overloaded scenario prompt.
5. **Hardcoded language strings** still crop up despite round-8 cleanup (`state-handlers.ts:638`, `intent-handlers.ts:296`). Every time a new hardcoded reply was added, it bypassed the language path.
6. **Duplicate truth sources** — `users.context`, `person_notes.notes`, `conversation_log`, `session_events`, `participants.schedule_json`, `person_notes.schedule_json`, `pending_invites` all hold overlapping views. Fine when the LLM reads them all on demand; currently each caller pre-marshals a partial view and drops the rest.
7. **Waitpoint token versioning** — `sessions.match_attempt` exists *purely* because Trigger.dev waitpoint keys dedupe by idempotency key. The token gymnastics solve a problem that wouldn't exist if the pipeline were synchronous per turn (which it can be — matching is < 1 s of compute).
8. **Two competing conversation-race guards** — Worker pre-log + the in-task 1.2 s sleep + the unreplied-message scan. Three layers because each fixed a different race at a different time. New handler can use one mechanism: "this turn's recent history is whatever `getRecentMessages(chatId)` returns at the moment the handler wakes, after a 1 s grace period".
9. **Intent fast-paths** — images, documents, /start, phone numbers. Each was added to skip Haiku "for speed". Each strips context. One of them caused the Diego bug.
10. **`fast-path simple scenarios`** in response-generator — uses static strings for 5 scenarios to "save 1 s". Zero measurable benefit; complicates the mental model.

## Deliverable

This document IS the deliverable for phase 01. No code changes. Phases 02+ act on these verdicts.
