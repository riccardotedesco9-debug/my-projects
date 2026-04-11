// Deliver results — sends final meeting match to all participants.
//
// Called by the agentic turn-handler's compute_and_deliver_match tool.
// Reads free_slots + participant preferences, picks the best slot
// (mutual preference → longest duration → chronological tiebreaker),
// sends a .ics file + Telegram notification + Google Calendar event to
// every participant, marks the session COMPLETED. Pure async function,
// no Trigger.dev task wrapper (legacy schemaTask removed in phase 05).
//
// Each participant gets their message in their own preferred language
// via a tiny multi-language template table — no scenario system, no
// extra LLM calls. The philosophy of the rewrite is to trust Claude
// for agent reasoning and use plain code for mechanical delivery.

import { sendTextMessage, sendDocumentMessage } from "./telegram-client.js";
import { query, getSessionParticipants, updateSessionStatus, getUser, getUserTimezone, emitSessionEvent } from "./d1-client.js";
import { createCalendarEvent } from "./google-calendar.js";

export interface DeliverMatchResult {
  match: {
    day: string;
    day_name: string;
    start_time: string;
    end_time: string;
    duration_minutes: number;
    mutual_preference: boolean;
  } | null;
  all_slots?: Array<{
    day: string;
    day_name: string;
    start_time: string;
    end_time: string;
    duration_minutes: number;
  }>;
  reason?: string;
}

export interface DeliverMatchOptions {
  /**
   * Skip the static-template text reply for this chat_id (the .ics file
   * and Google Calendar event still go through). Used when the caller is
   * inside the participants list — Claude composes their reply via the
   * reply tool, so the static template would duplicate.
   */
  excludeTextForChatId?: string;
  /**
   * Don't mark the session COMPLETED after delivery. Default false (auto
   * complete). Set true when you want the user to be able to ask follow-up
   * questions like "what about Sunday instead?" without having to reopen.
   */
  keepSessionOpen?: boolean;
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
export async function deliverMatchToSession(
  session_id: string,
  options: DeliverMatchOptions = {},
): Promise<DeliverMatchResult> {
    const { excludeTextForChatId, keepSessionOpen = false } = options;
    const participants = await getSessionParticipants(session_id);
    // No < 2 check: compute_and_deliver_match already validates that there
    // are >= 2 schedules across (participants ∪ on-behalf person_notes).
    // It's fine for the session to have just 1 real participant when the
    // other side is an on-behalf upload — that on-behalf person isn't a
    // bot user and can't receive a Telegram message anyway, so we deliver
    // to whoever is in the participants list (typically the creator).
    if (participants.length === 0) {
      throw new Error(`Session ${session_id} has zero participants`);
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
      // Notify only OTHER participants (not the caller — Claude handles
      // their reply via the reply tool).
      for (const p of participants) {
        if (p.chat_id === excludeTextForChatId) continue;
        const lang = await getUserLanguage(p.chat_id);
        await sendTextMessage(p.chat_id, NO_OVERLAP_TEMPLATES[lang] ?? NO_OVERLAP_TEMPLATES.en);
      }
      if (!keepSessionOpen) await updateSessionStatus(session_id, "COMPLETED");
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

    // Format the match result for the per-recipient template
    const hours = Math.floor(bestSlot.duration_minutes / 60);
    const mins = bestSlot.duration_minutes % 60;
    const durationStr = mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    const matchLine = `*${bestSlot.day_name} ${bestSlot.day}*\n${bestSlot.start_time} – ${bestSlot.end_time} (${durationStr})`;
    const isMutual = mutual.length > 0;

    // Send the .ics + Google Calendar event to EVERY participant (including
    // the caller — they want the file). Send the static text template only
    // to participants OTHER than the caller, since Claude composes the
    // caller's reply via the reply tool and the template would duplicate.
    for (const p of participants) {
      const tz = await getUserTimezone(p.chat_id);
      const lang = await getUserLanguage(p.chat_id);
      const icsContent = generateIcs(bestSlot, tz, session_id);
      const isCaller = p.chat_id === excludeTextForChatId;

      if (!isCaller) {
        const template = (isMutual ? MUTUAL_MATCH_TEMPLATES : BEST_MATCH_TEMPLATES)[lang]
          ?? (isMutual ? MUTUAL_MATCH_TEMPLATES.en : BEST_MATCH_TEMPLATES.en);
        await sendTextMessage(p.chat_id, template.replace("{MATCH}", matchLine));
      }

      try {
        await sendDocumentMessage(p.chat_id, icsContent, "meetup.ics", CALENDAR_CAPTIONS[lang] ?? CALENDAR_CAPTIONS.en);
      } catch (err) {
        console.error("Failed to send .ics file:", err);
      }

      try {
        const added = await createCalendarEvent(
          p.chat_id,
          bestSlot.day,
          bestSlot.start_time,
          bestSlot.end_time,
          "Meetup",
          tz,
        );
        if (added && !isCaller) {
          await sendTextMessage(p.chat_id, GCAL_CONFIRMATION[lang] ?? GCAL_CONFIRMATION.en);
        }
      } catch (err) {
        console.error("Google Calendar event creation failed:", err);
      }
    }

    if (!keepSessionOpen) {
      await updateSessionStatus(session_id, "COMPLETED");
    }
    await emitSessionEvent(session_id, "match_delivered", {
      day: bestSlot.day,
      start_time: bestSlot.start_time,
      end_time: bestSlot.end_time,
      mutual: mutual.length > 0,
      kept_open: keepSessionOpen,
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
      // Hand back ALL slots so Claude can list them or recommend among them
      // — supports the "what about Sunday?" / "show me everything" follow-ups.
      all_slots: slots.map((s) => ({
        day: s.day,
        day_name: s.day_name,
        start_time: s.start_time,
        end_time: s.end_time,
        duration_minutes: s.duration_minutes,
      })),
    };
}

// --- Templates for match delivery (en + it) ---
//
// Used for OTHER participants' notifications only — the caller's reply
// is composed by Claude via the reply tool. Add languages as needed.

const NO_OVERLAP_TEMPLATES: Record<string, string> = {
  en: "Couldn't find any overlapping free time. Try updated schedules or a different week.",
  it: "Non ho trovato orari liberi in comune. Prova orari aggiornati o un'altra settimana.",
};

const MUTUAL_MATCH_TEMPLATES: Record<string, string> = {
  en: "Same slot picked all round — done!\n\n{MATCH}\n\nEnjoy.",
  it: "Avete scelto tutti lo stesso orario — fatto!\n\n{MATCH}\n\nBuon incontro.",
};

const BEST_MATCH_TEMPLATES: Record<string, string> = {
  en: "Here's one that fits everyone:\n\n{MATCH}\n\nLet me know if you want to see other options.",
  it: "Ecco un orario che va bene per tutti:\n\n{MATCH}\n\nDimmi se vuoi altre opzioni.",
};

const CALENDAR_CAPTIONS: Record<string, string> = {
  en: "Tap to add to your calendar",
  it: "Tocca per aggiungere al calendario",
};

const GCAL_CONFIRMATION: Record<string, string> = {
  en: "Added to your Google Calendar.",
  it: "Aggiunto al tuo Google Calendar.",
};

async function getUserLanguage(chatId: string): Promise<string> {
  const user = await getUser(chatId);
  return user?.preferred_language ?? "en";
}

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
