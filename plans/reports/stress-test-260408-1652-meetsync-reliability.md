# MeetSync Reliability Stress Test — 2026-04-08

## 1. Endpoint Health

All four checks passed against live worker:

| Test | Expected | Actual |
|---|---|---|
| GET /webhook (no token) | 403 | 403 |
| GET /privacy | 200 | 200 |
| POST /webhook (no signature) | 401 | 401 |
| POST / | 404 | 404 |

## 2. D1 Database Integrity

**Schema:** 9 tables present. All FK constraints use `ON DELETE CASCADE` (participants, free_slots reference sessions). Correct.

**Orphans:** 0 orphaned participants, 0 orphaned free_slots. Clean.

**Stale sessions:** 0 expired sessions with non-terminal status. Clean.

**Live data:**
- 2 sessions (1 PAIRED, 1 EXPIRED)
- 3 participants
- 4 rate_limit rows

**Anomaly — [MEDIUM] `sessions.partner_phone` is NULL on PAIRED session:**
Session `d363d7bd` has status `PAIRED`, 2 participants in the `participants` table, but `partner_phone` column is NULL. The `handleJoinSession` function sets `status='PAIRED'` and inserts into `participants` but never sets `sessions.partner_phone`. The column exists in the schema but is never written. Code that reads `partner_phone` (e.g. `handleNewSession` only touches `creator_phone`) won't break, but the field is misleading and wastes space. Low functional impact today; high confusion risk later.

**Indexes:**
All expected indexes present: `idx_participants_phone`, `idx_participants_session`, `idx_sessions_code`, `idx_sessions_status`, `idx_free_slots_session`, `idx_rate_limits_phone_ts`, `idx_partners_phone_a`, `idx_partners_phone_b`.

**Missing index — [LOW] `sessions.creator_phone`:**
`handleNewSession` and `resetUserData` both run `UPDATE sessions WHERE creator_phone = ?`. No index on `creator_phone`. At current scale irrelevant; worth adding before user growth.

## 3. Rate Limiting Logic

**DB failure → fail-open [MEDIUM]:**
The entire `checkRateLimit` function is wrapped in a single try/catch that returns `{ status: "ok" }` on any error (line 107-109). A D1 outage silently disables rate limiting for all users. Not a crash risk, but a spam vector if Cloudflare D1 has a regional hiccup. Acceptable trade-off for reliability, but worth documenting.

**`last_strike` null handling [LOW]:**
The guard at line 43 is `if (strike && strike.last_strike)` — both conditions required. The schema has `last_strike TEXT NOT NULL DEFAULT (datetime('now'))`, so NULL is theoretically impossible for existing rows, but the double-guard is correct defensive coding. No bug.

**24h decay logic — correct but has a race:**
After detecting `hoursSinceLastStrike > 24`, the code does `DELETE FROM rate_strikes` then falls through to count recent messages. If the message count then hits MAX_REQUESTS again in the same request (10 messages in 60s), a new strike is inserted. That's correct behavior. The decay resets cleanly.

**Cooldown bypass — [MEDIUM] possible:**
The 10-message window is 60 seconds (`WINDOW_SECONDS = 60`). The cleanup at line 98-99 deletes entries older than `windowStart - WINDOW_SECONDS` (i.e., 120s old), not `windowStart` (60s old). This means a user can:
1. Send 9 messages → rate_limits has 9 rows
2. Wait 61 seconds (window expires, count = 0)
3. Send 9 more messages (still no cooldown because count never hit 10)
4. Repeat indefinitely

This is a sliding window, not a fixed window, but the count reset is working correctly. However, the user can sustain ~9 msg/60s indefinitely without ever triggering a strike. The limit is effectively per-burst, not per-sustained-rate. At 9 messages/minute that's 540/hour — enough to spam Claude API. Recommend lowering `WARN_THRESHOLD` to 5 and `MAX_REQUESTS` to 7, or adding a longer secondary window (e.g., 50 messages per 10 minutes).

**Admin exempt from rate limiting — [LOW] confirmed correct:**
Admin commands are handled before the blocklist/rate-limit checks (lines 22-25 in `handle-message.ts`). If admin sends 100 messages they bypass rate limiting. Intentional but worth noting for security review.

## 4. State Machine Completeness

All states reachable via the router. Tracing state × intent combinations:

**States handled explicitly:** CREATED_SESSION, AWAITING_SCHEDULE, SCHEDULE_RECEIVED, AWAITING_CONFIRMATION, SCHEDULE_CONFIRMED, AWAITING_PREFERENCES, PREFERENCES_SUBMITTED, COMPLETED.

