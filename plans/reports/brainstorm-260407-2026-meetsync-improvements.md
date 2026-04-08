# MeetSync Improvement Brainstorm

## Problem Statement
MeetSync v1 is a rigid state machine chatbot. It works but feels robotic — keyword-only input, file-upload-only schedules, no intelligence beyond the parsing step. Goal: make it a genuinely smart assistant that minimizes organizing time for two average smartphone users.

## Evaluated Improvements

### 1. Claude-Powered Intent Routing (Priority: NOW)
**What:** Replace keyword matching with Claude Haiku interpreting every message. Bot understands natural language, voice note apologies, stickers, broken grammar, everything.

**How it changes the architecture:**
- Current: `if text === "yes" → confirm()` (brittle)
- Proposed: Send `{ message, current_state, context }` to Claude Haiku → returns `{ intent, params }` → route by intent

**Example interactions it enables:**
- "Yeah that looks about right" → intent: confirm_schedule
- "Actually hold on my boss changed my shifts" → intent: redo_schedule
- "The first and third one work for me" → intent: submit_preferences, params: [1, 3]
- [voice note] → intent: unsupported_media, reply: "I can't listen to voice notes — type it or send a file!"
- "Hey when are we meeting again?" → intent: show_status

**Cost:** ~$0.003/message (Haiku). 50 messages/session = $0.15/month. Negligible.
**Risk:** Latency adds ~1-2s per message. Acceptable for WhatsApp.
**Verdict:** Biggest single improvement. Transforms UX completely.

### 2. Text-Based Schedule Input (Priority: NOW)
**What:** Accept typed schedules, not just file uploads.
- "I work Mon-Fri 9-5 this week"
- "Off on Wednesday and Friday, working 7am-3pm other days"
- "Same as usual but Thursday I'm on night shift 10pm-6am"

**How:** When intent router detects schedule-like text, send to Claude for parsing (same prompt as file parser, just text input instead of image). Falls into existing confirmation flow.

**Why it matters:** The other person might not have a file. They just know their hours. Removing the file requirement makes it accessible to everyone.
**Effort:** Low — reuse existing parser prompt, just different input type.

### 3. Calendar Export (.ics) (Priority: NOW)
**What:** After final match, generate and send a `.ics` file via WhatsApp. User taps → opens in phone calendar.

**How:** In `deliver-results.ts`, generate `.ics` content string, upload as document via WhatsApp API.
```
BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART:20260409T140000
DTEND:20260409T180000
SUMMARY:Meetup - Riccardo & colleague
END:VEVENT
END:VCALENDAR
```

**Effort:** ~30 lines. WhatsApp API supports document sending.
**Impact:** Completes the loop. Recommendation → real calendar event.

### 4. Smart Nudges & Reminders (Priority: SOON)
**What:**
- If one person uploaded and the other hasn't after 2h → gentle ping
- Night before confirmed meetup → remind both people
- Session idle for 12h with no partner joined → remind creator to share code

**How:** Trigger.dev scheduled tasks or `wait.for({ hours: 2 })` checkpoints in the orchestrator.
**Effort:** Medium — needs timed triggers.

### 5. Confidence Warnings in Parsing (Priority: SOON)
**What:** If Claude is uncertain about a shift, flag it:
"I extracted your schedule but I'm not sure about these:
- Wednesday: is it 9:00 or 19:00?
- Thursday: I see two shifts, which one is correct?"

**How:** Add `confidence` field to Claude parsing prompt. Filter low-confidence shifts and present them differently in confirmation message.
**Effort:** Low — prompt change + display logic.

### 6. "Why This Slot" Explanations (Priority: SOON)
**What:** Instead of just listing slots, explain why:
"*1.* Wed 9th, 14:00-18:00 (4h) — you're both off after 14:00"

**How:** In match-compute, track which participant's shift ends/starts to create the explanation.
**Effort:** Medium — needs to thread context through the match engine.

### 7. Multi-Person Scheduling (Priority: LATER)
**What:** Support 3+ people in a session.
**How:** Generalize session model (remove 2-person assumption), N-way time intersection, weighted preference voting.
**Why defer:** 2-person covers 90% of use cases. Need real usage data first. Architecture doesn't prevent adding this later.

### 8. Cross-Month Memory (Priority: LATER)
**What:** Bot remembers your name, typical patterns, past meetups.
**Why defer:** Adds persistent user storage. Monthly schedule changes anyway. The "friction" of sending one photo is 5 seconds. Not worth the complexity yet.

---

## Recommended Implementation Order

| Phase | Items | Impact |
|---|---|---|
| **Phase A** (next) | Intent routing + text schedule input + voice/sticker handling | Bot goes from robotic → conversational |
| **Phase B** | Calendar export + confidence warnings | Completes the UX loop |
| **Phase C** | Nudges + reminders + "why this slot" | Polish and reliability |
| **Phase D** (future) | Multi-person + memory | Scale features |

## Architecture Change for Intent Routing

The key change: message-router stops pattern-matching and instead calls Claude Haiku with:
```
System: You are MeetSync's intent classifier.
User state: AWAITING_SCHEDULE
Message type: text
Message: "yeah that's my shifts for april, looks good"

Return JSON: { "intent": "confirm_schedule", "params": {} }
```

Possible intents: create_session, join_session, upload_schedule_text, confirm_schedule, reject_schedule, submit_preferences, show_status, cancel_session, show_help, unsupported_media, unknown.

This replaces ~50 lines of if/else with one Claude call. Every edge case is handled by intelligence, not code.

## Risks
- **Claude intent misfire** — user says "no" meaning "no way, that's amazing" and bot thinks they rejected. Mitigation: include conversation context in the prompt, not just the single message.
- **Latency** — each message takes 1-2s longer. Acceptable for async WhatsApp chat.
- **Cost creep** — if the bot goes viral somehow. Mitigate with rate limiting on the Worker.

## Success Metrics
- Both users complete the full flow without saying "help" or getting stuck
- Schedule parsing accuracy > 90% on first attempt
- Average session time from "new" to match delivery < 15 minutes
- Zero "Something went wrong" messages in normal usage

## Unresolved
- Should intent routing use Haiku (cheap, fast) or Sonnet (smarter, 10x cost)? Recommend Haiku — intent classification is simple.
- Should text-based schedules bypass the confirmation step if Claude is highly confident? Recommend no — always confirm, trust is important.
