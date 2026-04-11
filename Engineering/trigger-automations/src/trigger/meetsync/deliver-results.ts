// Deliver results — sends final meeting match to all participants.
//
// Public API:
//   - `deliverMatchToSession(sessionId)` — pure async entry point. Reads
//     free_slots + participant preferences, picks the best slot, sends
//     ics + Telegram message + Google Calendar event to every participant,
//     marks session COMPLETED. Used by the agentic turn-handler's
//     compute_and_deliver_match tool.
//   - `deliverResults` — Trigger.dev schemaTask wrapper, thin shim over
//     `deliverMatchToSession` kept for the legacy orchestrator. Deleted in
//     phase 05.

import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { sendTextMessage, sendDocumentMessage } from "./telegram-client.js";
import { query, getSessionParticipants, updateParticipantState, updateSessionStatus, getReplyContext, getUserTimezone, emitSessionEvent } from "./d1-client.js";
import { createCalendarEvent } from "./google-calendar.js";
import { generateResponse } from "./response-generator.js";

const payloadSchema = z.object({
  session_id: z.string(),
});

export interface DeliverMatchResult {
  match: {
    day: string;
    day_name: string;
    start_time: string;
    end_time: string;
    duration_minutes: number;
    mutual_preference: boolean;
  } | null;
  reason?: string;
}

/**
 * Pure delivery entry point. Reads free_slots for the session, picks the
 * best slot (mutual preference first, then longest duration, chronological
 * tiebreaker), sends the .ics + Telegram message + Google Calendar event
 * to every participant, marks session COMPLETED.
 *
 * Called by the turn-handler's compute_and_deliver_match tool AFTER
 * `computeOverlaps` + `persistComputedSlots` have populated free_slots.
 * Can also be called directly if slots were computed elsewhere.
 *
 * Throws if fewer than 2 participants exist. Returns `{ match: null,
 * reason: "no_overlap" }` if free_slots is empty (and sends the
 * "no overlap" notification to all participants as part of the flow).
 */
