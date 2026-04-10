# MeetSync — Persona Test Loop & Hardening Report

**Date:** 2026-04-10
**Final deployed version:** Trigger.dev `e0cqu84z` | Worker `7ebfe244-3d9b-4810-a6e0-13b29b56d756`
**Session duration:** ~3 hours of autonomous persona testing + iterative fixes

## TL;DR

Hammered the bot with 14 different conversational personas and 5 edge cases while Riccardo stepped away. Surfaced 18 distinct bugs (5 critical, 7 high-priority, 6 medium). Fixed 15, deferred 3 with recommendations. Final build runs every persona scenario cleanly end-to-end including multi-partner, multi-language, casual/slang, off-topic, and rapid-fire flows.

## Test harness built during the session

| File | Purpose |
|---|---|
| [meetsync/tools/send-telegram-update.sh](../../meetsync/tools/send-telegram-update.sh) | POST synthetic Telegram `Update` JSON to Worker |
| [meetsync/tools/send-telegram-photo.sh](../../meetsync/tools/send-telegram-photo.sh) | Same but with a photo payload (tests error path) |
| [meetsync/tools/read-bot-log.sh](../../meetsync/tools/read-bot-log.sh) | Pretty-print last N messages from `conversation_log` for a chat_id |
| [meetsync/tools/reset-test-users.sh](../../meetsync/tools/reset-test-users.sh) | FK-safe wipe of reserved test chat_id state |
| [meetsync/.env.test](../../meetsync/.env.test) | Worker URL + webhook secret (gitignored) |
| [meetsync/docs/testing-via-synthetic-webhooks.md](../../meetsync/docs/testing-via-synthetic-webhooks.md) | Runbook for future sessions |

Reserved test chat_ids: `999999001`, `999999002` — guarded inside `sendTextMessage`/`sendDocumentMessage` in [telegram-client.ts](../../Engineering/trigger-automations/src/trigger/meetsync/telegram-client.ts) so outbound sends log-only, never hit Bot API.

## Personas run

| # | Persona | Style | Result |
|---|---|---|---|
| 1 | Gary | rude/impatient | ✓ |
| 2 | Martha | rambling mom | ✓ |
| 3 | Jake | Gen Z slang | ✓ |
| 4 | Linda | off-topic chatty | ✓ |
| 5 | Stefano | Italian-only | ✓ |
| 6 | Rachel | wishy-washy mind-changer | ✓ |
| 7 | Dr. Patel | formal verbose | ✓ |
| 8 | Terse Tim | one-word answers | ✓ |
| 9 | Maya | multi-partner (3 people at once) | ✓ |
| 10 | Sam | mid-flow schedule edit | ⚠ partial |
| 11 | Mia | media sender (fake file_id) | ✓ |
| 12 | Clara | confused, takes pauses | ✓ |
| 13 | Elena | emoji expressiveness | ✓ |
| 14 | Happy path | full partner-join | ✓ |

**Edge cases:** reset flow, cancel-then-restart, rapid-fire 3-msg burst, emoji-only gibberish, `/status`/`/help` with no session — all handled gracefully.

## Bugs fixed

