# MeetSync Round-2 Code Review

Scope: new handlers in `message-router.ts` (remove/swap/amend), intent additions in `intent-router.ts`, overnight-shift split in `match-compute.ts`.

## Critical issues

**1. Amend-after-confirm doesn't re-pause the orchestrator.** `message-router.ts:1450` sets the amending participant back to `SCHEDULE_RECEIVED`, but the `session-orchestrator.ts:78` waitpoint `wait.forToken(confirmedToken)` only fires **once** — and `checkAllConfirmed` (`message-router.ts:1246`) completes it the first time everybody confirms. After that, `both_confirmed_token_id` is still set in the DB but already completed. When the amend path eventually re-confirms (via `handleConfirmSchedule` → `checkAllConfirmed`), the `wait.completeToken` call at `message-router.ts:1142` is a no-op (`/* already completed */`) and the orchestrator has already proceeded (matching/results delivered or running). Result: the amended schedule silently never re-enters matching. This is the core bug the feature is meant to fix, and it still exists in the post-match case.
  - Fix path: inside `handleAmendSchedule`, check session status — if session is past `PAIRED` (i.e. `MATCHING`/`MATCHED`/`COMPLETED`), either re-trigger `matchCompute` + `deliverResults` directly after re-confirmation, or refuse the amend with a clear message. At minimum, reset session status back to `PAIRED` and re-trigger the orchestrator path.

**2. `handleAmendSchedule` also resets OTHER participants indirectly.** After the amender re-confirms, `checkAllConfirmed` requires `every((p) => p.state === "SCHEDULE_CONFIRMED")` — but the amender has been flipped to `SCHEDULE_RECEIVED`, then `AWAITING_CONFIRMATION` by the parser. That's fine IF the other participant is still at `SCHEDULE_CONFIRMED`. However if the orchestrator already progressed past confirmation, the other participant may be at `AWAITING_PREFERENCES`/`PREFERENCES_SUBMITTED`/`COMPLETED`, so `every(...=== SCHEDULE_CONFIRMED)` is permanently false and matching never re-fires. Same root cause as #1 — amend has no idea what stage the session is in.

## High-priority

**3. Silent ghost duplicate in `handleSwapPartner`** (`message-router.ts:1357`). When `swap_from` matches zero real participants **and** zero pending invites (e.g. user typed the wrong old name), the function silently proceeds to add `swap_to` with no removal. The user's "swap" becomes an "add" with no indication. Either report the miss or bail out.

**4. `handleRemovePartner` name-matching is substring + lowercase** (`message-router.ts:1316`). Query: `"tom"` matches both `"Tom Smith"` and `"Thomas"`. Because of `break` on first match, the order is nondeterministic (depends on `getSessionParticipants` row order). User loses the wrong person with no warning. Bug for real sessions with 3+ people. Consider: (a) require exact-token match first, fall back to substring only if unique; (b) if multiple candidates, reply "I have Tom Smith and Thomas — which one?". Same issue in `handleSwapPartner` line 1379.

**5. Race with same-named participants in `handleSwapPartner` with known swap_to.** `findUserByName(swapTo)` (line 1408) requires `matches.length === 1` — good. But if two users share a first name, falls through to the pending-invite branch and silently creates a NEW invite instead of picking one of the two real users. From the user's POV nothing happens visibly (headline says "going with X instead" but the user is in fact not a real participant). Log a warning at minimum; ideally reply "I have two Toms — give me a phone number or last name".

**6. `handleAmendSchedule` doesn't short-circuit if `schedule_json` is null.** Line 1455: if the participant is in `AWAITING_CONFIRMATION` after a parse failure and `schedule_json` happens to be null (e.g. parse produced no valid shifts), the fallback `prior = amendText` effectively re-parses just the amendment as a fresh upload — losing the "amend" semantics. Not catastrophic but inconsistent with comment intent.

## Medium

**7. Overnight guard `!(start === 0 && end === 0)`** (`match-compute.ts:197,206`) — intent is "00:00–00:00 is a 24h free placeholder, not overnight". Fine, but `23:59–00:00` (1-min shift into next day) hits `end=0, start=1439` → `overnight=true` → `workBlocks` gets `[1439, 1440]` for day-N and `[0, 0]` for day-N+1 (zero-length, harmless). Edge case OK.
  - However `23:00–23:59` is **not** overnight (`end=1439 > start=1380`), normal handling: OK.
  - What about `00:00–08:00`? `end=480 > start=0` → not overnight → treated as a normal morning shift on that date only. Correct.
  - What about a shift crossing midnight into a day that has ANOTHER shift (double shift)? Prev-day spill + same-day morning shift both get added to `workBlocks`, then sorted and merged correctly via the cursor logic at line 220. LGTM.
  - Missing: the spill-over from prev-day is added unconditionally even if that participant's schedule already ends the previous day (no actual overnight). The line 206 check `s.date === prevDate && end < start` handles this correctly — only real overnights spill.

