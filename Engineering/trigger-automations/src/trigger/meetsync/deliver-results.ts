// Deliver results — sends final meeting match to all participants

import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { sendTextMessage, sendDocumentMessage } from "./telegram-client.js";
import { query, getSessionParticipants, updateParticipantState, updateSessionStatus } from "./d1-client.js";
import { createCalendarEvent } from "./google-calendar.js";
import { generateResponse } from "./response-generator.js";

const payloadSchema = z.object({
  session_id: z.string(),
});

export const deliverResults = schemaTask({
  id: "meetsync-deliver-results",
  schema: payloadSchema,
  maxDuration: 30,

  run: async (payload) => {
    const { session_id } = payload;

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
        }));
        await updateParticipantState(p.id, "COMPLETED");
      }
      await updateSessionStatus(session_id, "COMPLETED");
      return { match: null, reason: "no_overlap" };
    }

    // Parse all participants' preferences and find mutual slots
    const allPrefs = participants.map((p) => parsePrefs(p.preferred_slots));

    // Mutual = slots that ALL participants prefer
    const mutual = allPrefs[0].filter((slot) =>
      allPrefs.every((prefs) => prefs.includes(slot))
    );

    // Best match: first mutual preferred slot, or first slot overall
    const bestSlotNumber = mutual.length > 0 ? mutual[0] : slots[0].slot_number;
    const bestSlot = slots.find((s) => s.slot_number === bestSlotNumber) ?? slots[0];

    // Format the match result for the response generator
    const hours = Math.floor(bestSlot.duration_minutes / 60);
    const mins = bestSlot.duration_minutes % 60;
    const durationStr = mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    const matchResultStr = `*${bestSlot.day_name} ${bestSlot.day}*\n${bestSlot.start_time} - ${bestSlot.end_time} (${durationStr})`;
    const scenario = mutual.length > 0 ? "mutual_match" : "best_match";

    // Generate .ics calendar file for the match
    const icsContent = generateIcs(bestSlot);

    // Send result message + calendar file to both participants
    // Also attempt to add to Google Calendar if user has connected their account
    for (const p of participants) {
      await sendTextMessage(p.chat_id, await generateResponse({
        scenario, state: "COMPLETED", matchResult: matchResultStr,
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
          "Meetup"
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
  },
});

function generateIcs(slot: {
  day: string;
  day_name: string;
  start_time: string;
  end_time: string;
}): string {
  // Convert "2026-04-09" + "14:00" to "20260409T140000"
  const dtStart = slot.day.replace(/-/g, "") + "T" + slot.start_time.replace(":", "") + "00";
  const dtEnd = slot.day.replace(/-/g, "") + "T" + slot.end_time.replace(":", "") + "00";

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MeetSync//EN",
    "BEGIN:VEVENT",
    `DTSTART;TZID=Europe/Malta:${dtStart}`,
    `DTEND;TZID=Europe/Malta:${dtEnd}`,
    "SUMMARY:Meetup",
    "DESCRIPTION:Scheduled via MeetSync",
    `UID:meetsync-${slot.day}-${Date.now()}@meetsync`,
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
