# Phase B: Calendar Export + Confidence Warnings

## Overview
- **Priority:** Medium
- **Status:** Pending
- **Depends on:** Phase A (intent routing)

## Part 1: Calendar Export (.ics)

### What
After final match, generate `.ics` file and send via WhatsApp as a document. User taps → opens in phone calendar.

### Implementation Steps

#### Step 1: Add `sendDocumentMessage()` to whatsapp-client.ts
WhatsApp Cloud API supports sending documents via media upload.

```typescript
// Two-step process:
// 1. Upload document to WhatsApp media endpoint
// 2. Send message referencing the media ID

async function sendDocumentMessage(
  to: string, 
  buffer: Buffer, 
  filename: string, 
  mimeType: string, 
  caption?: string
): Promise<void>
```

API: POST `/{phoneNumberId}/media` with form-data (file + messaging_product + type)
Then: POST `/{phoneNumberId}/messages` with `type: "document"`, `document: { id: mediaId, filename, caption }`

#### Step 2: Add `generateIcs()` in deliver-results.ts
```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//MeetSync//EN
BEGIN:VEVENT
DTSTART:{YYYYMMDD}T{HHMM}00
DTEND:{YYYYMMDD}T{HHMM}00
SUMMARY:Meetup
DESCRIPTION:Scheduled via MeetSync
END:VEVENT
END:VCALENDAR
```

Convert matched slot's date + times to iCal format. No timezone complexity (both in Malta = Europe/Malta).

#### Step 3: Send .ics after result message
In `deliver-results.ts`, after sending the text result:
1. Generate .ics content string
2. Convert to Buffer
3. Call `sendDocumentMessage(phone, buffer, "meetup.ics", "text/calendar", "Add to your calendar")`
4. Send to both participants

## Part 2: Confidence Warnings

### What
When Claude parses a schedule, flag uncertain entries so the user can catch errors before confirming.

### Implementation Steps

#### Step 1: Update Claude prompt in schedule-parser.ts
Add to existing prompt:
```
For each shift, include a "confidence" field (0.0 to 1.0):
- 1.0 = clearly legible, no ambiguity
- 0.7-0.9 = mostly sure but some ambiguity (e.g., handwriting unclear)
- Below 0.7 = uncertain (e.g., can't tell if 9:00 or 19:00)
```

Update Zod schema to include optional confidence field.

#### Step 2: Update confirmation message
When displaying parsed shifts, flag low-confidence entries:
```
Here's what I extracted (12 shifts):

- Mon 2026-04-07: 09:00-17:00
- Tue 2026-04-08: 14:00-22:00
- ⚠️ Wed 2026-04-09: 09:00-17:00 (not 100% sure — is this correct?)
- Thu 2026-04-10: 09:00-17:00
...
```

Threshold: flag anything below 0.85 confidence.

## Related Code Files
- **Modify:** `Engineering/trigger-automations/src/trigger/meetsync/whatsapp-client.ts` (add document sending)
- **Modify:** `Engineering/trigger-automations/src/trigger/meetsync/deliver-results.ts` (add .ics generation + send)
- **Modify:** `Engineering/trigger-automations/src/trigger/meetsync/schedule-parser.ts` (confidence in prompt + display)

## Todo
- [ ] Add `sendDocumentMessage()` to whatsapp-client.ts
- [ ] Add `generateIcs()` function in deliver-results.ts
- [ ] Send .ics to both participants after match
- [ ] Update Claude prompt to include confidence scores
- [ ] Update Zod schema for confidence field
- [ ] Flag low-confidence shifts in confirmation message
- [ ] Test .ics opens correctly on iOS and Android

## Success Criteria
- Both users receive a `.ics` file they can tap to add to calendar
- Uncertain schedule entries are visually flagged with ⚠️
- No regression on normal schedule parsing