export async function deliverMatchToSession(session_id: string): Promise<DeliverMatchResult> {
    const participants = await getSessionParticipants(session_id);
    if (participants.length < 2) {
      throw new Error(`Need at least 2 participants, found ${participants.length}`);
    }

    // Get free slots
    const slotsResult = await query<{
      slot_number: number;
      day: string;
      day_name: string;
      start_time: string;
      end_time: string;
      duration_minutes: number;
    }>(
      "SELECT * FROM free_slots WHERE session_id = ? ORDER BY slot_number",
      [session_id]
    );

    const slots = slotsResult.results;
    if (slots.length === 0) {
      for (const p of participants) {
        await sendTextMessage(p.chat_id, await generateResponse({
          scenario: "no_overlap", state: "COMPLETED",
          ...(await getReplyContext(p.chat_id)),
        }));
        await updateParticipantState(p.id, "COMPLETED");
      }
      await updateSessionStatus(session_id, "COMPLETED");
      await emitSessionEvent(session_id, "no_overlap_final");
      return { match: null, reason: "no_overlap" };
    }

    // Parse all participants' preferences and find mutual slots
    const allPrefs = participants.map((p) => parsePrefs(p.preferred_slots));

    // Mutual = slots that ALL participants prefer
    const mutual = allPrefs[0].filter((slot) =>
      allPrefs.every((prefs) => prefs.includes(slot))
    );

    // Best match: LONGEST slot, preferring ones everyone marked as preferred.
    // Round-2 bug: picking slots[0] (or mutual[0]) meant a 2h morning gap beat a
    // 7h afternoon window when the matcher happened to return the morning first.
    // Chronological order is still the tiebreaker for equal-length slots so
    // "first of two identical Wednesdays" stays deterministic.
    const rankByDuration = (a: typeof slots[number], b: typeof slots[number]) =>
      b.duration_minutes - a.duration_minutes ||
      a.day.localeCompare(b.day) ||
      a.start_time.localeCompare(b.start_time);
    const mutualSlots = mutual.length > 0
      ? slots.filter((s) => mutual.includes(s.slot_number))
      : [];
    const pool = mutualSlots.length > 0 ? mutualSlots : slots;
    const bestSlot = [...pool].sort(rankByDuration)[0] ?? slots[0];

    // Format the match result for the response generator
    const hours = Math.floor(bestSlot.duration_minutes / 60);
    const mins = bestSlot.duration_minutes % 60;
    const durationStr = mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    const matchResultStr = `*${bestSlot.day_name} ${bestSlot.day}*\n${bestSlot.start_time} - ${bestSlot.end_time} (${durationStr})`;
    const scenario = mutual.length > 0 ? "mutual_match" : "best_match";

    // Send result message + calendar file to each participant. Each
    // participant may have a different timezone (e.g. a Tokyo user
    // meeting a Malta user), so we generate the .ics per-recipient
    // with their own tz anchor and pass the same tz to the Google
    // Calendar helper.
    for (const p of participants) {
      const tz = await getUserTimezone(p.chat_id);
      const icsContent = generateIcs(bestSlot, tz, session_id);

      await sendTextMessage(p.chat_id, await generateResponse({
        scenario, state: "COMPLETED", matchResult: matchResultStr,
        ...(await getReplyContext(p.chat_id)),
      }));
      try {
        await sendDocumentMessage(p.chat_id, icsContent, "meetup.ics", "Tap to add to your calendar");
      } catch (err) {
        console.error("Failed to send .ics file:", err);
      }

      // Google Calendar opt-in: silently add event if user has connected
      try {
        const added = await createCalendarEvent(
          p.chat_id,
          bestSlot.day,
          bestSlot.start_time,
          bestSlot.end_time,
          "Meetup",
          tz,
        );
        if (added) {
          await sendTextMessage(p.chat_id, "Added to your Google Calendar.");
        }
      } catch (err) {
        // Google Calendar is optional — never fail the flow
        console.error("Google Calendar event creation failed:", err);
      }

      await updateParticipantState(p.id, "COMPLETED");
    }

    await updateSessionStatus(session_id, "COMPLETED");
    await emitSessionEvent(session_id, "match_delivered", {
      day: bestSlot.day,
      start_time: bestSlot.start_time,
      end_time: bestSlot.end_time,
      mutual: mutual.length > 0,
    });

    return {
      match: {
        day: bestSlot.day,
        day_name: bestSlot.day_name,
        start_time: bestSlot.start_time,
        end_time: bestSlot.end_time,
        duration_minutes: bestSlot.duration_minutes,
        mutual_preference: mutual.length > 0,
      },
    };
}

// --- Legacy Trigger.dev task wrapper ---
// Thin shim over deliverMatchToSession. Kept for the legacy orchestrator +
// amend flow. Deleted in phase 05 of the agentic rewrite.

export const deliverResults = schemaTask({
  id: "meetsync-deliver-results",
  schema: payloadSchema,
  maxDuration: 30,
  run: async (payload) => deliverMatchToSession(payload.session_id),
});

function generateIcs(
  slot: {
    day: string;
    day_name: string;
    start_time: string;
    end_time: string;
  },
  timezone: string,
  sessionId: string,
): string {
  // Convert "2026-04-09" + "14:00" to "20260409T140000"
  const dtStart = slot.day.replace(/-/g, "") + "T" + slot.start_time.replace(":", "") + "00";
  const dtEnd = slot.day.replace(/-/g, "") + "T" + slot.end_time.replace(":", "") + "00";

  // Round-10 fix (code review finding #6): UID must be stable per
  // meetup, not per recipient. Previously used `Date.now()` inside
  // the per-participant loop, producing a different UID for every
  // participant's .ics — which breaks RFC 5545 dedup if users forward
  // invites or import multiple .ics files for the same meetup.
  // Using session_id as the UID suffix gives one meetup = one UID
  // across all recipients.
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MeetSync//EN",
    "BEGIN:VEVENT",
    `DTSTART;TZID=${timezone}:${dtStart}`,
    `DTEND;TZID=${timezone}:${dtEnd}`,
    "SUMMARY:Meetup",
    "DESCRIPTION:Scheduled via MeetSync",
    `UID:meetsync-${sessionId}-${slot.day}@meetsync`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

function parsePrefs(prefs: string | null): number[] {
  if (!prefs) return [];
  return prefs
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));
}
