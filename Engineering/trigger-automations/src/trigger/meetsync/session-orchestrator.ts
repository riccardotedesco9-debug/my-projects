// Session orchestrator — coordinates the full session lifecycle
// Uses wait.forToken to pause (zero compute) until both users confirm/submit
// Includes nudge reminders and day-before meetup reminders

import { task, wait } from "@trigger.dev/sdk";
import { query, getSessionParticipants, updateParticipantState, updateSessionStatus } from "./d1-client.js";
import { sendTextMessage } from "./whatsapp-client.js";
import { matchCompute } from "./match-compute.js";
import { deliverResults } from "./deliver-results.js";
import { generateResponse } from "./response-generator.js";

export const sessionOrchestrator = task({
  id: "meetsync-session-orchestrator",
  maxDuration: 604800, // 7 days (mostly paused via waitpoints)

  run: async (payload: { session_id: string }) => {
    const { session_id } = payload;

    // Create waitpoint tokens for the two checkpoints
    const confirmedToken = await wait.createToken({
      idempotencyKey: `confirmed-${session_id}`,
      timeout: "7d",
    });

    const preferredToken = await wait.createToken({
      idempotencyKey: `preferred-${session_id}`,
      timeout: "4h",
    });

    // Store token IDs in session so message-router can complete them
    await query(
      "UPDATE sessions SET both_confirmed_token_id = ?, both_preferred_token_id = ? WHERE id = ?",
      [confirmedToken.id, preferredToken.id, session_id]
    );

    // --- Single nudge after 3 hours if someone hasn't uploaded ---
    let bothConfirmed = false;

    const nudgeOnce = async () => {
      await wait.for({ hours: 3 });
      if (bothConfirmed) return; // session already progressed, skip nudge

      const participants = await getSessionParticipants(session_id);
      if (participants.every((p) => p.state === "SCHEDULE_CONFIRMED")) return;

      const waiting = participants.filter((p) =>
        ["AWAITING_SCHEDULE", "SCHEDULE_RECEIVED", "AWAITING_CONFIRMATION"].includes(p.state)
      );
      for (const p of waiting) {
        await sendTextMessage(p.phone, await generateResponse({
          scenario: "nudge_reminder", state: p.state,
        }));
      }
    };

    nudgeOnce().catch((err) => console.error("Nudge error:", err));

    // --- Wait for both schedules to be confirmed ---
    const confirmedResult = await wait.forToken(confirmedToken);
    bothConfirmed = true;

    if (!confirmedResult.ok) {
      await updateSessionStatus(session_id, "EXPIRED");
      const participants = await getSessionParticipants(session_id);
      for (const p of participants) {
        await sendTextMessage(p.phone, await generateResponse({
          scenario: "session_expired", state: "EXPIRED",
        }));
        await updateParticipantState(p.id, "EXPIRED");
      }
      return { status: "expired", stage: "confirmation" };
    }

    // --- Compute matches ---
    await updateSessionStatus(session_id, "MATCHING");

    const matchResult = await matchCompute.triggerAndWait({ session_id });

    if (!matchResult.ok) {
      throw new Error("Match computation failed");
    }

    const slotCount = matchResult.output.slot_count;

    if (slotCount === 0) {
      await deliverResults.triggerAndWait({ session_id });
      return { status: "completed", match: "none" };
    }

    // --- Send recommendations to both participants ---
    const participants = await getSessionParticipants(session_id);
    const slotsResult = await query<{
      slot_number: number;
      day: string;
      day_name: string;
      start_time: string;
      end_time: string;
      duration_minutes: number;
      explanation: string | null;
    }>(
      "SELECT * FROM free_slots WHERE session_id = ? ORDER BY slot_number",
      [session_id]
    );

    // Group slots by day for cleaner display
    const slotsByDay = new Map<string, typeof slotsResult.results>();
    for (const s of slotsResult.results) {
      const existing = slotsByDay.get(s.day) ?? [];
      existing.push(s);
      slotsByDay.set(s.day, existing);
    }

    const dayLines: string[] = [];
    for (const [day, daySlots] of slotsByDay) {
      const dayName = daySlots[0].day_name;
      const dateNum = day.split("-")[2]; // "09" from "2026-04-09"
      const windows = daySlots.map((s) => {
        const hours = Math.floor(s.duration_minutes / 60);
        const mins = s.duration_minutes % 60;
        const dur = mins > 0 ? `${hours}h${mins}m` : `${hours}h`;
        const why = s.explanation ? ` — ${s.explanation}` : "";
        return `${s.start_time}-${s.end_time} (${dur})${why}`;
      }).join(", ");
      dayLines.push(`*${dayName} ${dateNum}th* — ${windows}`);
    }

    const slotListFormatted = dayLines.join("\n");

    for (const p of participants) {
      await updateParticipantState(p.id, "AWAITING_PREFERENCES");
      await sendTextMessage(p.phone, await generateResponse({
        scenario: "remind_preferences", state: "AWAITING_PREFERENCES",
        slotList: slotListFormatted,
        extraContext: "First time showing slots — ask which days work for them.",
      }));
    }

    // --- Wait for both to submit preferences ---
    const preferredResult = await wait.forToken(preferredToken);

    if (!preferredResult.ok) {
      console.log("Preference timeout — delivering best match without preferences");
    }

    // --- Deliver final result ---
    const deliverResult = await deliverResults.triggerAndWait({ session_id });

    // --- Day-before reminder ---
    if (deliverResult.ok && deliverResult.output.match) {
      const matchDay = deliverResult.output.match.day;
      const reminderDate = new Date(matchDay);
      reminderDate.setDate(reminderDate.getDate() - 1);
      reminderDate.setHours(19, 0, 0, 0); // 7 PM night before

      if (reminderDate > new Date()) {
        try {
          await wait.until({ date: reminderDate });

          const allParticipants = await getSessionParticipants(session_id);
          const match = deliverResult.output.match;
          const matchStr = `*${match.day_name} ${match.day}*\n${match.start_time} - ${match.end_time}`;
          for (const p of allParticipants) {
            await sendTextMessage(p.phone, await generateResponse({
              scenario: "meetup_reminder", state: "COMPLETED", matchResult: matchStr,
            }));
          }
        } catch (err) {
          console.error("Reminder error:", err);
        }
      }
    }

    return { status: "completed", slot_count: slotCount };
  },
});