**`unknown_intent` reachability:** Correctly reachable from all states — the `intent === "unknown"` check at line 95 fires before the switch statement. Any state + unknown intent → conversational response. Good.

**[MEDIUM] `AWAITING_CONFIRMATION` + `clarify_schedule` with no `schedule_json`:**
Handler at line 397: `if (intent === "clarify_schedule" && params.clarification && participant.schedule_json)`. If `schedule_json` is null (e.g., parsing stored nothing), the condition silently falls through to the `confirm_prompt` fallback. The user gets "Reply yes/no" when they asked to clarify. Not a crash, but confusing UX. Should add an explicit branch for `clarify_schedule` with null `schedule_json` → ask them to re-upload.

**[LOW] `SCHEDULE_CONFIRMED` state — only `create_session` and `greeting` exit:**
A confirmed user waiting for partner who sends "status" or "help" is handled by global intents (lines 59-77) before the switch, so those work fine. No gap here.

**[LOW] `PREFERENCES_SUBMITTED` + any non-global intent:**
Falls through to the switch default → `unknown_state_error` scenario. That's safe. But a user asking "what slots did I pick?" while in PREFERENCES_SUBMITTED gets "Something unexpected happened" instead of a helpful answer. Minor UX gap.

**`clarify_schedule` intent classification bias — [HIGH]:**
The intent router system prompt correctly biases toward `clarify_schedule` over `reject_schedule` when user widens scope (e.g., "check the whole month"). However, `classifyIntent` passes `message_type === "image"` as `upload_schedule_text` fast-path (line 92-94 in `intent-router.ts`), which bypasses Claude entirely. In state `AWAITING_CONFIRMATION`, if a user sends a new photo (re-upload attempt), the router returns `upload_schedule_text` intent, but `handleAwaitingConfirmation` has no branch for `upload_schedule_text`. The message falls through to `confirm_prompt` fallback: "Reply yes or no". The user's new photo is silently discarded. **This is a real UX bug.** A user who sends a new schedule photo to correct a bad parse gets told to say yes/no instead of re-parsing.

**Fix:** In `handleAwaitingConfirmation`, add a check: if `message_type === "image" || message_type === "document"` (available via payload), treat it as `reject_schedule` and trigger re-parse.

## 5. Admin Command Security

**Admin-only gate — correct:**
Lines 22-25 in `handle-message.ts`: `if (env.ADMIN_PHONE && routerPayload.phone === env.ADMIN_PHONE && routerPayload.text)`. Non-admin phones never reach `handleAdminCommand`. Confirmed correct.

**Non-admin sending "block 35699xxx" — safe:**
Goes through normal bot flow (blocklist check → rate limit → triggerMessageRouter). They get a normal response from the message router, never an admin action.

**[HIGH] `ADMIN_PHONE` not set — silent degradation:**
If `ADMIN_PHONE` env var is missing:
1. Admin command gate (`env.ADMIN_PHONE && ...`) is falsy → admin messages treated as regular user messages
2. `sendAdminReply` calls `sendReply(env, env.ADMIN_PHONE, ...)` → `env.ADMIN_PHONE` is undefined → WhatsApp API called with `to: undefined` → API error, silently swallowed
3. Rate limit admin notification at line 85: `if (strikes === 1 && env.ADMIN_PHONE)` — correctly guarded, no send attempted

Net effect: if `ADMIN_PHONE` is unset, admin cannot issue commands (gets normal bot responses) and doesn't receive spam notifications. Not a crash, but operational blindness. Should throw on startup or log a warning.

**[LOW] Admin intent classification uses Claude Haiku with keyword fast-path:**
Fast-path keywords: `["block", "unblock", "remove", "ban", "kick", "who", "users", "list", "allowed"]`. Normal user messages containing "who" or "list" (e.g., "who should I schedule with?") will trigger a Haiku API call to classify admin intent. Haiku correctly returns `not_admin`, no action taken. Small unnecessary API cost per user message containing these words.

## 6. Response Generator Reliability

**SCENARIO_INSTRUCTIONS vs STATIC_FALLBACKS parity:**

| Scenario | In INSTRUCTIONS | In STATIC_FALLBACKS |
|---|---|---|
| show_status | yes | yes |
| unsupported_media | yes | yes |
| reset_all | yes | yes |
| new_partner | yes | yes |
| idle_welcome | yes | yes |
| session_created | yes | yes |
| created_session_reminder | yes | yes |
| invalid_code | yes | yes |
| already_joined | yes | yes |
| joined_session | yes | yes |
| partner_notified | yes | **no** |
| returning_partner_creator | yes | yes |
| returning_partner_partner | yes | yes |
| missing_media | yes | yes |
| remind_upload | yes | yes |
| schedule_confirmed | yes | yes |
| schedule_rejected | yes | yes |
| confirm_prompt | yes | yes |
| remind_preferences | yes | yes |
| session_complete | yes | yes |
| unknown_state_error | yes | yes |
| cancel_self | yes | yes |
| cancel_partner | yes | yes |
| show_help | yes | yes |
| unknown_intent | yes | yes |
| preferences_saved | yes | yes |
| shifts_extracted | yes | yes |
| no_shifts_found | yes | yes |
| parse_error | yes | yes |
| nudge_reminder | yes | yes |
| session_expired | yes | yes |
| meetup_reminder | yes | yes |
| no_overlap | yes | yes |
| mutual_match | yes | yes |
| best_match | yes | yes |

