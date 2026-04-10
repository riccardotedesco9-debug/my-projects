# MeetSync Code Review — final pass

Scope: 11 files, recent hammering + patches. Focused on bugs, state soundness, dead code, prompts.

## Critical issues

1. **Duplicate invite spam when creator names multiple partners** — `message-router.ts:519-539` loops `handleAwaitingPartnerInfo` per name. For each unknown name it calls `createPendingInvite(... participant.session_id)` and replies with `https://t.me/.../invite_${session_id}`. **All N invites share the same session_id**, so the link is literally identical N times, and `pending_invites` ends up with N duplicate rows for one session. `getPendingInviteForSession` then returns just the newest (`ORDER BY created_at DESC LIMIT 1`) — the earlier dupes are zombies, and the creator gets 3× "here's the link" + 3× "ask_more_or_schedule" spam in a row. Needs: dedupe per name, send invite link once, or name-per-invite distinction.

2. **Consolidation double-consumes messages (race)** — `message-router.ts:139-152`. If msgs A and B arrive within 3s, A's router reads only itself (B not yet logged → handles A alone), then B's router reads both, prepends A to B, and **processes A a second time** (re-logged A is still in history because A was already logged at line 137). The "unreplied" filter doesn't help: after A's run, a bot reply was logged, so B's scan stops at that bot msg — but only if A's bot reply happened *before* B's scan. If B's run starts before A finishes (very common — webhook hits are concurrent), A's bot reply isn't logged yet, so B sees `[A_user, B_user]` with no bot in between and prepends A. Result: A handled twice, possibly creating double participants/invites. `created_at` is second-precision too, so ordering within the same second is unstable. Consider a per-chat lock or a "consumed" flag.

3. **`sendTextMessage` logs before the send succeeds** — `telegram-client.ts:32`. If the Telegram API call throws (e.g., 429, network), the bot message is already in `conversation_log` but the user never saw it. On the next turn the bot reads its own phantom reply and assumes "I already asked that", so it silently won't re-ask. Swap order: send first, log on success.

4. **`checkAllPreferred` never starts the orchestrator if somehow missing** — `message-router.ts:1173-1189`. If the preferred token is missing (orchestrator crashed / not yet created), it logs a warning and returns — session hangs forever with no user-facing error. Less critical than `checkAllConfirmed` but still a silent dead-end.

## High-priority findings

5. **Double-logging regression** — `schedule-parser.ts:180, 199, 208` and `deliver-results.ts:52, 87, 107` call `sendTextMessage` directly (good — logs once). But `session-orchestrator.ts:63, 82, 98, 165, 198` also calls `sendTextMessage` directly (good). **However**: `deliver-results.ts:107` sends `"Added to your Google Calendar."` which gets logged — fine. No actual double-logging leak found, but `message-router.ts:137` still calls `logMessage(chatId, "user", text)` for inbound (correct — `sendTextMessage` only logs bot). **OK** — but verify no stray `logMessage(..., "bot", ...)` exists: grep shows only `telegram-client.ts` logs bot messages. Clean.

6. **`AWAITING_PARTNER_INFO` + schedule upload + `isScheduleText` predicate bug** — `message-router.ts:304`. `isScheduleText` excludes `confirm_schedule`/`reject_schedule`/`clarify_schedule`, but not `upload_schedule_text` itself. Good. BUT — if the user is in `AWAITING_CONFIRMATION` and the LLM classifies their message as `upload_schedule_text` with `schedule_text` set (very possible with verbose messages), line 306 excludes `AWAITING_CONFIRMATION` from the routing block, so it falls through to the switch, hits `AWAITING_CONFIRMATION` case, and `handleAwaitingConfirmation` ignores schedule_text entirely. The user's re-upload is dropped silently.

7. **`handleNewSession` skipAskPartner path skips `appendUserContext` for learned schedule** — when the opening message has `schedule_text`, lines 544-562 trigger the parser but never `appendUserContext` the schedule text, whereas the `isScheduleText` block at line 308 does. Minor inconsistency — no functional break but knowledge-base drift between flows.

8. **Language detection mutation leaks into session-orchestrator replies** — `message-router.ts:176` writes `updateUserLanguage` on substantial text. But `sessionOrchestrator` and `scheduleParser` fetch `getUser(chat_id)` fresh each time (good). The in-memory mutation on line 177 is only used by the current turn, which is the intended fix — **OK**.

