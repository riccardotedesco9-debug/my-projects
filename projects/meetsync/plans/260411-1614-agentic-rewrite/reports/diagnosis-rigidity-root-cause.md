# Diagnosis — Why MeetSync Feels Rigid (and Worse Than Raw Claude)

**Author:** Scout agent run 2026-04-11 16:14, cross-checked against first-hand read of all 14 trigger/meetsync/*.ts files + 8 worker/src + 6 migrations.
**Evidence:** D1 `conversation_log` rows from chat_id 909839972, timestamps 2026-04-11 13:35:39 → 13:39:58 (full failed session captured, 20 rows).

## Observed failures (in order)

1. **13:35:39** Bot: "So we're all set with your schedule, Riccardo. Now waiting on your colleague to share theirs."
2. **13:35:40** User: "And this is diegos"
3. **13:35:45** Bot: "I'm ready for Diego's schedule! It looks like you meant to upload a document, but I don't see one attached to this message." ← **FAILURE #1:** the photo arrived in the *next* webhook turn, but the bot processes each turn in isolation with no cross-turn re-attribution.
4. **13:35:52** User: `[photo uploaded]`
5. **13:35:56** Bot: "Got your schedule, Riccardo! Just parsing it now..."
6. **13:36:10** Bot: "Hey Riccardo, I couldn't parse that schedule file." ← **FAILURE #2:** parser received the media with no conversational context; no `for_person_name`. Attribution was silently lost *at the fast-path in `intent-router.ts:195-198`* which routes every image to `upload_schedule_text` with empty params.
7. **13:36:43** User: `[photo uploaded]` (same file_id, retry)
8. **13:36:56** Bot: "I couldn't make out any shifts from that." ← **FAILURE #3:** parser ran again with no memory of the prior attempt, same result.
9. **13:37:06** User: "Just look at diego"
10. **13:37:12** Bot: "I'm not sure what you mean by 'just look at diego.' Diego hasn't shared a schedule with me yet..." ← **FAILURE #4:** session snapshot says Diego is not a participant (correct), but the LLM has no signal that the user already uploaded something for Diego two turns ago. The photo vanished into `person_notes` with no linkage.
11. **13:37:28 → 13:39:48** User keeps trying, bot keeps saying "I can't read the image / Diego hasn't shared" or "You uploaded *Diego's* schedule, not yours."

## Root-cause tree (smoking guns)

### A. `intent-router.ts:195-198` — image fast-path bypasses Haiku entirely

```ts
if (messageType === "image" || messageType === "document") {
  return { intent: "upload_schedule_text", params: {} }; // handled as file upload by router
}
```

Result: when an image arrives, the LLM that could have inferred "this is Diego's" from conversation history is never called. `params.schedule_for_name` is always `{}` for media turns.

### B. `message-router.ts:544` — attribution check gated on state AND only for `isScheduleUpload && !AWAITING_SCHEDULE && !SCHEDULE_RECEIVED`

The attribution-by-history scanner at `message-router.ts:549-569` only runs in the "other states" branch. In the live chat, the user was in `SCHEDULE_CONFIRMED` (his own schedule was confirmed), so theoretically it should have run — but the `intent-router` already returned `upload_schedule_text` with empty params, and `params.schedule_for_name` was never populated.

The hard truth: this is a **retroactive attribution hack**. Even when it runs, it only works if the conversation history already contains the other person's name verbatim within the last 4 lines. "And this is diegos" + photo works IF both messages land in the same turn; in reality they're two separate Telegram updates → two separate Trigger.dev runs → the photo run fires before the text run has a chance to inform it.

### C. `message-router.ts:614-626` — schedule re-upload in AWAITING_CONFIRMATION goes straight to parser with no attribution

```ts
case "AWAITING_CONFIRMATION":
  if ((message_type === "image" || message_type === "document") && media_id) {
    await updateParticipantState(participant.id, "SCHEDULE_RECEIVED");
    // ...
    await scheduleParser.trigger({
      participant_id: participant.id, session_id: participant.session_id,
      chat_id: chatId, media_id, mime_type: mime_type ?? "image/jpeg",
    });
    return { action: "schedule_re_uploaded" };
  }
```

No `for_person_name`. The parser saves the shifts to the *user's own* `participant.schedule_json`. Bug is architectural, not a typo — the branch pre-dates the person-notes on-behalf flow and was never updated.

### D. `schedule-parser.ts` — parser receives file OR text, never both together, never conversation history

`ScheduleParserPayload` carries `media_id | text_content | for_person_name`. That's it. No history. No partner list. No "here's what the user said around this media". So when the parser runs, it has exactly the image and the prompt — it has no way to decide attribution even if it wanted to.

### E. `response-generator.ts:38` — ground-truth snapshot is fetched once per turn, stale by the time most replies fire

```ts
const sessionSnapshot = participant
  ? await getSessionSnapshot(participant.session_id, chatId)
  : undefined;
```

Read once, then passed around as a string. Any tool that mutates state after this point (e.g. `updateParticipantState`, `setPersonNoteSchedule`) leaves the snapshot stale. Reply text generated from the stale snapshot contradicts the actual DB state the user just caused.

### F. `message-router.ts` top-of-run consolidation + bail-if-newer — fixes burst races but NOT cross-turn grounding

The 1.2 s sleep + `MAX(id) > myLogId` check works great for bursts of plain text. But photos go through a different pre-log path (`[photo uploaded · file_id=...]` from the Worker) and bursts that mix media + text don't consolidate cleanly. The message-router handles them as fully independent turns.

## Architectural summary

Each component operates on a **different snapshot** of context, taken at a different time:

- **Intent router** (Haiku): sees text + last 12 lines of history, decides one intent per message. Bypassed entirely for images.
- **Message router** (dispatcher): sees the intent + its own freshly-read participant row + a session snapshot + conversation history as a string. Makes dispatch decisions.
- **State handlers** (`state-handlers.ts`): each one re-reads participants or user by chat_id. None see the original snapshot — they work from whatever the message-router passed down the call stack.
- **Schedule parser** (Sonnet): sees an image + a hardcoded prompt + the user's name. No history, no attribution.
- **Response generator** (Haiku): sees a scenario string + the message-router's snapshot (now stale) + optional `extraContext` + the user's message. Generates a reply based on this partial view.

Each layer has less context than the one before. The intelligence degrades at every hop.

## Why raw Claude felt better to the user

When Riccardo tests in the Claude app, the entire turn — recent messages, attachments, prior context — lands in one prompt. The model reasons across all of it in one pass. There is no intent classifier discarding context. There is no state machine overriding judgment. There is no response-generator scenario flattening the answer into a named template. There is just context + tools + reasoning.

MeetSync's router pipeline is a ~2,700-LOC attempt to reconstruct that coherence via hand-rolled state machines. It consistently loses information at every hop. Every round from 1 to 11 has been adding prompt-patches to `scenario extraContext` ("hard anti-nag rules: (a)... (b)... (c)...") to fight the structure the code imposes on the conversation.

## Recommendation

Rip the dispatch pipeline. Replace with a single turn handler that:

1. Loads the full state (user, session, participants, person_notes, pending_invites, recent history) in one D1 round.
2. Downloads the current turn's media if any.
3. Hands everything to Claude Sonnet with an 8-tool toolbox.
4. Executes tool calls, loops until the model emits a terminal `reply`.

Keep the infrastructure (Worker, Trigger.dev, D1, Telegram client, schedule parser, match-compute, deliver-results, Google OAuth). These are fine.

See `../plan.md` for phase breakdown.

## Unresolved questions

1. **Voice transcription** — do we still do it in the Worker before the turn handler, or pass the audio to Sonnet directly? Sonnet doesn't take audio yet, so Whisper-via-Workers-AI stays.
2. **Burst consolidation threshold** — keep 1.2 s sleep? With a single turn handler, bursts become "the handler starts, sees 3 recent unreplied user messages in history, responds to all of them in one reply". May not need the sleep at all.
3. **Model cost envelope** — Sonnet at ~1.5 ¢/turn × ~20 turns/day = ~30 ¢/day. Monitor and fallback to Haiku if usage explodes, but unlikely.