**[HIGH] `partner_notified` scenario has no static fallback:**
`SCENARIO_INSTRUCTIONS` contains `partner_notified` but `STATIC_FALLBACKS` does not. If Claude API fails during a `partner_notified` call, `getStaticFallback` falls through to the generic string `"Something went wrong. Send *help* if you're stuck."` which is sent to an existing participant when a new person joins their session. Confusing but not silent. This scenario is actually used in `message-router.ts` line 43 `partner_notified` — wait, checking: line 317 sends the notification via a static string inline: `"Someone joined your session! Send your work schedule..."`. So `partner_notified` in SCENARIO_INSTRUCTIONS is never called from code. Dead scenario. Low actual impact but indicates drift between instructions and code.

**`unknown_intent` fallback — partial coverage [LOW]:**
The static fallback for `unknown_intent` only covers states: IDLE, CREATED_SESSION, AWAITING_SCHEDULE, AWAITING_CONFIRMATION, AWAITING_PREFERENCES. States SCHEDULE_RECEIVED, SCHEDULE_CONFIRMED, PREFERENCES_SUBMITTED, COMPLETED fall to `?? "Send *help* if you're stuck."` which is acceptable but not state-aware. Only affects the Haiku API-down scenario.

**Fallback strings are non-empty and useful — confirmed.**

## 7. Claude API Cost per Message Flow

| Flow | API Calls | Model | Est. Cost (per flow) |
|---|---|---|---|
| Normal text message (non-admin keywords) | 1 (intent classify) + 1 (response generate) | 2x Haiku | ~$0.0002 |
| Text with admin keywords (non-admin user) | 1 (intent classify) + 1 (admin classify) + 1 (response generate) | 3x Haiku | ~$0.0003 |
| Schedule upload (image/PDF) | 0 (intent fast-path) + 1 (schedule parse Sonnet) + 1 (response generate) | 1x Sonnet + 1x Haiku | ~$0.003–0.01 |
| Clarify schedule | 1 (intent) + 1 (schedule parse Sonnet re-run) + 1 (response) | 1x Sonnet + 2x Haiku | ~$0.004–0.01 |
| Admin command | 1 (intent classify) + 1 (admin classify) | 2x Haiku | ~$0.0002 |
| Unknown intent | 1 (intent) + 1 (response) | 2x Haiku | ~$0.0002 |

Schedule parsing uses `claude-sonnet-4-20250514` (not Haiku) — the dominant cost. For 100 users per day each uploading one schedule: ~$0.30–$1.00/day in Claude API. Intent classifier and response generator at Haiku pricing are negligible.

Note: `handle-message.ts` uses `claude-haiku-4-5-20251001`. `schedule-parser.ts` uses `claude-sonnet-4-20250514`. These are valid model IDs as of the knowledge cutoff but should be verified against current Anthropic pricing/availability.

## 8. Concurrency Concerns

**[HIGH] Double-confirm race condition in `checkBothConfirmed`:**
Sequence: User A and User B confirm their schedules in the same second.
1. A's task calls `getSessionParticipants` → both show SCHEDULE_CONFIRMED (if B's DB write already committed) → calls `wait.completeToken`
2. B's task calls `getSessionParticipants` → both show SCHEDULE_CONFIRMED → also calls `wait.completeToken` with the same `tokenId`

The Trigger.dev `wait.completeToken` is called twice with the same token. If Trigger.dev is idempotent on token completion, this is safe. If not, the second call either errors (swallowed by the polling loop) or triggers the orchestrator twice. The polling loop (5 attempts × 2s = 10s) in `checkBothConfirmed` mitigates the token-not-found case but does not protect against double-completion. **Needs verification** that Trigger.dev `wait.completeToken` is idempotent.

More likely failure mode: A confirms, B's state write hasn't committed yet when A reads. A sees only A=CONFIRMED, returns early (line 471: `if (!participants.every(...)) return`). B confirms, B's task reads both CONFIRMED, completes the token. Orchestrator proceeds normally. This is the happy path and works fine.

