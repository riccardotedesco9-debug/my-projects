# Phase C: Nudges, Reminders & Explanations

## Overview
- **Priority:** Medium
- **Status:** Pending
- **Depends on:** Phase B

## Part 1: Smart Nudges

### What
Timed reminders when one person is waiting on the other:
- **2h nudge:** "Hey, still waiting for your colleague's schedule!"
- **Partner not joined (4h):** "Your colleague hasn't joined yet. Remind them to message me: join {CODE}"
- **Schedule not uploaded (3h):** "Don't forget to send your work schedule!"

### Implementation
In `session-orchestrator.ts`, add intermediate wait checkpoints:

```typescript
// After creating waitpoint tokens, before waiting for confirmation:

// Nudge loop: check every 2 hours if both confirmed
for (let nudge = 0; nudge < 3; nudge++) {
  await wait.for({ hours: 2 });
  
  const participants = await getSessionParticipants(session_id);
  const confirmed = participants.filter(p => p.state === "SCHEDULE_CONFIRMED");
  const waiting = participants.filter(p => 
    ["AWAITING_SCHEDULE", "SCHEDULE_RECEIVED", "AWAITING_CONFIRMATION"].includes(p.state)
  );
  
  if (confirmed.length === 2) break; // both done
  
  // Nudge the person who hasn't confirmed yet
  for (const p of waiting) {
    await sendTextMessage(p.phone, 
      "Friendly reminder: send me your work schedule so we can find a time to meet! 📋"
    );
  }
}
```

**Important:** Don't nudge more than 3 times total. Track nudge count to avoid spam.

### Alternative approach (simpler)
Instead of a nudge loop, use `wait.for()` with a single 2-hour timeout before the main `wait.forToken()`. If not both confirmed after 2h, send one nudge, then continue waiting on the token.

## Part 2: Day-Before Reminder

### What
The night before a confirmed meetup, remind both people.

### Implementation
New scheduled task: `meetsync-meetup-reminder`

```typescript
// After deliver-results completes with a match:
// Calculate time until day before the meetup at 19:00
// Use wait.until({ date }) to pause until then

const meetupDate = new Date(bestSlot.day);
const reminderDate = new Date(meetupDate);
reminderDate.setDate(reminderDate.getDate() - 1);
reminderDate.setHours(19, 0, 0, 0); // 7 PM night before

if (reminderDate > new Date()) {
  await wait.until({ date: reminderDate });
  
  for (const p of participants) {
    await sendTextMessage(p.phone, 
      `Reminder: you have a meetup tomorrow!\n\n*${bestSlot.day_name} ${bestSlot.day}*\n${bestSlot.start_time} - ${bestSlot.end_time}`
    );
  }
}
```

**Where:** In `session-orchestrator.ts` after `deliverResults.triggerAndWait()` returns. The orchestrator stays alive (paused via waitpoint, zero compute) until the reminder fires.

**Risk:** If the meetup is today or tomorrow, the reminder might be in the past. Check `reminderDate > new Date()` before scheduling.

## Part 3: "Why This Slot" Explanations

### What
Instead of just listing slots, explain why each one works:
```
1. Wed 9th, 14:00-18:00 (4h) — both off after your shifts end
2. Thu 10th, 10:00-13:00 (3h) — morning gap before afternoon shifts
3. Fri 11th, 15:00-17:00 (2h) — narrow window, one of you starts at 17:00
```

### Implementation
Modify `match-compute.ts` to track WHY each free block exists:

```typescript
interface FreeSlotWithContext {
  // existing fields...
  explanation: string; // e.g., "both off after 14:00"
}
```

In `getFreeTime()`, track what creates each gap:
- "no work this day" → "both have the day off"
- Gap before first shift → "free morning before {start_time} shift"
- Gap after last shift → "both off after shifts end"
- Gap between shifts → "gap between shifts"

Add `explanation` column to `free_slots` table (new migration `0002-add-explanation.sql`).

Format in orchestrator's recommendation message:
```
*1.* Wed 9th, 14:00-18:00 (4h) — both off after shifts end
```

## Related Code Files
- **Modify:** `Engineering/trigger-automations/src/trigger/meetsync/session-orchestrator.ts` (nudges + reminders)
- **Modify:** `Engineering/trigger-automations/src/trigger/meetsync/match-compute.ts` (explanations)
- **Create:** `meetsync/migrations/0002-add-explanation.sql`

## Todo
- [ ] Add nudge logic in session-orchestrator (2h checkpoint)
- [ ] Add day-before reminder using wait.until()
- [ ] Modify match-compute to generate explanations
- [ ] Create migration 0002 for explanation column
- [ ] Update recommendation message format with explanations
- [ ] Test nudge doesn't fire more than 3 times
- [ ] Test reminder fires at correct time (19:00 night before)

## Success Criteria
- Users who haven't uploaded get a gentle reminder after 2 hours
- Both users get a reminder the night before their meetup
- Recommendations include a brief human-readable reason
- No spam (max 3 nudges per session)
