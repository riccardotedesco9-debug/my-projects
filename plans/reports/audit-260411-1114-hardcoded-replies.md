# Hardcoded Reply Audit — MeetSync Router + Handlers

Scanned `Engineering/trigger-automations/src/trigger/meetsync/` for `await reply(…, "…")` calls that bypass `generateResponse()`. Each of these ignores:
1. **User language** — non-English users get English fragments
2. **User's actual message** — if the user asked a question alongside the triggering event, the bot silently drops it (the bug round-5 was supposed to fix but only partially did)

## Bypasses (32)

### message-router.ts (11)
| Line | String | Severity |
|---|---|---|
| 106 | "I had trouble processing your voice message. Could you type it instead?" | medium (error path, user will re-try) |
| 244 | "I can't process videos or stickers — but I handle text, photos, PDFs, and voice messages!" | medium |
| 270 | "Done — everything wiped. Send me a message to start fresh." | medium (after /reset — users won't ask questions here) |
| 285 | "I need at least 2 people's schedules before I can find overlaps. Share more schedules first!" | **high** — common during burst intent |
| 288 | "Checking everyone's schedules for overlapping free time..." | low (status message) |
| 294 | "Couldn't find any overlapping free time. Try sharing updated schedules." | **high** — users often ask "why" here |
| 316 | `` `Got it, ${params.name}!` `` | high — name acknowledgment, users often add schedule info in same msg |
| 382 | `` `Got it — saving this as ${pUser.name}'s schedule.` `` | medium |
| 433 | "Got your updated schedule! Re-analyzing..." | medium (amend path) |
| 479 | "Sorry, something went wrong on my end. Try again or send /new to start fresh." | medium (error path) |
| 526 | "No problem! Send /new when you're ready to schedule." | medium (decline invite) |

### state-handlers.ts (13)
| Line | String | Severity |
|---|---|---|
| 127 | "That's your own number! Add someone else." | medium |
| 158 | `` `I know a few people with that name:\n\n${list}\n\nWhich one? Send their phone number.` `` | **high** — disambiguation UX, users may ask follow-up |
| 201 | `` `${newUser?.name ?? "That person"} is already in this session.` `` | medium |
| 252 | "That scheduling session expired. Send /new to start fresh!" | medium |
| 269 | "You're already in this session! Send your work schedule." | medium |
| 312 | "I couldn't receive that file. Try sending it again." | medium |
| 317 | "Got your schedule! Analyzing it now..." | **high** — common triggering reply, users often add clarifications in same msg |
| 336 | "Got it! Parsing your schedule..." | **high** — same as above |
| 397 | "Got it, re-analyzing with your feedback..." | high (clarify path) |
| 422 | "Couldn't compute free time from your schedule. Try uploading it again." | medium |
| 428 | "No other participants found for this session. Send /new to start fresh." | low |
| 521 | `` `Got it — slots ${slots.join(", ")}! Finding the best match...` `` | high (mediated mode status) |
| 527 | "Something went wrong finding the match. Try sending /new to start over." | medium |

### intent-handlers.ts (6)
| Line | String | Severity |
|---|---|---|
| 106 | `` `I have ${list} — which one do you want me to remove? Tell me the full name.` `` | **high** — remove disambiguation |
| 126 | `` `I don't have ${removeName} in this session to remove. Who did you mean?` `` | **high** — remove error, user may explain |
| 162 | "Got it — but who should I swap them with? Give me the new name or phone number." | high |
| 193 | `` `I have ${list} — which one do you want me to replace? Tell me the full name.` `` | high |
| 222 | `` `I couldn't find "${swapFrom}" in this session — are you sure you added them? I'll add ${swapTo} anyway, but let me know if something's off.` `` | high |
| 265 | `` `Here's your invite link to share with ${swapTo}:\n${inviteLink}` `` | low (deterministic URL, can't go through AI) |
| 294 | "Got it — updating your schedule with that change..." | high (amend status) |

## Priority fix ordering

**Tier 1 (high severity, user-facing questions typically arrive in same message):**
1. state-handlers.ts:317, 336 — schedule parsing status
2. message-router.ts:285, 294 — "need more schedules" / "no overlap"
3. state-handlers.ts:158, intent-handlers.ts:106, 126, 193 — disambiguation prompts
4. state-handlers.ts:521 — slot-finding status
5. intent-handlers.ts:162, 222, 294 — swap/amend status

**Tier 2 (medium, edge cases):**
Voice/video error paths, duplicate-add rejections, session-expired notifications.

**Tier 3 (low, deterministic):**
intent-handlers.ts:265 (invite link — must stay deterministic per round-5 anti-URL-hallucination rule)
message-router.ts:288 (status ping during matching — users unlikely to ask questions)

## Fix pattern

Each high-severity bypass should become:
```ts
await reply(chatId, await generateResponse({
  scenario: "<new_scenario_name>",
  state: "<current_state>",
  userMessage,
  ...(await getReplyContext(chatId)),
  extraContext: "<what to say + instruction to address user's question first>",
}));
```
And add the new scenario to `response-generator.ts` with appropriate prompt framing.

## Deferred rationale

Not fixing in round-6 because:
- Each fix requires adding a new scenario to `response-generator.ts` (~+5 LOC per bypass × 32 = 160 LOC)
- Each needs testing that the AI actually addresses the user's message (scenario-02 flakiness makes automated verification hard)
- The race-fix work is the ship-blocker; this is UX polish

Round-7 candidate.
