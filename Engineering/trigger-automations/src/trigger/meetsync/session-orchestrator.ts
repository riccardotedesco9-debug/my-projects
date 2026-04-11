// Session orchestrator — coordinates the full session lifecycle
// Round 6: tokens are now created by message-router BEFORE triggering this
// task. Orchestrator receives token IDs AND a `match_attempt` version via
// payload and waits on the tokens. This eliminates the fire-and-forget race
// where the router polled for token IDs that the orchestrator hadn't
// created yet.
//
// Cancellation protocol: message-router can complete either token with
// `{cancelled: true}` to make the orchestrator exit cleanly mid-flight (used
// by the amend flow to cancel the current orchestrator before spawning a
// fresh one). Without this, amending a matched session left the old
// orchestrator parked at gate B until the 7d timeout, then firing a bogus
// "session expired" message on top of the successful match.
//
// Ghost-reminder protection: after deliverResults the orchestrator parks on
// `wait.until(reminderDate)` for up to 24h. If an amend arrives during that
// window it cannot be cancelled via waitpoint (wait.until has no token). To
// prevent duplicate reminders from the stale orchestrator, we compare our
// spawn-time `match_attempt` to the current DB value on wake-up and skip
// the reminder if it has moved — a fresh orchestrator will own the new
// reminder.

import { task, wait } from "@trigger.dev/sdk";
import { query, getSessionParticipants, updateParticipantState, updateSessionStatus, getReplyContext, emitSessionEvent } from "./d1-client.js";
import { sendTextMessage } from "./telegram-client.js";
import { matchCompute } from "./match-compute.js";
import { deliverResults } from "./deliver-results.js";
import { generateResponse } from "./response-generator.js";

type GateSignal = { cancelled?: boolean } | null;

export const sessionOrchestrator = task({
  id: "meetsync-session-orchestrator",
  maxDuration: 604800, // 7 days (mostly paused via waitpoints)

  run: async (payload: {
    session_id: string;
    confirmed_token_id: string;
    preferred_token_id: string;
    match_attempt: number;
  }) => {
    const { session_id, confirmed_token_id, preferred_token_id, match_attempt } = payload;

    // --- Wait for both schedules to be confirmed (gate A) ---
    // Tokens were pre-created by message-router before triggering this task,
    // so `wait.forToken` is guaranteed to find them.
    const confirmedResult = await wait.forToken<GateSignal>(confirmed_token_id);

    if (!confirmedResult.ok) {
      // Timeout (7d) — nobody confirmed. Expire the session.
      await updateSessionStatus(session_id, "EXPIRED");
      const participants = await getSessionParticipants(session_id);
      for (const p of participants) {
        await sendTextMessage(p.chat_id, await generateResponse({
          scenario: "session_expired", state: "EXPIRED",
          ...(await getReplyContext(p.chat_id)),
        }));
        await updateParticipantState(p.id, "EXPIRED");
      }
      await emitSessionEvent(session_id, "session_expired", { stage: "confirmation" });
      return { status: "expired", stage: "confirmation" };
    }

    // Amend flow asked us to bail — fresh orchestrator is taking over.
    if (confirmedResult.output?.cancelled) {
      await emitSessionEvent(session_id, "orchestrator_cancelled", { stage: "confirmation", match_attempt });
      return { status: "cancelled_by_amend", stage: "confirmation" };
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

    // --- Wait for both to submit preferences (gate B) ---
    const preferredResult = await wait.forToken<GateSignal>(preferred_token_id);

    if (!preferredResult.ok) {
      console.log("Preference timeout — delivering best match without preferences");
    }

    // Amend flow asked us to bail mid-preference — fresh orchestrator is taking over.
    if (preferredResult.ok && preferredResult.output?.cancelled) {
      await emitSessionEvent(session_id, "orchestrator_cancelled", { stage: "preferences", match_attempt });
      return { status: "cancelled_by_amend", stage: "preferences" };
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

          // Ghost-reminder guard: if match_attempt moved while we were
          // parked on wait.until, an amend spawned a fresh orchestrator
          // that now owns the reminder. Skip ours to avoid duplicate
          // notifications to participants.
          const current = await query<{ match_attempt: number }>(
            "SELECT match_attempt FROM sessions WHERE id = ?",
            [session_id]
          );
          const currentAttempt = current.results[0]?.match_attempt ?? match_attempt;
          if (currentAttempt !== match_attempt) {
            console.log(
              `[orchestrator] skipping reminder for ${session_id} — match_attempt moved ${match_attempt} -> ${currentAttempt}`
            );
            return { status: "superseded_before_reminder", slot_count: slotCount };
          }

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