**8. `updateParticipantState(participant.id, "SCHEDULE_RECEIVED")` before parser trigger in `handleAmendSchedule`** — good, but note the parser at `schedule-parser.ts:190` also sets state to `AWAITING_CONFIRMATION` on success. So if the parser **fails**, it flips to `AWAITING_SCHEDULE` (line 180/208), which means an amend failure dumps the user into "please upload your schedule" limbo with no prior schedule recoverable. Consider snapshotting `schedule_json` and restoring on parser failure, or at least warning the user.

**9. Intent prompt ambiguity** (`intent-router.ts:86`): "Prefer this over provide_partner whenever the user is CORRECTING themselves". Haiku won't reliably tell "correcting" from "adding" for messages like "also Tom" — that's an add, not a swap — but the prompt rule leans hard on "correcting" which is an intent the user doesn't always make explicit. A user saying "actually also Tom" after adding Ben will sometimes get swap_partner and lose Ben. Recommend: give 2-3 NEGATIVE examples in the prompt ("also Tom" = provide_partner, not swap).

**10. `handleRemovePartner` / `handleSwapPartner` DON'T re-check orchestrator state.** Removing the only other participant leaves the session with one person (the sender). The orchestrator is still alive waiting on `confirmedToken`. No state update to the session happens. If the removed person was already at `SCHEDULE_CONFIRMED` and session was waiting on the sender, fine. If both were at `SCHEDULE_CONFIRMED` and the orchestrator already moved past, still fine. But if the removed participant was mid-confirm, the session is now stuck. Document or handle.

## Nits

**11. `swap_from` fallback logic** (YAGNI check): the "swap_from missing → drop latest pending invite" branch (line 1396) is speculative per the question, but reasonable given the prompt example `"oh sorry i meant Tom"`. Keep — it's a 10-line branch with clear semantics.

**12. `handleAmendSchedule` unused param `_userMessage`** (line 1448): underscore-prefixed, fine, but consider just removing it.

**13. Participant struct typing** — the callers at lines 303/306/318 pass `participant` which is presumably already fetched elsewhere in the handler; the inline type `{ id, session_id, chat_id, schedule_json, state }` is narrower than the actual row type. If upstream adds fields, no break. LGTM but consider importing the shared type for DRY.

**14. `removedLabel = swapFrom`** (line 1393) — uses user-supplied input as the display label even though we didn't find that person; cosmetic but slightly misleading.

**15. `handleRemovePartner` silent "found participant but couldn't delete" vs "no match"** — SQLite DELETE on non-existent id doesn't throw, so `removed = true` is set optimistically after DELETE. If the DELETE silently affected zero rows (row deleted between SELECT and DELETE), user is told "Got it — X is out" but nothing happened. Low probability, accept.

## What looks good

- Overnight shift split is correct and elegant — `shiftDate` UTC helper avoids tz bugs (`match-compute.ts:174`); merge at line 220 via sorted cursor handles adjacent/overlapping blocks cleanly.
- `pending_invites SET status = 'DECLINED'` instead of DELETE — preserves audit trail. Nice.
- Intent dispatch order is correct: partner management before schedule routing before state handlers. Early-return structure is readable.
- `findUserByName` with LIKE-escape and `COLLATE NOCASE` is safe (`d1-client.ts:246`).
- `handleAmendSchedule` prompt engineering via `"Previous parsed schedule JSON: ... User's amendment: ..."` is the right approach — leverages Claude rather than re-implementing merge logic. KISS.
- `amend_schedule` dispatch guard restricts to `SCHEDULE_CONFIRMED`/`AWAITING_CONFIRMATION` — prevents worst misuse.

## Recommended follow-ups

1. **Fix amend-after-match** (Critical #1+#2): in `handleAmendSchedule`, read session status. If `status IN ('MATCHING','MATCHED','COMPLETED')`, after re-confirm re-trigger `matchCompute` directly; bypass the already-completed token. Simplest: extract the "run match + deliver" path into a helper and call it from both `checkAllConfirmed` (orchestrator path) and a new `reMatchAfterAmend` helper.
2. **Disambiguate substring matching** in remove/swap: if >1 candidate, ask which one; if exact match exists, prefer it over substring.
3. **Add prompt examples** in `intent-router.ts` SYSTEM_PROMPT distinguishing add vs swap ("also Tom" vs "wait no, Tom not Ben").
4. **`handleSwapPartner`** should not silently become an add when removal fails + target is unknown.
5. **Snapshot schedule_json before amend** so parser failure can roll back.

## Unresolved questions

- After removing the last "other" participant via `handleRemovePartner`, should the session auto-cancel, or stay open for the sender to add a new partner? Current behavior: stays open, orchestrator still waiting on a token that may never complete.
- Should `amend_schedule` be allowed after `MATCHING` at all, or should it be rejected with "too late, start a new session"? Product call.
- `handleSwapPartner` never removes by participant who's a real user + uses `pUser.name.includes(target)` — should real-user swap fall through to pending-invite if name doesn't match? Currently yes via `removedLabel === ""` branch, but this could remove a NEWER pending invite instead of the intended older real user.
