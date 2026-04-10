// Session orchestrator — coordinates the full session lifecycle
// Uses wait.forToken to pause (zero compute) until both users confirm/submit
// Handles match-compute + slot delivery + day-before meetup reminder

import { task, wait } from "@trigger.dev/sdk";
import { query, getSessionParticipants, updateParticipantState, updateSessionStatus, getReplyContext } from "./d1-client.js";
import { sendTextMessage } from "./telegram-client.js";
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

    // NOTE: previously there were fire-and-forget nudges here (3h "no upload"
    // reminder and 2h "invite not tapped" reminder) wrapped in IIFEs with
    // `await wait.for(...)` inside. Round-5 code review found they never fire
    // in production: `wait.forToken(confirmedToken)` below checkpoints the
    // task and orphans the IIFE promises, so the inner `wait.for` waitpoints
    // are silently dropped. Removing rather than shipping dead comfort code.
    // If nudges are needed, re-implement as proper child tasks triggered from
    // the main path with their own waitpoints.

    // --- Wait for both schedules to be confirmed ---
    const confirmedResult = await wait.forToken(confirmedToken);

    if (!confirmedResult.ok) {
      await updateSessionStatus(session_id, "EXPIRED");
      const participants = await getSessionParticipants(session_id);
      for (const p of participants) {
        await sendTextMessage(p.chat_id, await generateResponse({
          scenario: "session_expired", state: "EXPIRED",
          ...(await getReplyContext(p.chat_id)),
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
      const ord = (n: string) => { const d = parseInt(n); const s = ["th","st","nd","rd"]; const v = d % 100; return d + (s[(v-20)%10] || s[v] || s[0]); };
      dayLines.push(`*${dayName} ${ord(dateNum)}* — ${windows}`);
    }

    const slotListFormatted = dayLines.join("\n");

    for (const p of participants) {
      await updateParticipantState(p.id, "AWAITING_PREFERENCES");
      await sendTextMessage(p.chat_id, await generateResponse({
        scenario: "remind_preferences", state: "AWAITING_PREFERENCES",
        slotList: slotListFormatted,
        extraContext: "First time showing slots — ask which days work for them.",
        ...(await getReplyContext(p.chat_id)),
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
            await sendTextMessage(p.chat_id, await generateResponse({
              scenario: "meetup_reminder", state: "COMPLETED", matchResult: matchStr,
              ...(await getReplyContext(p.chat_id)),
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