**[MEDIUM] Duplicate WhatsApp message delivery (Meta retries):**
WhatsApp retries webhook delivery if the Worker doesn't return 200 within ~5 seconds. The Worker always returns 200 immediately (line 68, `ctx.waitUntil` for async processing). Meta deduplication via message ID is not implemented — the Worker calls `triggerMessageRouter` which uses `idempotencyKey: wa-{phone}-{timestamp}`. Two deliveries of the same message have the same phone + timestamp → same idempotency key → Trigger.dev deduplicates. **This works correctly.** The idempotency key design handles Meta retries.

**[HIGH] Session orchestrator triggered twice:**
`sessionOrchestrator.trigger({ session_id })` is called in two places:
1. `handleReturningPartner` (line 216)
2. `handleJoinSession` when `isFirstPartner` (line 309)

Both use `task.trigger()` without an idempotency key. If the same join event is processed twice (e.g., network retry before idempotency key deduplicated at Trigger.dev), two orchestrator instances could run for the same session. Each creates waitpoint tokens with `idempotencyKey: confirmed-{session_id}` — Trigger.dev should deduplicate the token creation. However, both orchestrators would race to write `both_confirmed_token_id` and `both_preferred_token_id` to the sessions table. The second write overwrites the first, invalidating the first orchestrator's token reference. One orchestrator would wait forever. This is a low-probability but unrecoverable state.

**Fix:** Add idempotency key to `sessionOrchestrator.trigger` calls: `{ idempotencyKey: orchestrator-${session_id} }`.

**[MEDIUM] `checkBothConfirmed` polling window (5 attempts × 2s = 10s):**
The orchestrator creates tokens and writes them to the DB immediately after startup. Between `wait.createToken` and the `UPDATE sessions SET both_confirmed_token_id = ?` write, there is a tiny window where both participants could confirm and `checkBothConfirmed` polls 5 times finding `null`. After 10s the warning is logged and the token is never completed — orchestrator waits forever (up to 7-day timeout). This is a race that requires both users to confirm within ~10 seconds of each other AND before the orchestrator's first DB write commits — extremely unlikely in practice but theoretically possible.

---

## Summary of Issues by Severity

| # | Severity | Location | Issue |
|---|---|---|---|
| 1 | HIGH | `message-router.ts` L323+, `intent-router.ts` L92 | Image/doc in AWAITING_CONFIRMATION state silently discarded — user gets "reply yes/no" instead of re-parse |
| 2 | HIGH | `handle-message.ts` L22, L183 | ADMIN_PHONE unset = admin loses all control silently |
| 3 | HIGH | `message-router.ts` L216, L309 | `sessionOrchestrator.trigger` has no idempotency key — double-trigger can produce two competing orchestrators |
| 4 | HIGH | `response-generator.ts` | `partner_notified` in SCENARIO_INSTRUCTIONS but no STATIC_FALLBACKS entry (dead code, misleading) |
| 5 | MEDIUM | `rate-limit.ts` L107-109 | Fail-open on DB error silently disables all rate limiting |
| 6 | MEDIUM | `rate-limit.ts` | Burst bypass: 9 msg/60s sustained indefinitely never triggers a strike |
| 7 | MEDIUM | `message-router.ts` L397 | `clarify_schedule` with null `schedule_json` silently falls to confirm_prompt |
| 8 | MEDIUM | `session-orchestrator.ts` | `checkBothConfirmed` double-completion: two parallel confirms can both call `wait.completeToken` |
| 9 | MEDIUM | `sessions` table | `partner_phone` never written despite being set by join flow; data inconsistency |
| 10 | MEDIUM | `session-orchestrator.ts` | 10s polling window for token availability — unrecoverable if missed |
| 11 | LOW | `sessions` table | Missing index on `creator_phone` |
| 12 | LOW | `handle-message.ts` L127 | Admin keyword fast-path causes unnecessary Haiku call for normal users using words like "who"/"list" |
| 13 | LOW | `response-generator.ts` | `unknown_intent` fallback not state-aware for SCHEDULE_RECEIVED, SCHEDULE_CONFIRMED, PREFERENCES_SUBMITTED, COMPLETED |

---

## Unresolved Questions

1. Is `wait.completeToken` in Trigger.dev SDK v4 idempotent when called with the same token ID twice? Determines whether issue #8 is critical or benign.
2. What is the Trigger.dev behavior for `task.trigger()` without idempotency key when called twice in rapid succession — is it queued or deduplicated at the platform level?
3. Is `claude-haiku-4-5-20251001` and `claude-sonnet-4-20250514` the latest/correct model IDs? Knowledge cutoff is Aug 2025; verify in Anthropic dashboard.