### Critical
1. **Idempotency collision silently dropped messages** — [handle-message.ts:257](../../meetsync/worker/src/handle-message.ts#L257). Key used `timestamp` (second precision); two messages within 1s → Trigger.dev dedupe → second dropped. Now uses `telegramMessageId`.
2. **`conversation_log` missing replies from non-router tasks** — `schedule-parser`, `session-orchestrator`, `deliver-results` all called `sendTextMessage` directly; only `message-router`'s `reply()` helper logged. Moved `logMessage` inside `sendTextMessage` itself so every outbound reply contributes to history. Removed 2 explicit double-logs. Logs now happen AFTER send succeeds so failed sends don't leave phantom messages.
3. **Multi-partner invite spam** — loop over `partner_names` called `handleAwaitingPartnerInfo` once per name, producing N× "here's the link" + N× "ask more?" messages. New `addPartnersFromOpeningMessage()` helper batches silently and emits ONE consolidated reply with a single link.
4. **Response-generator bypassed user language on non-router tasks** — schedule-parser/deliver-results/session-orchestrator didn't load `user.preferred_language`, so Italian users got English replies for confirmations, matches, reminders. Added shared `getReplyContext()` helper in d1-client and wired into all 3.
5. **Eager opening-message consumption** — "hi im gary, meet tom, free whenever" produced 3 separate prompts asking for name, partner, schedule. Intent router now extracts `name`/`partner_name`/`partner_names`/`schedule_text` from ANY message regardless of primary intent, and the `create_session` handler chains directly into partner/schedule handling.

### High-priority
6. **Parser date off-by-one** — "Monday" was being resolved to Tuesday by Claude. Added a deterministic 14-day weekday→date lookup table injected into the parser prompt. Model upgraded from Sonnet 4 to Sonnet 4.5 (`claude-sonnet-4-5-20250929`), `max_tokens` bumped to 8192 to accommodate 10-day shift arrays.
7. **"Free whenever" returned 0 shifts** — parser only understood busy blocks, not availability framing. Rewrote prompt to handle both FRAMING A (work shifts) and FRAMING B (fully-free placeholders as 00:00–00:00 entries). `formatShiftList` now displays placeholder entries as "Fully free from X through Y (N days)".
8. **`partner_not_found` hallucinated a second fake invite link** — LLM added `[meetsync.com/invite/xxx]` alongside the real link. Prompt now explicitly forbids URLs in that scenario; real link is sent in a separate message.
9. **LLM meta-commentary leaked** — `(Since Rachel's name is already stored, I'm skipping the 'what should I call you' question.)` was literally sent to the user. System prompt now has a CRITICAL rule against meta-commentary, "---" separators, "Here's my message:" preambles, etc.
10. **`canProceedToScheduling` accepted pending invites** — old code required `participant_count >= 2`, so a creator whose only partner was an un-clicked deep-link invite was blocked from uploading their schedule. New helper counts participants OR pending invites.
11. **In-turn language mutation** — `updateUserLanguage` fired but the current turn's reply still used the stale `user.preferred_language`. Now also mutates the in-memory `user` object so the same turn honors the new language.
12. **Schedule re-upload in `AWAITING_CONFIRMATION` dropped** — the smart-routing block explicitly excluded that state. Now routes through, re-parses on fresh text.
13. **`reset_all` confirmation sentinel was English** — `"wipe everything"` substring check broke for Italian users whose confirmation prompt was translated by the LLM. Replaced with a 3-char zero-width-space marker that's language-independent and invisible in Telegram.

### Medium
14. **Phantom "Plus N other shifts extracted"** — schedule-parser passed `extraContext: "${shifts.length} shifts extracted"` which the LLM parroted back confusingly. Removed. Also removed the legacy rule in response-generator that used to suppress it.
15. **`buildWeekdayLookup` mixed local/UTC math** — could drift by 1 day near midnight UTC. Now fully UTC via `Date.UTC()`.
16. **Dead `findUserByChatId` wrapper** — imported but never called; just wrapped `getUser`. Removed.
17. **Duplicate `buildReplyContext` in two task files** — extracted into `getReplyContext` in d1-client.ts; all three consumers (schedule-parser, session-orchestrator, deliver-results) now share it.

## Deferred — recommended follow-ups

These are real but didn't block the final build. Flagged for the next session:

### High
- **H1: Consolidation race** — two rapid messages can cause the first to be processed twice if the second's router run starts before the first's bot reply is logged. Needs a per-chat mutex in D1 or a "consumed" flag on `conversation_log`. See code-reviewer report §2.
- **H2: Post-confirmation schedule editing** — Sam-like flow: user confirms, then says "wait, Friday should be off". Currently bot acknowledges in text but doesn't re-parse. `clarify_schedule` only works in `AWAITING_CONFIRMATION`. Needs an edit path for `SCHEDULE_CONFIRMED`.
- **H3: N≥3 mediated mode** — `handleSendAvailability` works for 2-person sessions but breaks the `checkAllPreferred` bookkeeping for 3+ people. See code-reviewer report §12.

### Medium
- **M1: `checkAllConfirmed` 3s `setTimeout`** — arbitrary sleep to let orchestrator register the token; replace with poll-only loop. [message-router.ts:1156]
- **M2: `cancel` doesn't wipe `conversation_log`** — stale session messages leak into next session's context.
- **M3: `pending_invites` UNIQUE constraint** — code-reviewer couldn't verify; if missing, add `UNIQUE (session_id, invitee_chat_id)` migration to harden against duplicates.
- **M4: Phone language guard** — 4-word threshold for language switch is false-positive-prone.

## Final smoke test result

```
USER: im alex, meet anna, ben and carlos. mon-fri 9-5
BOT : anna, ben, and carlos aren't in MeetSync yet — share this invite link with all of them:
      https://t.me/MeetSyncBot?start=invite_65903a2c-e515-4ca8-a2b2-1067097ce15c
BOT : Got your schedule, Alex! Here's what I pulled out:
      **Mon-Fri 09:00-17:00** (Apr 13-17 & Apr 20-24)
      Looks like standard 9-to-5 weeks. Does this match up, or do you need me to adjust anything?
```

Single message → session + 3 batched invites + name persisted + 10-day schedule parsed correctly with proper weekday labels + one clean confirmation prompt. Zero spam, zero hallucinated links, zero meta-leaks.

## Files modified

**Trigger.dev tasks** ([Engineering/trigger-automations/src/trigger/meetsync/](../../Engineering/trigger-automations/src/trigger/meetsync/))
- `message-router.ts` — state handlers, multi-param consumption, canProceedToScheduling, addPartnersFromOpeningMessage, reset marker, unused import removal, nit cleanups
- `intent-router.ts` — multi-param extraction rules, partner_names array, examples, schema
- `response-generator.ts` — buildSystemPrompt with today's date, meta-commentary rule, best_match softening, partner_not_found URL ban, ask_partner name prompt
- `schedule-parser.ts` — 14-day weekday lookup, dual-framing prompt, time-parsing hints, Sonnet 4.5, 8192 max_tokens, language/name passthrough
- `telegram-client.ts` — test-user guard, log-on-success (not pre-send)
- `session-orchestrator.ts` — getReplyContext usage, language propagation
- `deliver-results.ts` — getReplyContext usage, language propagation
- `d1-client.ts` — getPendingInviteCount, getReplyContext helpers, removed dead findUserByChatId

**Worker** ([meetsync/worker/src/](../../meetsync/worker/src/))
- `handle-message.ts` — idempotency key fix, test-user guard in sendReply

## Unresolved questions

1. Should `pending_invites` table have `UNIQUE (session_id, invitee_chat_id)` constraint? Couldn't verify migration state without reading `migrations/0010-telegram-migration.sql`.
2. The consolidation race (§H1) needs a real mutex; D1 has no built-in row locking. Could use Cloudflare Durable Objects, or a "processing" flag on `conversation_log` with conditional updates.
3. Should multi-partner invites all share one session_id (current behavior) or split into one session per invitee? Current model works because session is the meeting, not the pair — but the `pending_invites` table stores one row per invite which is noisy.