9. **`handleCancel` doesn't clear creator's `user.name` / context** — that's fine (by design — name persists). But it leaves `conversation_log` full of old state. On next `create_session`, `getRecentMessages` returns 12 stale entries including "Session cancelled" bot messages, which the intent classifier sees as context. The `reset_all` path wipes `conversation_log` but `cancel` doesn't. Could confuse Claude Haiku ("bot already asked name? no it said cancelled"). Low risk but notable.

10. **`reset_all` confirmation marker brittle** — `message-router.ts:222` detects previous reset prompt via `lastBotMsg?.message.includes("wipe everything")`. Hard-coded English. If a user asks in Italian, the LLM translates the confirm prompt ("cancellare tutto"), and `.includes("wipe everything")` fails → loops forever asking for confirmation.

11. **`buildWeekdayLookup` uses `new Date()` local time, but iterates via `setUTCDate`** — `schedule-parser.ts:43-51`. Mixed local/UTC math. At midnight UTC boundaries the "today" reference can be off by a day relative to the iso strings. Use `new Date(Date.UTC(...))` or consistent UTC throughout.

12. **`handleSendAvailability` sends to ALL others, but only creator enters `PREFERENCES_SUBMITTED`** — `message-router.ts:1040-1063`. Partners are moved to `AWAITING_PREFERENCES`. If the session has 3+ people, the creator's `PREFERENCES_SUBMITTED` state satisfies 1/N but `checkAllPreferred` needs all participants in `PREFERENCES_SUBMITTED`. Works for 2-person case, breaks quietly for N≥3 in mediated mode (no one ever completes → `deliverResults` never fires until preferences timeout).

## Medium findings

13. **`findUserByChatId` unused** — `d1-client.ts:264` just wraps `getUser`. Only imported in `message-router.ts:22`, never called. Dead wrapper.

14. **`computeSinglePersonSlots` import unused** — wait, it IS used at `message-router.ts:1003`. OK.

