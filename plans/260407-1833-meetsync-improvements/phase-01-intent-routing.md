# Phase A: Intent Routing + Text Schedules + Media Handling

## Overview
- **Priority:** High
- **Status:** Pending
- **Impact:** Transforms bot from keyword parser to conversational AI

## Key Insight
Every message currently goes through a `switch` on `participant.state` with hardcoded string matching ("yes", "no", "new", "join CODE"). This breaks on natural language ("yeah that looks right", "the first and third work for me"). Replacing this with a single Claude Haiku call per message makes the bot understand anything.

## Architecture Change

### New file: `intent-router.ts`
Shared module (not a task) that calls Claude Haiku to classify intent.

```typescript
// Input: message text, current state, message type
// Output: { intent, params }

interface IntentResult {
  intent: "create_session" | "join_session" | "upload_schedule_text" 
    | "confirm_schedule" | "reject_schedule" | "submit_preferences" 
    | "show_status" | "cancel_session" | "show_help" 
    | "unsupported_media" | "greeting" | "unknown";
  params: Record<string, unknown>;
  // e.g., { code: "ABC123" } for join_session
  // e.g., { slots: [1, 3] } for submit_preferences
  // e.g., { schedule_text: "Mon-Fri 9-5" } for upload_schedule_text
}
```

### System prompt for Haiku:
```
You are MeetSync's intent classifier. Given a WhatsApp message and the user's current state, return a JSON intent.

Current state: {state}
Message type: {text|image|document|audio|video|sticker}
Message: "{text}"

Rules:
- For text that describes work hours/shifts, intent = "upload_schedule_text" with params.schedule_text
- For slot preferences like "1 and 3" or "the first one", intent = "submit_preferences" with params.slots as number array
- For join codes, intent = "join_session" with params.code (extract the alphanumeric code)
- For voice/audio/video/sticker, intent = "unsupported_media"
- Consider the current state: e.g., in AWAITING_CONFIRMATION, "looks good" = confirm_schedule

Return ONLY JSON: { "intent": "...", "params": { ... } }
```

### Cost: ~$0.003/message (Haiku). ~50 messages/session = $0.15/session.

## Implementation Steps

### Step 1: Create `intent-router.ts`
- New file at `Engineering/trigger-automations/src/trigger/meetsync/intent-router.ts`
- Function: `classifyIntent(text, messageType, currentState): Promise<IntentResult>`
- Calls Claude Haiku via fetch (same pattern as schedule-parser)
- Zod validate the response
- Fallback: if Haiku fails, return `{ intent: "unknown" }`

### Step 2: Refactor `message-router.ts`
- Remove all keyword matching (lines ~44–95 current switch)
- Replace with: `const intent = await classifyIntent(text, message_type, participant.state)`
- Route by `intent.intent` instead of `participant.state`
- Keep state transitions the same, just change how we detect what the user wants
- The `handleIdleUser`, `handleAwaitingSchedule`, etc. functions stay — they just get triggered by intent instead of keyword

### Step 3: Add text-based schedule input
- New intent: `upload_schedule_text`
- When detected, send `params.schedule_text` to Claude for parsing (reuse schedule-parser prompt, but text instead of image)
- In `schedule-parser.ts`: Add a code path for text input (no media download, just send text to Claude)
- Add `text_content` optional field to schedule-parser payload schema

### Step 4: Handle unsupported media
- Intent router returns `unsupported_media` for voice/audio/video/sticker
- Message-router sends: "I can't process voice messages or stickers — please type your message or send a photo/PDF of your schedule."

## Related Code Files
- **Create:** `Engineering/trigger-automations/src/trigger/meetsync/intent-router.ts`
- **Modify:** `Engineering/trigger-automations/src/trigger/meetsync/message-router.ts` (major refactor)
- **Modify:** `Engineering/trigger-automations/src/trigger/meetsync/schedule-parser.ts` (add text input path)

## Todo
- [ ] Create intent-router.ts with Haiku call + Zod validation
- [ ] Refactor message-router switch to use intent classification
- [ ] Add text schedule input path in schedule-parser
- [ ] Add unsupported media handling
- [ ] Test with natural language inputs
- [ ] Verify TypeScript compiles

## Success Criteria
- "Yeah that looks about right" → confirms schedule
- "I work 9 to 5 monday through friday" → parsed as schedule
- Voice note → friendly error message
- "the first and third options" → preferences [1, 3]
- No regression on existing keyword commands

## Risk
- **Haiku misclassifies intent.** Mitigation: include conversation state in prompt (narrows possibilities). Fallback to "unknown" intent with a friendly "I didn't understand, try again."
- **Latency.** Haiku adds ~1-2s per message. Acceptable for async WhatsApp.