15. **`canProceedToScheduling` vs raw `getParticipantCount` in same file** — `message-router.ts:327-336` checks `count >= 2` inline instead of using the helper. Inconsistent (the helper also counts pending invites — inline check doesn't). This block fires when the user is in `AWAITING_PARTNER_INFO` and sends a schedule: if count is 1 + 1 pending invite, the helper would say "proceed" but this block doesn't trigger `PAIRED`/orchestrator, leaving the session in OPEN while state transitions to AWAITING_SCHEDULE. Should use `canProceedToScheduling`.

16. **Silent D1 cleanup catches** — `d1-client.ts:398-403` and `rate-limit.ts:97-98` fire-and-forget `DELETE` with `.catch(() => {})`. On D1 outages these fail silently and storage grows. Acceptable trade-off but worth a debug log.

17. **`extraContext: String(params.partner_name)`** — `message-router.ts:768`. Passes just the name as "extra context" which is a weird abuse of the field. Works because `partner_not_found` prompt doesn't parse it, but muddy.

18. **`handleIdleUser` accepts any Record for params** — `message-router.ts:433`. Loses type safety from `IntentResult.params`. Same at line 637 (`handleAwaitingPartnerInfo`). Could type as `IntentResult["params"]`.

19. **Language guard too weak** — `message-router.ts:174` `text.split(/\s+/).length >= 4` — "ciao sono stefano ok" is 4 words and would switch to Italian on the strength of one casual line. Works for the target use case but false-positives possible.

20. **`rate-limit.ts:98` cleanup window** — `windowStart - WINDOW_SECONDS` deletes entries older than 2×window. Comment-worthy but fine.

21. **`checkAllConfirmed` 3s `setTimeout` after trigger** — `message-router.ts:1156`. Arbitrary sleep to let orchestrator register the token. Fragile — race-prone under load. Consider polling with the existing 5-attempt loop *without* the pre-sleep.

22. **Mixed error styles** — some handlers return `{ action: "error" }`, some throw, some swallow. No central typed return. Not a bug, just DRY drift.

23. **`intent-router.ts` SYSTEM_PROMPT is 60 lines** — the examples are good but the "CRITICAL — MULTI-PARAM EXTRACTION" section partially overlaps with the context rules below. A model that follows both rule sets will work, but the prompt is near the boundary where adding more examples starts hurting recall.

24. **`response-generator.ts:40` `extraContext` rule contradicts reality** — rule says "If extraContext contains 'Plus N other shifts extracted'...do NOT repeat it". But callers no longer pass that string (schedule-parser comment at line 196-198 confirms it was removed). The rule is **legacy** prompt noise. Drop it.

25. **`best_match` rule softened** — `response-generator.ts:113` is good, but instruction "Say something low-key like 'here's one that works for everyone'" is prescriptive — the static fallback already uses that exact phrase. If Claude copies it verbatim every time, you've just hard-coded the string via prompt. Consider just "pick casual phrasing".

## Nits

26. `message-router.ts:105` — `as { message_type: string; text?: string }` cast is unnecessary since destructuring already returns them.
27. `message-router.ts:159` — `const recentMessages = allRecent` — just alias, drop one.
28. `message-router.ts:270` — `(user ?? ({} as UserProfile))` sprayed across file; a `mutateUserName` helper would DRY this.
29. `schedule-parser.ts:278-280` — "fully free" detection repeats twice (filter + complementary filter). Use a partition helper.
30. `deliver-results.ts:11` and `session-orchestrator.ts:17` — identical `buildReplyContext`. Move to `d1-client.ts` as `getReplyContext`.
31. `response-generator.ts:47` — "There are NO session codes" is true but `deliver-results.ts` / db still stores `code`. Harmless contradiction but could be confusing to future readers.
32. `match-compute.ts:137` `explainSlotN` — the "N" suffix was meaningful when there was a 2-person version. Dead suffix.
33. `message-router.ts:75` split-at-newline logic has off-by-one: `cutAt > 2000 ? cutAt : 4000` — if cutAt is exactly 4000, splits at 4000 (fine), but a newline at 1999 falls back to 4000 and potentially splits mid-word.
34. `intent-router.ts:164` phone fast-path only runs in `AWAITING_PARTNER_INFO`. Fine, but documents a single state implicitly.

## What looks good

- **Schedule parser weekday lookup** — great fix. The framing A / framing B split is clear and handles the "I'm flexible" persona cleanly.
- **`canProceedToScheduling` helper** — correct abstraction, reads nicely.
- **`sendTextMessage` internal logging** — dramatically reduces caller bookkeeping; most call sites are clean.
- **Telegram test-user guard** — `TEST_CHAT_IDS` sentinel is tidy and symmetrical in Worker + Trigger.
- **Idempotency key fix** — `tg-${chatId}-${telegramMessageId}` in `handle-message.ts:272` is the right shape.
- **Rate limiting** — escalating cooldowns + admin notify + fail-open on DB errors is a solid pragmatic design.
- **`appendUserContext` prompt-injection guard** — good instinct, cheap defense.
- **`session-orchestrator` waitpoint + nudge** — clean use of Trigger.dev v4 primitives.
- **Language mutation in-turn** — subtle bug correctly solved (the comment at line 172-173 is spot-on).
- **`deliver-results` graceful Google Calendar fallback** — never blocks delivery on optional integration.
- **D1 schema column allowlist in `updateParticipantState`** — nice SQL-injection hardening.
- **Match compute N-way intersection via reduce** — genuinely elegant.

## Recommended follow-ups

1. **Fix multi-partner invite fan-out** (Critical #1) — dedupe invites per name, or send one shared link with a list of invitees.
2. **Lock or deduplicate consolidation** (Critical #2) — per-chat mutex in D1, or mark messages as consumed.
3. **Swap order in `sendTextMessage`** (Critical #3) — send, then log.
4. **Route `upload_schedule_text` correctly from `AWAITING_CONFIRMATION`** (#6) — schedule re-uploads via text currently drop.
5. **Wipe `conversation_log` on cancel too** (#9), OR mark a session boundary so future turns ignore pre-cancel history.
6. **Translate / marker-ify the reset confirm sentinel** (#10) — use a hidden zero-width marker, not English prose.
7. **`handleSendAvailability` N≥3 case** (#12) — creator should also enter `PREFERENCES_SUBMITTED` only after others submit, or mediated mode should be 2-only and rejected otherwise with a clear message.
8. **Trim dead wrappers & legacy prompt rules** (#13, #24, #32).
9. **Collapse `buildReplyContext` into `d1-client.ts`** (#30).
10. **Replace 3s `setTimeout` in `checkAllConfirmed` with poll-only loop** (#21).

## Unresolved questions

- Does `pending_invites` have a UNIQUE constraint on `(session_id, invitee_chat_id)`? Couldn't read migrations — if not, critical #1 is worse.
- Is `conversation_log.created_at` actually second-precision? If milli, the race in critical #2 narrows but doesn't disappear.
- Does Trigger.dev dedupe `idempotencyKey: orch-${session_id}-${Date.now()}` at all? Every trigger call uses `Date.now()` so the key is effectively unique — is that intentional (new orchestrator per call) or a bug (should reuse one)?
- Is `createPendingInvite(chatId, null, session_id)` with no phone considered "active"? If so, pending invites from name-only lookups never auto-expire by phone and may linger.
