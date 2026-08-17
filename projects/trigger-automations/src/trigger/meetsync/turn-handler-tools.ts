// Turn-handler tools — the Anthropic tools the turn-handler exposes to
// Claude Sonnet on every turn. Each tool has a JSON schema (for the model)
// and an `execute` function (the actual implementation).
//
// Design rules:
//   1. Tools are pure wrappers over existing helpers (d1-client, parser,
//      match-compute, deliver-results). No new business logic lives here.
//   2. Errors are returned as structured {error: string} tool results, never
//      thrown. Claude reads the error and decides how to recover.
//   3. Writes that mutate the snapshot don't refresh it — tool results
//      contain the delta (e.g. "saved 5 shifts to Diego") so Claude has
//      enough context for the next decision.
//   4. Privacy: tools scope to the caller's own data. Cross-user reads are
//      only possible through fields the caller has in their snapshot (their
//      own session participants, their own person_notes).
//   5. `reply` is the terminal tool — its implementation stores the reply
//      in the context and the loop exits.

import {
  query,
  updateUserName,
  updateUserLanguage,
  updateUserPhone,
  updateUserTimezone,
  appendUserContext,
  upsertPersonNote,
  setPersonNoteSchedule,
  findPersonNote,
  findUserByName,
  findUserByPhone,
  setPersonNoteHidden,
  getLatestScheduleForUser,
  getPersonNotesForOwner,
  updateUserLatestSchedule,
  appendBusyBlockToUser,
  removeBusyBlockFromUser,
  findChatIdsByEmails,
  createScheduleWatch,
  listWatchesForTarget,
  deleteScheduleWatch,
  createReminder,
  listUserReminders,
  cancelReminder,
  localIsoToUtcEpoch,
  type ReminderRecurrence,
  emitSessionEvent,
  getUser,
  linkPersonNoteToChat,
  type Snapshot,
  parseScheduleBlob,
  type ScheduleShift,
} from "./d1-client.js";
import {
  extractSchedule,
  classifyMime,
  mapMimeType,
  arrayBufferToBase64,
  bufferToText,
  spreadsheetToText,
  type ExtractScheduleResult,
} from "./schedule-parser.js";
import {
  computeOverlaps,
  computeSinglePersonSlots,
  type ComputedFreeSlot,
} from "./match-compute.js";
import { downloadMedia, sendTextMessage } from "./telegram-client.js";
import { defaultEndTime, inferEventMinutes } from "./event-duration.js";
import {
  createCalendarEvent,
  listCalendarEventsInWindow,
  findCalendarEventsOnDate,
  deleteCalendarEvent,
  sanitiseContactCalendarEvent,
  filterExternalCalendarEvents,
} from "./google-calendar.js";
import {
  todayIsoInTimezone,
  isoDateOffset,
  renderScheduleForDisplay,
  renderAvailabilityBlock,
} from "./turn-handler-snapshot.js";

// --- Types ---

export interface ReplyButton {
  text: string;
  callback: "confirm" | "reject" | "yes" | "no" | "new_session";
}

export interface PendingReply {
  messages: string[];   // 1+ messages to send in order
  buttons?: ReplyButton[]; // inline keyboard on the LAST message only
}

export interface ToolContext {
  callerChatId: string;
  snapshot: Snapshot;
  /** Cached media from the current turn (if any). parse_schedule reuses this. */
  cachedMedia?: { base64: string; mediaType: string };
  /** Text from the current turn — used when the user types "I work 9-5" without calling parse_schedule on a file. */
  currentText?: string;
  /** Populated by the reply tool. The handler reads this after the loop exits and sends to Telegram. */
  pendingReply?: PendingReply;
  /** Set when the reply tool has been called — signals the handler to exit the loop. */
  replySent: boolean;
}

export interface ToolResult {
  [key: string]: unknown;
}

interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  execute: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

// --- Helpers ---

/**
 * Caller's timezone, with a single fallback chain used by all time-sensitive
 * tools (schedule_reminder, list_reminders, …). Snapshot-level tz is the
 * authoritative value; user-level is a secondary source; Europe/Malta is the
 * product default. Having one helper keeps behavior consistent across tools.
 */
function resolveCallerTimezone(ctx: ToolContext): string {
  return ctx.snapshot.timezone || ctx.snapshot.user.timezone || "Europe/Malta";
}

/** Minutes since midnight from "HH:MM". */
function timeToMinutes(hm: string): number {
  const m = hm.match(/^(\d{2}):(\d{2})$/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/** Inverse of timeToMinutes. */
function minutesToTime(total: number): string {
  const h = Math.floor(total / 60).toString().padStart(2, "0");
  const m = (total % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * All busy windows for a user on a specific date, pulled from both their
 * stored schedule_json (shifts + hectic days) and their live Google
 * Calendar (if connected). Returned as [start,end) minute-ranges within
 * the day (0-1440). Used by book_meetup's conflict check.
 */
async function gatherBusyBlocksForDate(
  chatId: string,
  date: string,
  timezone: string,
  sanitiseCalendarLabels = false,
): Promise<Array<{ start: number; end: number; label: string }>> {
  const blocks: Array<{ start: number; end: number; label: string }> = [];
  const prevDate = shiftDateISO(date, -1);
  const pushShiftBlock = (
    s: { date: string; start_time: string; end_time: string; label?: string },
  ): void => {
    // OFF marker — informational only ("off from work / main commitment"),
    // NOT a hard block on availability. Skip this entry but keep processing
    // the rest of the array — other entries on the same date (e.g. gym
    // 18:00–19:00 on an off day) are real blocks and still get pushed below.
    // Do not "fix" this skip without re-reading the encoding rules in
    // turn-handler.ts buildSystemPrompt.
    if (s.start_time === "00:00" && s.end_time === "00:00") return;
    const start = timeToMinutes(s.start_time);
    const end = timeToMinutes(s.end_time);
    const label = s.label ?? "busy";
    const isOvernight = end < start;
    if (!isOvernight && s.date === date) {
      blocks.push({ start, end, label });
      return;
    }
    if (isOvernight) {
      // Overnight shift (e.g. 22:00–06:00): fills target-date from
      // `start` to midnight, AND spills into the next day from 00:00 to
      // `end`. For our target `date`, include BOTH directions: any
      // shift that starts on `date` (fills 22→24), OR any shift on
      // prevDate that spills into `date` (fills 00→06).
      if (s.date === date) {
        blocks.push({ start, end: 24 * 60, label });
      } else if (s.date === prevDate) {
        blocks.push({ start: 0, end, label });
      }
    }
  };

  const sched = await getLatestScheduleForUser(chatId);
  const parsedSched = parseScheduleBlob(sched);
  if (parsedSched) {
    for (const s of parsedSched) pushShiftBlock(s);
  }
  try {
    // Pull calendar events for yesterday+today so overnight calendar
    // events that end on `date` also count as busy. When this is a
    // contact (not the caller), sanitise event labels before they
    // reach the conflict reason / blocks list — the privacy rule
    // shouldn't depend on Claude remembering to abstract.
    const events = await listCalendarEventsInWindow(chatId, prevDate, date, timezone);
    for (const e of events) {
      pushShiftBlock(sanitiseCalendarLabels ? sanitiseContactCalendarEvent(e) : e);
    }
  } catch {
    // calendar read is best-effort
  }
  return blocks;
}

/** Return `date` shifted by `days` (positive or negative) as YYYY-MM-DD. */
function shiftDateISO(date: string, days: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// --- Sleep / commute window check ---
//
// Hard rule from the user: at least 8h sleep + 1h commute on either side of
// a work shift. The system prompt asked Claude to enforce this in its head,
// which empirically didn't hold — the bot kept booking yoga at 08:00 after a
// 02:00 finish. So we compute the math in code and feed warnings back to
// Claude as a tool-result field. book_meetup hard-blocks unless the caller
// explicitly overrides; add_personal_event surfaces the warnings but still
// saves (the user is asserting reality, not asking the bot to choose).

const SLEEP_BUFFER_MIN = 8 * 60;     // 8h sleep
const COMMUTE_BUFFER_MIN = 60;       // 1h commute
const TOTAL_BUFFER_MIN = SLEEP_BUFFER_MIN + COMMUTE_BUFFER_MIN; // 9h

// Typical sleep window — broad to cover both regular and late-shift
// sleep patterns: "in bed by 22:00" through "up by 10:00". Used to gate
// sleep_warnings: a gap between two events is only a SLEEP concern if it
// actually contains a meaningful chunk of these hours. Daytime gaps
// (yoga 09:00 → work 15:00, work 07:00–16:00 → yoga 18:30) are NOT sleep
// concerns even when shorter than the 9h buffer — the user is awake.
const SLEEP_ZONE_START_MIN = 22 * 60;          // 22:00 (relative to day N)
const SLEEP_ZONE_END_MIN = 24 * 60 + 10 * 60;  // 10:00 next day = 34:00
// Minimum overlap required for a gap to count as a "sleep gap". A tiny
// sliver (gym 07:00 → work 09:00, only the 09:00–10:00 tail of the sleep
// zone intersects) is NOT a sleep concern — the user was awake in that
// short gap. Real sleep gaps cover at least 4 hours of the sleep window.
const MIN_SLEEP_OVERLAP_MIN = 4 * 60;

/**
 * Does the gap [gapStartAbs, gapEndAbs] contain a meaningful chunk of the
 * caller's sleep zone (≥ MIN_SLEEP_OVERLAP_MIN minutes)? Sweeps the days
 * adjacent to the gap so overnight gaps and multi-day gaps both work.
 */
function gapOverlapsSleepZone(gapStartAbs: number, gapEndAbs: number): boolean {
  if (gapEndAbs <= gapStartAbs) return false;
  const startDay = Math.floor(gapStartAbs / 1440);
  const endDay = Math.floor(gapEndAbs / 1440);
  for (let day = startDay - 1; day <= endDay + 1; day++) {
    const zoneStart = day * 1440 + SLEEP_ZONE_START_MIN;
    const zoneEnd = day * 1440 + SLEEP_ZONE_END_MIN;
    const overlap = Math.min(gapEndAbs, zoneEnd) - Math.max(gapStartAbs, zoneStart);
    if (overlap >= MIN_SLEEP_OVERLAP_MIN) return true;
  }
  return false;
}

/** Days between two YYYY-MM-DD strings (b - a). UTC-anchored. */
function daysBetween(aISO: string, bISO: string): number {
  const a = Date.UTC(
    Number(aISO.slice(0, 4)), Number(aISO.slice(5, 7)) - 1, Number(aISO.slice(8, 10)),
  );
  const b = Date.UTC(
    Number(bISO.slice(0, 4)), Number(bISO.slice(5, 7)) - 1, Number(bISO.slice(8, 10)),
  );
  return Math.round((b - a) / 86400000);
}

/** Format a minute count as "Xh" or "XhYm". */
function formatGap(mins: number): string {
  if (mins < 0) mins = 0;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}m`;
}

/**
 * Identify a "work" shift by label. Conservative: looks for work-ish words
 * in the label. OFF markers (00:00–00:00) are never work. All-day-busy is
 * not treated as work either (it's "hectic" — covers other commitments).
 */
function isWorkShift(s: { start_time: string; end_time: string; label?: string }): boolean {
  if (s.start_time === "00:00" && s.end_time === "00:00") return false;
  if (s.start_time === "00:00" && s.end_time === "23:59") return false;
  if (!s.label) return false;
  return /\b(work|shift|office|job)\b/i.test(s.label);
}

/**
 * Detect sleep-window violations between a proposed event and the caller's
 * adjacent work shifts. Returns human-readable warning strings — empty if
 * everything fits. The math is absolute-minutes-from-event-date so overnight
 * shifts (end < start) and cross-day comparisons work uniformly.
 *
 * Returns warnings for BOTH sides: a shift ending too close before the event
 * (insufficient post-work sleep), and a shift starting too close after the
 * event (insufficient pre-work sleep).
 */
function computeSleepWarnings(
  scheduleJson: string | null,
  date: string,
  startTime: string,
  endTime: string,
): string[] {
  if (!scheduleJson) return [];
  const shifts = parseScheduleBlob(scheduleJson);
  if (!shifts) return [];

  // Anchor all minutes against the event date's UTC midnight.
  const eventStartRaw = timeToMinutes(startTime);
  const eventEndRaw = timeToMinutes(endTime);
  const eventOvernight = eventEndRaw < eventStartRaw;
  const eventStartAbs = eventStartRaw; // event date day 0
  const eventEndAbs = eventOvernight ? eventEndRaw + 1440 : eventEndRaw;

  let prevWorkEndAbs = -Infinity;
  let prevWorkShift: { date: string; start_time: string; end_time: string; label?: string } | null = null;
  let nextWorkStartAbs = Infinity;
  let nextWorkShift: { date: string; start_time: string; end_time: string; label?: string } | null = null;

  for (const s of shifts) {
    if (!isWorkShift(s)) continue;
    const dayOffset = daysBetween(date, s.date) * 1440;
    const sStartRaw = timeToMinutes(s.start_time);
    const sEndRaw = timeToMinutes(s.end_time);
    const overnight = sEndRaw < sStartRaw;
    const sStartAbs = dayOffset + sStartRaw;
    const sEndAbs = overnight ? dayOffset + sEndRaw + 1440 : dayOffset + sEndRaw;
    // Skip shifts that finished more than 36h before the event or start
    // more than 36h after — they can't violate a 9h buffer anyway.
    if (sEndAbs < eventStartAbs - 36 * 60) continue;
    if (sStartAbs > eventEndAbs + 36 * 60) continue;

    if (sEndAbs <= eventStartAbs && sEndAbs > prevWorkEndAbs) {
      prevWorkEndAbs = sEndAbs;
      prevWorkShift = s;
    }
    if (sStartAbs >= eventEndAbs && sStartAbs < nextWorkStartAbs) {
      nextWorkStartAbs = sStartAbs;
      nextWorkShift = s;
    }
  }

  const warnings: string[] = [];
  // Only push a warning when the short gap actually overlaps typical
  // sleep hours. A daytime 6h gap (yoga 09:00 → work 15:00 same day)
  // is NOT a sleep concern — you're awake. The user explicitly called
  // this out: never warn in the wrong direction.
  if (prevWorkShift && prevWorkEndAbs > -Infinity) {
    const gap = eventStartAbs - prevWorkEndAbs;
    if (gap < TOTAL_BUFFER_MIN && gapOverlapsSleepZone(prevWorkEndAbs, eventStartAbs)) {
      const prevOvernight = timeToMinutes(prevWorkShift.end_time) < timeToMinutes(prevWorkShift.start_time);
      const realEndDate = prevOvernight ? shiftDateISO(prevWorkShift.date, 1) : prevWorkShift.date;
      warnings.push(
        `Work ends at ${prevWorkShift.end_time} on ${realEndDate} and this event starts at ${startTime} on ${date} — gap is only ${formatGap(gap)} (crosses sleep hours), below the 9h sleep + commute buffer (8h sleep + 1h commute home from the office).`,
      );
    }
  }
  if (nextWorkShift && nextWorkStartAbs < Infinity) {
    const gap = nextWorkStartAbs - eventEndAbs;
    if (gap < TOTAL_BUFFER_MIN && gapOverlapsSleepZone(eventEndAbs, nextWorkStartAbs)) {
      warnings.push(
        `Event ends ${endTime} on ${date} and next work starts ${nextWorkShift.start_time} on ${nextWorkShift.date} — gap is only ${formatGap(gap)} (crosses sleep hours), below the 9h sleep + commute buffer (8h sleep + 1h commute to the office).`,
      );
    }
  }
  return warnings;
}

/**
 * Notify each owner whose shadow-tracked contact just got linked to a newly-
 * known chat_id. Sends a Telegram message per owner in the owner's language,
 * mentioning whether the contact already has a schedule on file. Best-effort.
 */
async function notifyShadowLinkResolutions(
  resolved: Array<{ owner_chat_id: string; name: string }>,
  linkedChatId: string,
): Promise<void> {
  if (resolved.length === 0) return;
  const linkedUser = await getUser(linkedChatId);
  const hasSchedule = !!linkedUser?.latest_schedule_json;
  for (const row of resolved) {
    try {
      const owner = await getUser(row.owner_chat_id);
      const lang = owner?.preferred_language ?? "en";
      const schedLine = hasSchedule
        ? (lang === "it" ? " Hanno già condiviso il loro orario, quindi posso trovare una sovrapposizione quando vuoi."
          : lang === "es" ? " Ya han compartido su horario, así que puedo encontrar un solapamiento cuando quieras."
          : lang === "fr" ? " Ils ont déjà partagé leur emploi du temps, je peux trouver un créneau commun quand tu veux."
          : lang === "de" ? " Sie haben ihren Zeitplan schon geteilt — ich kann Überschneidungen jederzeit finden."
          : " They've already shared their schedule, so I can find an overlap whenever you're ready.")
        : "";
      const msg =
        lang === "it" ? `🔗 ${row.name} si è appena unito al bot e ora è collegato ai tuoi contatti.${schedLine}`
        : lang === "es" ? `🔗 ${row.name} acaba de unirse al bot y ahora está vinculado a tus contactos.${schedLine}`
        : lang === "fr" ? `🔗 ${row.name} vient de rejoindre le bot et est maintenant lié à tes contacts.${schedLine}`
        : lang === "de" ? `🔗 ${row.name} ist dem Bot gerade beigetreten und jetzt mit deinen Kontakten verknüpft.${schedLine}`
        : `🔗 ${row.name} just joined the bot and is now linked in your contacts.${schedLine}`;
      await sendTextMessage(row.owner_chat_id, msg);
    } catch (err) {
      console.warn(`[shadow-link notify] failed for owner ${row.owner_chat_id}:`, err);
    }
  }
}

// --- Tool 1: parse_schedule (auto-saves on success) ---
//
// Extracts shifts and writes them straight to D1 in one call —
// participant.schedule_json for the caller's own schedule,
// person_notes.schedule_json when attributed_to_name is set. Auto-creates
// a session if the caller has none. Returns the parsed shifts. Claude
// reads the result and decides how to reply.

const parseScheduleTool: ToolDefinition = {
  name: "parse_schedule",
  description:
    "Extract and save shifts from a schedule. Input modes (priority order): (1) shifts — structured array you extracted yourself (fastest, most reliable); (2) text_content — typed input; (3) media_id — Telegram file_id referenced from a previous turn's '[photo uploaded · file_id=...]' entry; (4) omit all — uses the current turn's attached media. attributed_to_name routes the shifts to a named contact; omit it to save to the caller. For multi-person CSVs: one call per person, attributed_to_name for everyone except the caller. Don't call this on voice messages — they arrive pre-transcribed as text; use 'shifts' or 'text_content'.",
  input_schema: {
    type: "object",
    properties: {
      shifts: {
        type: "array",
        description: "Pre-extracted shifts to save directly. Use this when you can already see the schedule in an attached file or in the user's text — skips the parser entirely. Each shift: {date: 'YYYY-MM-DD', start_time: 'HH:MM', end_time: 'HH:MM', label?: string}. Use 24-hour times. For days off, use start='00:00' end='00:00' with label='off' (canonical — always this exact string). If a day is off but has a brief activity (e.g. 'Mon off, gym 6–7pm'), emit BOTH entries on the same date: the OFF marker AND the partial-busy entry. Don't drop one — both together preserve 'off from work, but gym blocks 18:00–19:00'.",
        items: {
          type: "object",
          required: ["date", "start_time", "end_time"],
          properties: {
            date: { type: "string", description: "YYYY-MM-DD" },
            start_time: { type: "string", description: "HH:MM (24h)" },
            end_time: { type: "string", description: "HH:MM (24h)" },
            label: { type: "string" },
          },
        },
      },
      text_content: {
        type: "string",
        description: "Typed hours or text description. Use this when the user typed their schedule and you want the parser to extract structured shifts.",
      },
      media_id: {
        type: "string",
        description: "Telegram file_id from a previous turn's history entry. Use this when the user references a file they already sent.",
      },
      mime_type: {
        type: "string",
        description: "MIME type for media_id. Optional — defaults to JPEG.",
      },
      attributed_to_name: {
        type: "string",
        description: "Name of the third party this schedule is for, if it's not the user's own schedule.",
      },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const directShifts = Array.isArray(input.shifts) ? (input.shifts as Array<Record<string, unknown>>) : undefined;
    const textContent = typeof input.text_content === "string" ? input.text_content : undefined;
    const explicitMediaId = typeof input.media_id === "string" ? input.media_id.trim() : "";
    const explicitMimeType = typeof input.mime_type === "string" ? input.mime_type : undefined;
    const attributedToName = typeof input.attributed_to_name === "string" ? input.attributed_to_name.trim() : "";

    try {
      // 0. Direct-shifts path: Claude already extracted shifts from a file
      //    it can see in its multimodal context (attached image/PDF/voice
      //    transcript). Skip the parser entirely. This is the escape hatch
      //    for when extractSchedule's separate Sonnet call has trouble with
      //    a file that Claude itself reads fine.
      if (directShifts && directShifts.length > 0) {
        const validated: Array<{ date: string; start_time: string; end_time: string; label?: string }> = [];
        const dateRe = /^\d{4}-\d{2}-\d{2}$/;
        const timeRe = /^\d{2}:\d{2}$/;
        for (const raw of directShifts) {
          const date = typeof raw.date === "string" ? raw.date : "";
          const start = typeof raw.start_time === "string" ? raw.start_time : "";
          const end = typeof raw.end_time === "string" ? raw.end_time : "";
          const label = typeof raw.label === "string" ? raw.label : undefined;
          if (!dateRe.test(date) || !timeRe.test(start) || !timeRe.test(end)) {
            return {
              error: `Invalid shift format: date='${date}' start='${start}' end='${end}'. Each shift needs date='YYYY-MM-DD', start_time='HH:MM', end_time='HH:MM'. Fix the array and call again.`,
            };
          }
          validated.push({ date, start_time: start, end_time: end, ...(label ? { label } : {}) });
        }
        const fakeResult: ExtractScheduleResult = { shifts: validated };
        return await persistShifts(ctx, fakeResult, attributedToName, "direct");
      }

      // 1. Resolve media: explicit media_id (download from Telegram) wins,
      //    then current-turn cachedMedia, then text_content as a last resort.
      //    The explicit media_id path is what lets the bot recover the user's
      //    "I already sent it" reference — Claude reads the file_id from
      //    conversation history and passes it here.
      let resolvedMedia: { base64: string; mediaType: string } | undefined;
      let resolvedText: string | undefined;
      if (explicitMediaId) {
        try {
          const { buffer, mimeType: detectedMime } = await downloadMedia(explicitMediaId);
          const mime = explicitMimeType ?? detectedMime ?? "image/jpeg";
          const category = classifyMime(mime);
          if (category === "vision") {
            const mediaType = mapMimeType(mime);
            resolvedMedia = { base64: arrayBufferToBase64(buffer), mediaType };
          } else if (category === "text") {
            resolvedText = bufferToText(buffer);
          } else if (category === "spreadsheet") {
            resolvedText = spreadsheetToText(buffer);
          } else {
            return { error: `Unsupported file type: ${mime}. Ask the user to send as image, PDF, CSV, Excel, or plain text.` };
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("audio/") || (explicitMimeType && explicitMimeType.startsWith("audio/"))) {
            return {
              error: "This is a voice/audio file, not a schedule image. The voice note was already transcribed to text — read the transcription in the user's message and either extract shifts directly (pass them in the 'shifts' array) or pass the text via 'text_content'.",
            };
          }
          await emitSessionEvent(
            "no-session",
            "parse_schedule_media_download_failed",
            { chat_id: ctx.callerChatId, media_id: explicitMediaId, error: msg.slice(0, 200) },
          );
          return {
            error: `Couldn't download file_id=${explicitMediaId} from Telegram. The file may have expired (Telegram file_ids are session-scoped) or the id is wrong. Tell the user honestly that the previous file isn't fetchable any more and ask them to re-send it. Underlying: ${msg.slice(0, 200)}`,
          };
        }
      } else if (ctx.cachedMedia) {
        resolvedMedia = ctx.cachedMedia;
      }

      // Person-specific context feeds company-specific parse hints (e.g.
      // "brown cells = office, white = remote" for the caller, or fixed-
      // location notes like "Diego bartends at Hugo's so every shift is
      // on-site"). For self-uploads pull from users.context; for
      // attributed_to uploads pull from the target contact's person_notes.
      let personContext: string | null = null;
      if (attributedToName) {
        const note = ctx.snapshot.personNotes.find(
          (n) => n.name.toLowerCase() === attributedToName.toLowerCase(),
        );
        personContext = note?.notes ?? null;
      } else {
        personContext = ctx.snapshot.user.context ?? null;
      }

      let result: ExtractScheduleResult;
      const effectiveText = textContent || resolvedText;
      if (effectiveText) {
        result = await extractSchedule({
          text: effectiveText,
          userName: ctx.snapshot.user.name ?? undefined,
          timezone: ctx.snapshot.timezone,
          attributedToName: attributedToName || undefined,
          personContext,
        });
      } else if (resolvedMedia) {
        result = await extractSchedule({
          media: resolvedMedia,
          userName: ctx.snapshot.user.name ?? undefined,
          timezone: ctx.snapshot.timezone,
          attributedToName: attributedToName || undefined,
          personContext,
        });
      } else {
        return {
          error: "No media available and no text_content provided. Tell the user honestly that nothing was passed to the parser, ask them to either send the schedule or type their hours.",
        };
      }

      if (result.shifts.length === 0) {
        await emitSessionEvent(
          "no-session",
          "parse_schedule_zero_shifts",
          { chat_id: ctx.callerChatId, input_kind: textContent ? "text" : "media", attributed: attributedToName || null },
        );
        return {
          error: "Parser returned 0 shifts. The file may be unreadable, low-resolution, or not contain a schedule.",
        };
      }

      return await persistShifts(ctx, result, attributedToName, textContent ? "text" : "media");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Surface the underlying error to the dashboard so we can see WHY
      // extractSchedule keeps throwing on certain inputs (Sonnet schema
      // mismatch, JSON parse failure, API timeout, etc).
      await emitSessionEvent(
        "no-session",
        "parse_schedule_threw",
        { chat_id: ctx.callerChatId, error: msg.slice(0, 400) },
      );
      return { error: `parse_schedule threw: ${msg.slice(0, 300)}` };
    }
  },
};

/**
 * Per-date merge with overlap-driven augment semantics. Rationale:
 * rotas come in piecemeal (week 1 today, week 2 next week), users add
 * personal blocks on top of existing shifts ("gym Fri 6–7"), and
 * vacation declarations should sit alongside booked appointments. A
 * blanket per-date REPLACE silently wipes prior entries each time —
 * the bug behind multiple "the bot forgot my X" reports.
 *
 * Behaviour:
 *  - Dates NOT in `newShifts`: existing entries preserved verbatim.
 *  - Dates in `newShifts`: existing entries are kept UNLESS they
 *    overlap in time with any new entry on the same date (correction
 *    semantics — "actually my Wed shift is 12–20, not 09–17" replaces
 *    the overlapping prior entry).
 *  - OFF markers (00:00–00:00) treated as inert: they don't overlap
 *    with anything and don't get overlapped. Re-uploading a date as
 *    OFF de-dups any existing OFF on that date (no duplicate markers)
 *    but preserves all partial-busy entries (vacation Mon–Fri keeps
 *    Wed doctor 14–15 as "OFF + 14:00–15:00 (doctor)" in [STATE]).
 *  - All-day-busy (00:00–23:59) DOES overlap with everything on the
 *    date — uploading "Fri hectic all day" replaces a prior
 *    partial-busy on Fri. Correction semantics, deliberate.
 */
function mergeShiftsByDate<T extends { date: string; start_time: string; end_time: string }>(
  existingJson: string | null,
  newShifts: T[],
): T[] {
  // parseScheduleBlob returns null for both "no blob" and "corrupt blob".
  // Either way we want to treat as empty. Distinguish only for the warn
  // log so a corrupt save surfaces in telemetry instead of silently
  // becoming the new baseline.
  const parsed = parseScheduleBlob(existingJson);
  if (existingJson && !parsed) {
    console.warn("[persistShifts] existing schedule_json was unparseable — treating as empty");
  }
  const existing = (parsed ?? []) as unknown as T[];

  const newByDate = new Map<string, T[]>();
  for (const s of newShifts) {
    const list = newByDate.get(s.date);
    if (list) list.push(s);
    else newByDate.set(s.date, [s]);
  }

  const isOff = (s: { start_time: string; end_time: string }) =>
    s.start_time === "00:00" && s.end_time === "00:00";
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  // Half-open overlap (a.start < b.end && b.start < a.end). OFF is
  // inert — it never overlaps with anything (its time-tuple is a
  // marker, not a real busy window).
  const overlaps = (a: { start_time: string; end_time: string }, b: { start_time: string; end_time: string }) => {
    if (isOff(a) || isOff(b)) return false;
    return toMin(a.start_time) < toMin(b.end_time) && toMin(b.start_time) < toMin(a.end_time);
  };

  const kept: T[] = [];
  for (const e of existing) {
    const newOnDate = newByDate.get(e.date);
    if (!newOnDate) {
      kept.push(e); // date untouched by upload
      continue;
    }
    // De-dup: drop existing OFF when the new upload also brings an OFF
    // for that date (re-upload of a vacation declaration). Prevents
    // accumulating duplicate 00:00–00:00 markers across re-uploads.
    if (isOff(e) && newOnDate.some(isOff)) continue;
    // Drop existing entry only if its time window overlaps with a new
    // entry on the same date — that's the correction case. Otherwise
    // augment (new and existing coexist, e.g. work 09–17 + gym 18–19).
    if (newOnDate.some((n) => overlaps(e, n))) continue;
    kept.push(e);
  }
  return [...kept, ...newShifts];
}

/**
 * Save extracted shifts to the right target (person_note or self) and
 * sync the in-turn snapshot. Used by both the parser path and the
 * direct-shifts escape hatch.
 *
 * Merge behaviour: per-date replace, NOT total replace. See
 * mergeShiftsByDate above for the rationale.
 */
async function persistShifts(
  ctx: ToolContext,
  result: ExtractScheduleResult,
  attributedToName: string,
  source: "direct" | "text" | "media",
): Promise<ToolResult> {
  // Drop exact-duplicate (date, start, end, label) tuples WITHIN the new
  // parse first — the parser occasionally emits the same entry twice on
  // multi-page PDFs / overlapping recurring expansions. Then merge per-
  // date with whatever's already on file. The merge guarantees each date
  // is "owned" by the most recent upload, so re-uploading Wed updates
  // Wed without disturbing Mon/Tue.
  const seen = new Set<string>();
  const dedupedNew = result.shifts.filter((s) => {
    const key = `${s.date}|${s.start_time}|${s.end_time}|${s.label ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const droppedDuplicates = result.shifts.length - dedupedNew.length;
  if (droppedDuplicates > 0) {
    console.log(`[persistShifts] dropped ${droppedDuplicates} exact-duplicate entries from ${attributedToName || "self"}`);
  }

  // CAS-lite: re-read the latest blob from D1 right before the merge,
  // not from the snapshot loaded at turn start. Burst-grace narrows
  // but does NOT close the window where two parse_schedule calls (or
  // a parse + book_meetup busy-block append) could read the same
  // snapshot, both compute, both write — last writer would silently
  // lose the other's dates. The re-read shrinks the race to "between
  // this read and the upcoming write" which is single-digit ms in
  // practice. Full row-version CAS would close it entirely; this
  // captures most of the benefit without a schema change.
  const existingJson = attributedToName
    ? (await findPersonNote(ctx.callerChatId, attributedToName))?.schedule_json ?? null
    : await getLatestScheduleForUser(ctx.callerChatId);
  const merged = mergeShiftsByDate(existingJson, dedupedNew);
  const newDateCount = new Set(dedupedNew.map((s) => s.date)).size;
  const totalDateCount = new Set(merged.map((s) => s.date)).size;
  const keptDateCount = totalDateCount - newDateCount;
  console.log(
    `[persistShifts] merged for ${attributedToName || "self"}: ${dedupedNew.length} new shifts on ${newDateCount} dates, kept ${keptDateCount} pre-existing dates, total ${merged.length} shifts on ${totalDateCount} dates`,
  );
  const scheduleJson = JSON.stringify(merged);
  result = { shifts: merged };

  // On-behalf path → person_notes.schedule_json
  if (attributedToName) {
    await upsertPersonNote(ctx.callerChatId, attributedToName);
    await setPersonNoteSchedule(ctx.callerChatId, attributedToName, scheduleJson);
    const existing = ctx.snapshot.personNotes.find(
      (n) => n.name.toLowerCase() === attributedToName.toLowerCase(),
    );
    if (existing) {
      existing.schedule_json = scheduleJson;
    } else {
      ctx.snapshot.personNotes.push({
        id: 0,
        owner_chat_id: ctx.callerChatId,
        name: attributedToName,
        name_normalized: attributedToName.toLowerCase(),
        phone: null,
        linked_chat_id: null,
        schedule_json: scheduleJson,
        notes: null,
        hidden: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
    await emitSessionEvent("no-session", "parse_schedule_saved", {
      chat_id: ctx.callerChatId,
      source,
      target: `person_note:${attributedToName}`,
      shift_count: result.shifts.length,
      new_dates: newDateCount,
      kept_dates: keptDateCount,
    });
    return {
      saved: true,
      saved_to: `person_note:${attributedToName}`,
      shift_count: result.shifts.length,
      shifts: result.shifts,
    };
  }

  // Self path → users.latest_schedule_json (shared-hub model, migration 0018).
  // Schedule lives on the user row and follows them across any context.
  await updateUserLatestSchedule(ctx.callerChatId, scheduleJson);
  ctx.snapshot.user = { ...ctx.snapshot.user, latest_schedule_json: scheduleJson };
  await emitSessionEvent("no-session", "parse_schedule_saved", {
    chat_id: ctx.callerChatId,
    source,
    target: `user:${ctx.callerChatId}`,
    shift_count: result.shifts.length,
    new_dates: newDateCount,
    kept_dates: keptDateCount,
  });

  // Fire any outstanding watchers — callers who asked the bot to let them
  // know once this user uploaded. Best-effort: a failure to message one
  // watcher doesn't block the save or other watchers.
  const watchers = await listWatchesForTarget(ctx.callerChatId);
  const firedWatchers: string[] = [];
  const callerName = ctx.snapshot.user.name ?? "Your contact";
  for (const w of watchers) {
    try {
      await sendTextMessage(
        w.watcher_chat_id,
        `📬 Heads up — ${callerName} just uploaded their schedule. Want me to find a time that works for you both?`,
      );
      await deleteScheduleWatch(w.id);
      firedWatchers.push(w.watcher_chat_id);
    } catch (err) {
      console.warn(`[parse_schedule] watcher notify failed for ${w.watcher_chat_id}:`, err);
    }
  }

  return {
    saved: true,
    saved_to: `user:${ctx.callerChatId}`,
    shift_count: result.shifts.length,
    shifts: result.shifts,
    watchers_notified: firedWatchers.length,
  };
}

// --- Tool 3: add_or_invite_partner ---

const addOrInvitePartnerTool: ToolDefinition = {
  name: "add_contact",
  description:
    "Add someone to the caller's contact list. Canonical tool for 'I want to plan with X' / 'add Jojo' / 'here's Patrick, his number is 9968…'. Phone is OPTIONAL — most contacts don't use Telegram and that's fine. Outcomes: (1) name matches a bot user → link directly, caller sees their schedule. (2) phone given and matches a bot user → link directly + capture phone on their user row. (3) unknown name + no phone → create contact anyway (contact_created=true). You can save their schedule immediately. (4) unknown name + unknown phone → SILENTLY shadow-track (save person_note with name+phone, no link yet). The moment that phone ever joins the bot, the link resolves automatically. Don't offer invite links. Never gatekeep on phone — just create the contact and move on to saving their schedule.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      phone: { type: "string" },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    // Preserve the leading + so E.164 numbers ("+35699112233") still match
    // users.phone (stored in E.164). Strip spaces, dashes, parens, letters.
    const phone = typeof input.phone === "string" ? input.phone.replace(/[^0-9+]/g, "") : "";

    if (!name && !phone) {
      return { error: "Provide either name or phone." };
    }

    // Helper: link contact to a known bot user — creates/updates person_note
    // and the in-turn snapshot so subsequent tools see them. Returns the tool
    // result. No session writes anywhere.
    const linkContact = async (
      contactChatId: string,
      contactName: string | null,
      phoneToCapture: string | null,
    ): Promise<ToolResult> => {
      const displayName = (name || contactName || "").trim();
      if (!displayName) return { error: "No name available to label this contact." };
      await upsertPersonNote(
        ctx.callerChatId,
        displayName,
        phoneToCapture ? { phone: phoneToCapture } : {},
      );
      await linkPersonNoteToChat(ctx.callerChatId, displayName, contactChatId);
      // Sync the caller's in-turn snapshot so compute_overlap and the snapshot
      // formatter both see this contact immediately, with their latest schedule.
      const contactSchedule = await getLatestScheduleForUser(contactChatId);
      const existing = ctx.snapshot.personNotes.find(
        (n) => n.name_normalized === displayName.trim().toLowerCase(),
      );
      if (existing) {
        existing.linked_chat_id = contactChatId;
        if (phoneToCapture) existing.phone = phoneToCapture;
        if (contactSchedule && !existing.schedule_json) existing.schedule_json = contactSchedule;
      } else {
        ctx.snapshot.personNotes.push({
          id: 0,
          owner_chat_id: ctx.callerChatId,
          name: displayName,
          name_normalized: displayName.trim().toLowerCase(),
          phone: phoneToCapture,
          linked_chat_id: contactChatId,
          schedule_json: contactSchedule,
          notes: null,
          hidden: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
      return {
        linked: true,
        contact_name: displayName,
        contact_chat_id: contactChatId,
        schedule_present: !!contactSchedule,
      };
    };

    // Phone lookup takes priority when present.
    if (phone) {
      const existing = await findUserByPhone(phone);
      if (existing && existing.chat_id !== ctx.callerChatId) {
        if (!existing.phone) {
          const resolved = await updateUserPhone(existing.chat_id, phone);
          await notifyShadowLinkResolutions(resolved, existing.chat_id);
        }
        return await linkContact(existing.chat_id, existing.name ?? null, phone);
      }
      if (existing && existing.chat_id === ctx.callerChatId) {
        return { error: "That's the caller's own phone number — can't add themselves." };
      }
      // Phone didn't match. If a name was also given, try name lookup.
      if (name) {
        const byName = (await findUserByName(name)).filter((u) => u.chat_id !== ctx.callerChatId);
        if (byName.length === 1) {
          const u = byName[0];
          if (!u.phone) {
            const resolved = await updateUserPhone(u.chat_id, phone);
            await notifyShadowLinkResolutions(resolved, u.chat_id);
          }
          return await linkContact(u.chat_id, u.name ?? null, phone);
        }
        if (byName.length > 1) {
          return {
            ambiguous: true,
            candidates: byName.map((m) => ({
              name: m.name,
              phone_last_4: m.phone ? m.phone.slice(-4) : null,
            })),
            notes: "Multiple bot users match this name — the phone didn't match any of them. Ask the caller to clarify which one.",
          };
        }
      }
      // Unknown phone → shadow-track the contact silently. The moment that
      // phone ever joins the bot (via their own /start flow or a contact
      // share), updateUserPhone → linkShadowedPersonNotesByPhone resolves
      // the link without any further action here. No invite URL, no
      // pending_invite row — just a recorded name+phone. This matches the
      // product's shared-hub model: track everything, reveal on match.
      const labelName = name || `+${phone}`;
      await upsertPersonNote(ctx.callerChatId, labelName, { phone });
      // Sync caller's in-turn snapshot so the next tool sees this contact.
      const norm = labelName.trim().toLowerCase();
      const existingShadow = ctx.snapshot.personNotes.find((n) => n.name_normalized === norm);
      if (!existingShadow) {
        ctx.snapshot.personNotes.push({
          id: 0,
          owner_chat_id: ctx.callerChatId,
          name: labelName,
          name_normalized: norm,
          phone,
          linked_chat_id: null,
          schedule_json: null,
          notes: null,
          hidden: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
      return {
        shadow_tracked: true,
        contact_name: labelName,
        phone,
        notes: "Saved silently. They're not on the bot yet — the moment this number joins, the link fires automatically. Don't offer an invite link.",
      };
    }

    // Name-only lookup.
    // 1. Caller's own person_notes — already linked?
    const existingNote = await findPersonNote(ctx.callerChatId, name);
    if (existingNote?.linked_chat_id && existingNote.linked_chat_id !== ctx.callerChatId) {
      return {
        already_linked: true,
        contact_name: existingNote.name,
        contact_chat_id: existingNote.linked_chat_id,
      };
    }
    // 2. Global user lookup (substring LIKE, no fuzzy — ask for a phone if uncertain).
    const matches = (await findUserByName(name)).filter((u) => u.chat_id !== ctx.callerChatId);
    if (matches.length === 1) {
      return await linkContact(matches[0].chat_id, matches[0].name ?? null, null);
    }
    if (matches.length > 1) {
      return {
        ambiguous: true,
        candidates: matches.map((m) => ({
          name: m.name,
          phone_last_4: m.phone ? m.phone.slice(-4) : null,
        })),
        notes: "Multiple bot users match this name. Ask the caller to disambiguate by phone number.",
      };
    }
    // 3. Unknown name without phone — create the contact anyway. Phone is
    //    optional (only needed for Telegram auto-linking). Most contacts
    //    don't use Telegram — they still get schedules stored + appear in
    //    availability checks.
    await upsertPersonNote(ctx.callerChatId, name);
    const norm = name.trim().toLowerCase();
    if (!ctx.snapshot.personNotes.find((n) => n.name_normalized === norm)) {
      ctx.snapshot.personNotes.push({
        id: 0,
        owner_chat_id: ctx.callerChatId,
        name,
        name_normalized: norm,
        phone: null,
        linked_chat_id: null,
        schedule_json: null,
        notes: null,
        hidden: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
    return {
      contact_created: true,
      contact_name: name,
      notes: `Created ${name} as a contact. No phone on file — that's fine, phone is only needed if they join Telegram later. You can now save their schedule via parse_schedule with attributed_to_name="${name}".`,
    };
  },
};

// --- Tool 4: forget_contact (hard delete, vs set_person_hidden which is soft) ---

const removePartnerTool: ToolDefinition = {
  name: "forget_contact",
  description: "Permanently delete a contact from the caller's person list. Use when the caller explicitly wants to erase someone — 'forget X', 'delete X from my list', 'stop keeping track of X'. For 'I'm not interested in X for now' use set_person_hidden (reversible) instead. Owner-scoped: only deletes the caller's own person_note, not the other user's account.",
  input_schema: {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string", description: "Name of the contact to forget (matched against the caller's person_notes)." },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name) return { error: "Missing name argument." };
    const normalized = name.trim().toLowerCase();
    const result = await query(
      "DELETE FROM person_notes WHERE owner_chat_id = ? AND name_normalized = ?",
      [ctx.callerChatId, normalized],
    );
    const changes = result.meta?.changes ?? 0;
    if (changes === 0) return { not_found: true, name };
    ctx.snapshot.personNotes = ctx.snapshot.personNotes.filter(
      (n) => n.name_normalized !== normalized,
    );
    return { forgotten: true, name };
  },
};

// --- Tool 5: compute_overlap ---

const computeAndDeliverMatchTool: ToolDefinition = {
  name: "compute_overlap",
  description:
    "Find overlapping free time between the caller and their non-hidden contacts, using everyone's canonical schedule (users.latest_schedule_json for real bot users, person_notes.schedule_json for on-behalf). Returns ranked slots. If `deliver=true` and the caller has ≥1 linked contact, also sends a notification + calendar event to each linked contact. No sessions involved.",
  input_schema: {
    type: "object",
    properties: {
      deliver: {
        type: "boolean",
        description: "Optional. When true and there's a clear best slot, send a notification + calendar event to each linked contact. Default false (preview only).",
      },
      only_contacts: {
        type: "array",
        items: { type: "string" },
        description: "Optional. Limit overlap to these named contacts (case-insensitive). If omitted, uses all non-hidden contacts.",
      },
      force_mediated: {
        type: "boolean",
        description: "If true, return only the caller's own availability windows (single-person slots) — useful when the caller wants to offer their free times to someone who hasn't uploaded yet.",
      },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const deliver = input.deliver === true;
    const forceMediated = input.force_mediated === true;
    const onlyFilter = Array.isArray(input.only_contacts)
      ? (input.only_contacts as unknown[]).filter((v): v is string => typeof v === "string").map((s) => s.toLowerCase())
      : null;

    const callerSchedule = ctx.snapshot.user.latest_schedule_json;
    if (forceMediated) {
      if (!callerSchedule) {
        return { error: "Can't run mediated mode — caller hasn't uploaded their schedule yet." };
      }
      const slots = computeSinglePersonSlots(callerSchedule);
      return {
        status: slots.length > 0 ? "caller_only_slots" : "no_slots_from_single_schedule",
        all_slots: slots,
      };
    }

    // Build the schedule set: caller + non-hidden contacts with a schedule.
    const contacts = ctx.snapshot.personNotes.filter((n) => {
      if (n.hidden) return false;
      if (!n.schedule_json) return false;
      if (onlyFilter && !onlyFilter.includes(n.name.toLowerCase())) return false;
      return true;
    });

    const schedules: Array<{ id: string; schedule_json: string | null }> = [];
    if (callerSchedule) schedules.push({ id: `caller:${ctx.callerChatId}`, schedule_json: callerSchedule });
    for (const n of contacts) {
      schedules.push({ id: `contact:${n.linked_chat_id ?? `note${n.id}`}`, schedule_json: n.schedule_json });
    }

    // Augment with each participant's live Google Calendar events (if
    // connected). The bot's stored schedule is shift-level ("I work
    // 9–5"); calendar has real appointments ("dentist 3pm Thursday").
    // Merging both gives a truthful picture without requiring users to
    // re-type their meetings. Silent no-op for anyone not /connect'd.
    //
    // Anchor the window in the caller's tz (was UTC — drifted by a day
    // for users near midnight in non-UTC tz). And sanitise non-caller
    // calendar event labels so contacts' raw GCal titles don't reach
    // Claude unredacted.
    const overlapTz = resolveCallerTimezone(ctx);
    const windowStart = todayIsoInTimezone(overlapTz);
    const windowEnd = isoDateOffset(windowStart, 21);
    const calendarSources: Array<{ chat_id: string; id_prefix: string; isCaller: boolean }> = [
      { chat_id: ctx.callerChatId, id_prefix: "caller-cal", isCaller: true },
      ...contacts
        .filter((n) => !!n.linked_chat_id)
        .map((n) => ({ chat_id: n.linked_chat_id as string, id_prefix: `contact-cal:${n.linked_chat_id}`, isCaller: false })),
    ];
    // Parallelise — each source is one Google API round-trip (~200-400ms)
    // and N=10 contacts adds up serially. Promise.all caps wall-time at
    // the slowest source. Errors are caught per-source so one slow/broken
    // contact can't poison the whole compute.
    const calendarResults = await Promise.all(
      calendarSources.map(async (src) => {
        try {
          const events = await listCalendarEventsInWindow(src.chat_id, windowStart, windowEnd, overlapTz);
          return { src, events, ok: true as const };
        } catch (err) {
          console.warn(`[compute_overlap] calendar fetch failed for ${src.chat_id}:`, err);
          return { src, events: [], ok: false as const };
        }
      }),
    );
    for (const { src, events } of calendarResults) {
      if (events.length === 0) continue;
      const safeEvents = src.isCaller ? events : events.map(sanitiseContactCalendarEvent);
      schedules.push({ id: src.id_prefix, schedule_json: JSON.stringify(safeEvents) });
    }

    if (schedules.length < 2) {
      return {
        status: "need_more_schedules",
        caller_has_schedule: !!callerSchedule,
        contacts_with_schedule: contacts.length,
        missing_hint: callerSchedule
          ? "Caller's schedule is uploaded, but no eligible contact has a schedule. Ask the caller who they want to plan with, or tell them the contact needs to upload theirs."
          : "Caller hasn't uploaded their own schedule yet — ask for it first.",
      };
    }

    const slots: ComputedFreeSlot[] = computeOverlaps(schedules);
    if (slots.length === 0) {
      return { status: "no_overlap" };
    }

    // Delivery (optional): for each linked contact, send a notification and
    // create a calendar event for the top slot. Skip on-behalf-only notes
    // (no linked_chat_id = no Telegram chat to message).
    let deliveryResult: Awaited<ReturnType<typeof deliverMatchToContacts>> | null = null;
    if (deliver) {
      const top = slots[0];
      const linkedContactIds = contacts
        .map((n) => n.linked_chat_id)
        .filter((id): id is string => !!id);
      deliveryResult = await deliverMatchToContacts(
        ctx.callerChatId,
        linkedContactIds,
        top,
        ctx.snapshot.user.preferred_language ?? "en",
        ctx.snapshot.user.name ?? null,
        resolveCallerTimezone(ctx),
      );
    }

    // Build a compact per-person per-day schedule summary so Claude has
    // exact shift times RIGHT NEXT to the overlap result — prevents time
    // confabulation when reasoning about "when do I finish the day before?"
    const schedulesSummary: Record<string, Record<string, string>> = {};
    const callerName = ctx.snapshot.user.name ?? "Caller";
    // Build per-date summaries that preserve OFF + activity coexistence.
    // Group by date first; reconcile OFF/partials/all-day-busy in one pass
    // so an off day with a gym block reads as "OFF + 18:00–19:00 (gym)"
    // — not silently overwritten by either side.
    const addPersonSchedule = (name: string, json: string | null) => {
      if (!json) return;
      try {
        const shifts = JSON.parse(json) as Array<{ date: string; start_time: string; end_time: string; label?: string }>;
        const grouped = new Map<string, typeof shifts>();
        for (const s of shifts) {
          const list = grouped.get(s.date);
          if (list) list.push(s);
          else grouped.set(s.date, [s]);
        }
        const byDay: Record<string, string> = {};
        for (const [date, entries] of grouped) {
          const offs = entries.filter((s) => s.start_time === "00:00" && s.end_time === "00:00");
          const allDay = entries.find((s) => s.start_time === "00:00" && s.end_time === "23:59");
          const partials = entries.filter(
            (s) => !(s.start_time === "00:00" && s.end_time === "00:00")
              && !(s.start_time === "00:00" && s.end_time === "23:59"),
          );
          const renderPartial = (s: { start_time: string; end_time: string; label?: string }) =>
            `${s.start_time}–${s.end_time}${s.label ? ` (${s.label})` : ""}`;
          if (allDay) {
            byDay[date] = (allDay.label ?? "busy all day").toUpperCase();
          } else if (offs.length > 0 && partials.length > 0) {
            byDay[date] = `OFF + ${partials.map(renderPartial).join(", ")}`;
          } else if (offs.length > 0) {
            byDay[date] = "OFF";
          } else {
            byDay[date] = partials.map(renderPartial).join(", ");
          }
        }
        schedulesSummary[name] = byDay;
      } catch { /* skip malformed */ }
    };
    addPersonSchedule(callerName, callerSchedule);
    for (const n of contacts) {
      addPersonSchedule(n.name, n.schedule_json);
    }

    return {
      status: deliver ? "delivered" : "preview",
      match: slots[0],
      all_slots: slots,
      slot_count: slots.length,
      delivery: deliveryResult,
      schedules_summary: schedulesSummary,
    };
  },
};

/**
 * Lightweight delivery: for each contact we have a chat_id for, send a text
 * notification + create a calendar event keyed to the chosen slot. Best-
 * effort: a failure for one contact doesn't stop the rest. Calendar event
 * creation reuses the existing google-calendar helper.
 */
async function deliverMatchToContacts(
  callerChatId: string,
  contactChatIds: string[],
  slot: ComputedFreeSlot,
  callerLang: string,
  callerName: string | null,
  timezone: string,
): Promise<{
  delivered_to: string[];
  failures: string[];
  calendar_events_created: string[];
  calendar_failures: string[];
}> {
  const delivered: string[] = [];
  const failures: string[] = [];
  const calendarOk: string[] = [];
  const calendarFail: string[] = [];
  const whoLabel = callerName ?? `chat ${callerChatId.slice(-4)}`;
  const headline =
    callerLang === "it" ? `${whoLabel} ha trovato un orario: ${slot.day_name} ${slot.day} ${slot.start_time}–${slot.end_time}`
    : callerLang === "es" ? `${whoLabel} encontró un horario: ${slot.day_name} ${slot.day} ${slot.start_time}–${slot.end_time}`
    : callerLang === "fr" ? `${whoLabel} a trouvé un créneau : ${slot.day_name} ${slot.day} ${slot.start_time}–${slot.end_time}`
    : callerLang === "de" ? `${whoLabel} hat einen Termin gefunden: ${slot.day_name} ${slot.day} ${slot.start_time}–${slot.end_time}`
    : `${whoLabel} picked a time: ${slot.day_name} ${slot.day} ${slot.start_time}–${slot.end_time}`;

  // Recipients = all contacts + the caller themselves, so everyone lands a
  // calendar event for a chosen slot. Caller gets no Telegram ping (they're
  // already in the conversation that produced this).
  const summary = callerName ? `Meetup with ${callerName}` : "MeetSync meetup";
  for (const cid of contactChatIds) {
    try {
      await sendTextMessage(cid, `📅 ${headline}`);
      delivered.push(cid);
    } catch (err) {
      failures.push(cid);
      console.warn(`[deliver] telegram send failed to ${cid}:`, err);
    }
  }

  const everyoneForCalendar = [callerChatId, ...contactChatIds];
  for (const cid of everyoneForCalendar) {
    try {
      const r = await createCalendarEvent(
        cid,
        slot.day,
        slot.start_time,
        slot.end_time,
        summary,
        timezone,
      );
      if (r === true) calendarOk.push(cid);
      else calendarFail.push(cid);
    } catch (err) {
      calendarFail.push(cid);
      console.warn(`[deliver] calendar create failed for ${cid}:`, err);
    }
  }
  return {
    delivered_to: delivered,
    failures,
    calendar_events_created: calendarOk,
    calendar_failures: calendarFail,
  };
}

// --- Tool 6: upsert_knowledge ---

const upsertKnowledgeTool: ToolDefinition = {
  name: "upsert_knowledge",
  description:
    "Persist knowledge across turns. target='user' updates the CALLER's own profile (name, language, timezone, phone, a freeform fact). target='person' updates or creates a person_notes row for a named third party — use this ONLY to store facts/phone/notes about someone ALREADY known to the caller (e.g. 'Jojo's favorite café is X', 'Jojo's phone is +356...'). Do NOT use this tool to add someone to a meetup, invite them, or find a time — for 'add Jojo to plan with' / 'let's meet Jojo', use add_or_invite_partner instead.",
  input_schema: {
    type: "object",
    required: ["target"],
    properties: {
      target: { type: "string", enum: ["user", "person"] },
      person_name: { type: "string", description: "Required when target='person'." },
      name: { type: "string", description: "User's display name — used when target='user'." },
      language: { type: "string", description: "ISO 639-1 code (en, it, fr, de, es, ...)." },
      timezone: { type: "string", description: "IANA timezone (e.g. Europe/Rome)." },
      phone: { type: "string" },
      fact: {
        type: "string",
        description: "Freeform note to append. 300-char cap per call.",
      },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const target = input.target;
    if (target !== "user" && target !== "person") {
      return { error: "target must be 'user' or 'person'." };
    }
    const fact = typeof input.fact === "string" ? input.fact.trim() : "";
    const name = typeof input.name === "string" ? input.name.trim() : "";
    const language = typeof input.language === "string" ? input.language.trim().toLowerCase() : "";
    const timezone = typeof input.timezone === "string" ? input.timezone.trim() : "";
    const phone = typeof input.phone === "string" ? input.phone.trim() : "";

    if (target === "user") {
      const actions: string[] = [];
      if (name) {
        await updateUserName(ctx.callerChatId, name);
        ctx.snapshot.user = { ...ctx.snapshot.user, name };
        actions.push(`name=${name}`);
      }
      if (language) {
        await updateUserLanguage(ctx.callerChatId, language);
        ctx.snapshot.user = { ...ctx.snapshot.user, preferred_language: language };
        actions.push(`language=${language}`);
      }
      if (timezone) {
        await updateUserTimezone(ctx.callerChatId, timezone);
        ctx.snapshot.user = { ...ctx.snapshot.user, timezone };
        ctx.snapshot.timezone = timezone;
        actions.push(`timezone=${timezone}`);
      }
      if (phone) {
        const resolved = await updateUserPhone(ctx.callerChatId, phone);
        ctx.snapshot.user = { ...ctx.snapshot.user, phone };
        actions.push(`phone=${phone}`);
        // Fire shadow-link notifications — anyone who had this caller
        // shadow-tracked by phone now sees them linked in their contacts.
        await notifyShadowLinkResolutions(resolved, ctx.callerChatId);
      }
      if (fact) {
        await appendUserContext(ctx.callerChatId, fact);
        actions.push(`fact="${fact.slice(0, 80)}"`);
      }
      if (actions.length === 0) return { error: "No fields provided to upsert." };
      return { saved: true, target: "user", applied: actions };
    }

    // target === "person"
    const personName = typeof input.person_name === "string" ? input.person_name.trim() : "";
    if (!personName) return { error: "person_name required when target='person'." };
    await upsertPersonNote(ctx.callerChatId, personName, {
      phone: phone || undefined,
      notes: fact || undefined,
    });
    return { saved: true, target: "person", person_name: personName };
  },
};

// --- Tool 6c: add_personal_event ---
//
// Append-only persistence for one-off future occasions the caller
// mentions in chat ("doctor Wed 3pm", "dad's birthday Sat 7pm",
// "flight to Rome Friday 6am"). Without this tool, such mentions live
// only in conversation_log — pruned to 50 rows nightly — and the bot
// genuinely forgets them after a day or two. Routes through
// appendBusyBlockToUser so the entry lands in latest_schedule_json
// and auto-renders under that date in [STATE]; never replaces existing
// entries on the same date (vs parse_schedule, which is a per-date
// replace for shift-rota uploads).

const addPersonalEventTool: ToolDefinition = {
  name: "add_personal_event",
  description:
    "Persist a single one-off future personal occasion the caller mentions verbally ('doctor appt Wed 3pm', 'dad's 60th Sat 7pm', 'flying to Rome Fri 6am'). The event becomes a busy block on the caller's stored schedule — auto-renders under the date in [STATE], blocks overlap calculations, and SURVIVES the nightly conversation-log prune. Always APPEND-only: never wipes other entries on that date. **Also auto-mirrors to the caller's Google Calendar when /connect'd** (best-effort — result reports calendar_mirrored: 'created' | 'token_expired' | 'failed' | 'skipped_not_connected'). The Calendar mirror means even far-future events (beyond the [STATE] +60d window) are durably stored on the user's real calendar, and the user can verify the bot remembered. Use this whenever the caller mentions a specific dated future commitment that is NOT (a) a recurring shift rota or schedule upload (use parse_schedule for those — it's a per-date replace), (b) a meetup with named attendees you're booking (use book_meetup — it handles attendees + invites), or (c) a recurring lifestyle pattern like 'gym every Tuesday' (use parse_schedule with multiple dates, or upsert_knowledge for purely descriptive 'lives in Gozo' style facts). Single date, single occurrence.",
  input_schema: {
    type: "object",
    required: ["date", "start_time", "label"],
    properties: {
      date: { type: "string", description: "YYYY-MM-DD." },
      start_time: { type: "string", description: "HH:MM (24h). Pick the realistic start of the busy window — when the user actually becomes unavailable." },
      end_time: { type: "string", description: "OPTIONAL HH:MM (24h). Pass it when the caller stated or implied a length, or when you can judge the window better than the default: a 1-hour appointment is start..start+1h; a party is ~3h; a wedding-all-day is wide-partial like 09:00–22:00 (NOT 00:00–23:59 — that's reserved for shift-rota all-day-busy entries and would override OFF markers in [STATE]); a flight day is the morning block 06:00–12:00. OMIT it when the caller didn't say how long — the tool then assumes a sensible length from the label (dinner/drinks 2h, lunch 1.5h, party 3h, movie 2.5h, flight 6h, wedding 8h, anything else 1h) and returns end_time_assumed=true with the window it used. NEVER ask the caller how long the event will be — assume, save, and state the assumption in your confirmation so they can correct it. The user is BUSY during this window." },
      label: { type: "string", description: "Short human-readable description, STARTING with one fitting emoji where it makes sense, e.g. '🤝 interview at Solana', '🎉 dad's 60th', '✈️ flight to Rome', '💒 wedding'. Skip the emoji for anything private/sensitive (keep it plain so redaction works). Keep it under ~40 chars." },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const date = typeof input.date === "string" ? input.date.trim() : "";
    const startTime = typeof input.start_time === "string" ? input.start_time.trim() : "";
    const rawEndTime = typeof input.end_time === "string" ? input.end_time.trim() : "";
    const label = typeof input.label === "string" ? input.label.trim() : "";

    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    const timeRe = /^\d{2}:\d{2}$/;
    if (!dateRe.test(date)) return { error: `Invalid date '${date}'. Use YYYY-MM-DD.` };
    if (!timeRe.test(startTime)) return { error: `Invalid start_time '${startTime}'. Use HH:MM (24h).` };
    if (!label) return { error: "label is required — describe the occasion in a few words." };
    if (label.length > 80) return { error: "label too long — keep under 80 chars." };

    // No end_time means the caller never said how long it runs. Assume it from
    // the label rather than bouncing the question back at them.
    const endTimeAssumed = rawEndTime === "";
    const endTime = endTimeAssumed ? defaultEndTime(startTime, label) : rawEndTime;
    if (!timeRe.test(endTime)) return { error: `Invalid end_time '${endTime}'. Use HH:MM (24h), or omit it to have the length assumed.` };

    try {
      await appendBusyBlockToUser(ctx.callerChatId, date, startTime, endTime, label);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { error: `Failed to persist personal event: ${msg.slice(0, 200)}` };
    }

    // Refresh the in-memory snapshot so subsequent tool calls in the
    // same turn see the new entry. Mirrors what persistShifts does after
    // a parse_schedule write — without this, a follow-up compute_overlap
    // in the same turn could miss the just-added busy block.
    const fresh = await getLatestScheduleForUser(ctx.callerChatId);
    if (fresh != null) {
      ctx.snapshot.user = { ...ctx.snapshot.user, latest_schedule_json: fresh };
    }

    // Mirror the event to Google Calendar when connected, so:
    //   (a) far-future events (outside the today+60d snapshot window)
    //       are surfaced back via calendar enrichment in their date range,
    //   (b) the user trusts the bot's memory because they can SEE the
    //       event on Calendar — the user's stated source of truth,
    //   (c) the event survives even if D1's schedule_json is wiped.
    // Best-effort: failures don't block the D1 save — we just flag the
    // outcome in the tool result so Claude can mention it honestly.
    let calendarMirrored: "created" | "skipped_not_connected" | "token_expired" | "failed" = "skipped_not_connected";
    if (
      ctx.snapshot.callerCalendarConnected
      && !ctx.snapshot.callerCalendarTokenInvalid
      && !ctx.snapshot.callerCalendarRefreshFailing
    ) {
      try {
        const tz = resolveCallerTimezone(ctx);
        const r = await createCalendarEvent(ctx.callerChatId, date, startTime, endTime, label, tz);
        if (r === true) calendarMirrored = "created";
        else if (r === "token_expired") calendarMirrored = "token_expired";
        else calendarMirrored = "failed";
      } catch (err) {
        console.warn(`[add_personal_event] GCal mirror failed:`, err);
        calendarMirrored = "failed";
      }
    }

    // Sleep-window warnings — computed against the freshly persisted
    // schedule so we see this entry alongside any adjacent work shift.
    // add_personal_event does NOT block on warnings (the user is asserting
    // an external commitment, not asking the bot to pick), but the
    // warnings MUST be surfaced to the caller. Claude reads them from the
    // tool result and quotes them in its reply per the system prompt.
    const sleepWarnings = computeSleepWarnings(
      ctx.snapshot.user.latest_schedule_json,
      date,
      startTime,
      endTime,
    );

    return {
      saved: true,
      date,
      start_time: startTime,
      end_time: endTime,
      end_time_assumed: endTimeAssumed,
      ...(endTimeAssumed ? { assumed_duration_minutes: inferEventMinutes(label) } : {}),
      label,
      calendar_mirrored: calendarMirrored,
      sleep_warnings: sleepWarnings,
    };
  },
};

// --- Tool 6d: remove_schedule_entry ---
//
// Symmetric counterpart to add_personal_event + parse_schedule. The user
// can SAY "delete yoga on the 13th" and have the entry removed from the
// bot's stored schedule AND from Google Calendar in one shot. Before this,
// the only deletion path was cancel_meetup (booked meetups only) — random
// schedule entries (yoga, doctor, OFF markers, gym blocks) had no clean
// way out, which led to stale data accumulating in [STATE].

const removeScheduleEntryTool: ToolDefinition = {
  name: "remove_schedule_entry",
  description:
    "Delete entries from the caller's stored schedule (latest_schedule_json) AND/OR remove matching Google Calendar events. Handles both: (1) entries living in D1 (with or without a GCal mirror), (2) entries living ONLY on Google Calendar (events the caller created directly in their calendar, surfaced via [STATE]'s calendar enrichment — these have NO D1 row but the tool deletes them via the Calendar API). Use whenever the caller asks to drop, cancel, remove, undo, dedupe, or tidy up a scheduled item that is NOT a booked meetup with attendees (for those, use cancel_meetup — it handles attendee notifications). Examples: 'cancel my yoga Tuesday morning', 'I'm not going to the doctor Friday anymore', 'remove the gym block from Wed', 'remove the duplicate work entries on Sat 30', 'tidy up the Yin duplicates', 'clear all yoga sessions'. Match by date + start_time + end_time (and label_hint when needed). BEHAVIOUR with multiple D1 matches: (a) if every match is bit-for-bit identical (same date+start+end+label) the tool AUTO-DEDUPES — keeps one, drops the rest, returns mode='deduped'. (b) if matches DIFFER (different labels or times under the same date filter), returns error='ambiguous' with candidates[] for you to pick from. (c) Set delete_all_matching=true to drop EVERY entry matching the filter regardless — useful for 'remove all my yoga blocks for May' style bulk asks. If D1 has no match BUT the caller's Calendar has an event at that date+time, the tool falls back to Calendar-only delete (returns mode='calendar_only'). After delete, surface mode + removed_count + the GCal outcome (calendar_event_deleted: 'deleted' | 'not_found' | 'skipped_not_connected' | 'failed').",
  input_schema: {
    type: "object",
    required: ["date"],
    properties: {
      date: { type: "string", description: "YYYY-MM-DD of the entry to delete, in the caller's timezone." },
      start_time: { type: "string", description: "Optional HH:MM (24h). If given, narrows the match to entries with this exact start_time on the date. Omit to match by date alone (will return candidates[] if more than one and they differ)." },
      end_time: { type: "string", description: "Optional HH:MM (24h). If given, narrows further to this exact end_time. Use together with start_time when there are split shifts (e.g. two work blocks on the same day)." },
      label_hint: { type: "string", description: "Optional case-insensitive substring to disambiguate when multiple entries share the same time slot (rare). Example: 'gym' to pick the 18:00–19:00 gym block over a same-time block." },
      delete_all_matching: { type: "boolean", description: "When true, deletes EVERY entry matching the filter (date + optional start/end/label_hint) rather than picking one. Use for explicit bulk-delete asks ('remove all yoga from May', 'wipe my June exercise classes'). When false/omitted, identical duplicates are auto-deduped (keep one) and genuinely ambiguous matches return as candidates[]." },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const date = typeof input.date === "string" ? input.date.trim() : "";
    const startTime = typeof input.start_time === "string" ? input.start_time.trim() : "";
    const endTime = typeof input.end_time === "string" ? input.end_time.trim() : "";
    const labelHint = typeof input.label_hint === "string" ? input.label_hint.trim().toLowerCase() : "";

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: `Invalid date '${date}'. Use YYYY-MM-DD.` };
    if (startTime && !/^\d{2}:\d{2}$/.test(startTime)) return { error: `Invalid start_time '${startTime}'.` };
    if (endTime && !/^\d{2}:\d{2}$/.test(endTime)) return { error: `Invalid end_time '${endTime}'.` };

    const existingJson = await getLatestScheduleForUser(ctx.callerChatId);
    if (!existingJson) {
      return { error: "no_schedule", message: "Caller has no stored schedule — nothing to delete." };
    }
    const shifts = parseScheduleBlob(existingJson);
    if (!shifts) {
      return { error: "corrupt_schedule", message: "Caller's schedule_json is unparseable. Aborting delete." };
    }

    // Match candidates: same date, optionally same start/end, optionally
    // label_hint substring match. Keep ordering stable for transparency.
    const candidates = shifts
      .map((s, idx) => ({ shift: s, idx }))
      .filter(({ shift: s }) => s.date === date)
      .filter(({ shift: s }) => !startTime || s.start_time === startTime)
      .filter(({ shift: s }) => !endTime || s.end_time === endTime)
      .filter(({ shift: s }) => !labelHint || (s.label ?? "").toLowerCase().includes(labelHint));

    // CALENDAR-ONLY FALLBACK — when D1 has no match, the entry the caller
    // referenced may live ONLY on Google Calendar (e.g. surfaced via the
    // per-turn calendar enrichment, never persisted to schedule_json).
    // Search Calendar directly and offer to delete from there.
    if (candidates.length === 0) {
      if (
        ctx.snapshot.callerCalendarConnected
        && !ctx.snapshot.callerCalendarTokenInvalid
        && !ctx.snapshot.callerCalendarRefreshFailing
        && startTime
      ) {
        try {
          const tz = resolveCallerTimezone(ctx);
          const calendarHits = await findCalendarEventsOnDate(ctx.callerChatId, date, labelHint || "", tz);
          // Narrow by exact time match when provided.
          const exact = calendarHits.filter((e) => e.start_time === startTime && (!endTime || e.end_time === endTime));
          if (exact.length > 0) {
            // ALWAYS delete every exact-tuple match. Identical events at
            // the same date+start+end+title ARE duplicates by definition —
            // there's no semantic reason to keep N−1 copies when the user
            // asked to drop "the yoga at 18:30". Gating this behind
            // delete_all_matching=true was the bug: when the user asked
            // to "remove all yoga sessions" and GCal had 2 copies of each,
            // only the first copy of each was deleted and the rest came
            // back via [STATE] enrichment on the next turn.
            const deletedSummaries: string[] = [];
            let failures = 0;
            for (const ev of exact) {
              const r = await deleteCalendarEvent(ctx.callerChatId, ev.id, ev.calendar_id);
              if (r === true) deletedSummaries.push(ev.summary);
              else failures++;
            }
            return {
              removed: true,
              removed_count: deletedSummaries.length,
              mode: "calendar_only",
              calendar_event_deleted: deletedSummaries.length > 0 ? (failures === 0 ? "deleted" : "partial") : "failed",
              calendar_events_deleted_count: deletedSummaries.length,
              calendar_events_failed_count: failures,
              entry: {
                date,
                start_time: startTime,
                end_time: endTime || exact[0].end_time,
                label: deletedSummaries[0] ?? null,
              },
              failures,
              notes: `Entry was on Google Calendar only (not in the bot's D1 schedule). Deleted ${deletedSummaries.length} calendar event(s).${failures > 0 ? ` ${failures} failed.` : ""}${exact.length > 1 ? ` (Cleared ${exact.length} duplicate copies.)` : ""}`,
            };
          }
          // No exact-time match BUT calendarHits has non-exact-time entries
          // matching the labelHint. Honour delete_all_matching for that case.
          if (input.delete_all_matching === true && calendarHits.length > 0) {
            const deletedSummaries: string[] = [];
            let failures = 0;
            for (const ev of calendarHits) {
              const r = await deleteCalendarEvent(ctx.callerChatId, ev.id, ev.calendar_id);
              if (r === true) deletedSummaries.push(ev.summary);
              else failures++;
            }
            return {
              removed: true,
              removed_count: deletedSummaries.length,
              mode: "calendar_only_bulk_label",
              calendar_event_deleted: deletedSummaries.length > 0 ? (failures === 0 ? "deleted" : "partial") : "failed",
              calendar_events_deleted_count: deletedSummaries.length,
              calendar_events_failed_count: failures,
              entry: { date, start_time: startTime, end_time: endTime || "", label: deletedSummaries[0] ?? null },
              notes: `Calendar-only bulk delete by label_hint='${labelHint}'. Deleted ${deletedSummaries.length} event(s).${failures > 0 ? ` ${failures} failed.` : ""}`,
            };
          }
        } catch (err) {
          console.warn(`[remove_schedule_entry] calendar fallback failed:`, err);
        }
      }
      return {
        error: "not_found",
        message: `No matching entry on ${date}${startTime ? ` at ${startTime}` : ""}${endTime ? `–${endTime}` : ""}${labelHint ? ` matching '${labelHint}'` : ""}. Check the [STATE] block for the exact stored values and try again.`,
      };
    }

    const deleteAll = input.delete_all_matching === true;
    // Identical-duplicate detection: all candidates share the same
    // (start, end, label) tuple. This is the dedupe case — there's no
    // narrower filter that could disambiguate, so refusing as "ambiguous"
    // is a deadlock. Auto-keep the first, drop the rest.
    const allIdentical = candidates.length > 1 && candidates.every(({ shift: s }) => (
      s.start_time === candidates[0].shift.start_time
      && s.end_time === candidates[0].shift.end_time
      && (s.label ?? "") === (candidates[0].shift.label ?? "")
    ));

    if (candidates.length > 1 && !allIdentical && !deleteAll) {
      return {
        error: "ambiguous",
        candidates: candidates.map(({ shift: s }) => ({
          start_time: s.start_time,
          end_time: s.end_time,
          label: s.label ?? null,
        })),
        message: `Multiple DIFFERENT entries on ${date} matched. Show these to the caller and ask which one to delete, then call again with narrower start_time/end_time/label_hint — or set delete_all_matching=true to drop every one of them.`,
      };
    }

    // Build the list of indices to remove.
    //  - deleteAll: every candidate
    //  - allIdentical (dedupe): every candidate EXCEPT the first (keep one)
    //  - single candidate: that one
    const idxToRemove = new Set<number>(
      deleteAll
        ? candidates.map((c) => c.idx)
        : allIdentical
          ? candidates.slice(1).map((c) => c.idx)
          : [candidates[0].idx],
    );
    const removedShifts = candidates.filter((c) => idxToRemove.has(c.idx)).map((c) => c.shift);
    const target = removedShifts[0]; // representative for GCal lookup
    const remaining = shifts.filter((_, i) => !idxToRemove.has(i));
    await updateUserLatestSchedule(ctx.callerChatId, JSON.stringify(remaining));
    ctx.snapshot.user = { ...ctx.snapshot.user, latest_schedule_json: JSON.stringify(remaining) };

    // Best-effort: find and delete EVERY matching GCal event. Search by
    // label substring (the title we wrote when add_personal_event mirrored
    // to GCal), then narrow by matching start/end time. Identical-tuple
    // matches (same start+end+title) ARE duplicates by definition — delete
    // them all, not just the first. Picking only exactHits[0] was the
    // root cause of "I deleted yoga but it's still on my calendar" reports:
    // when the user had 2+ copies of the same GCal event, only one was
    // removed, the rest stayed and resurfaced in [STATE] via enrichment.
    let calendarOutcome: "deleted" | "not_found" | "skipped_not_connected" | "failed" | "partial" = "skipped_not_connected";
    let calendarEventsDeleted = 0;
    let calendarEventsFailed = 0;
    if (
      ctx.snapshot.callerCalendarConnected
      && !ctx.snapshot.callerCalendarTokenInvalid
      && !ctx.snapshot.callerCalendarRefreshFailing
    ) {
      try {
        const tz = resolveCallerTimezone(ctx);
        const titleHint = (target.label ?? "").trim();
        const calendarHits = await findCalendarEventsOnDate(ctx.callerChatId, date, titleHint, tz);
        // Narrow to events with matching start/end (HH:MM). Don't delete
        // a 10:00 event when the user asked to drop their 08:00 entry.
        const exactHits = calendarHits.filter(
          (e) => e.start_time === target.start_time && e.end_time === target.end_time,
        );
        // toDelete is now the FULL set of exact matches (covers duplicates),
        // OR the single non-exact hit when there's only one candidate and
        // no exact match (titleHint matched but times differ slightly).
        const toDelete = exactHits.length > 0
          ? exactHits
          : calendarHits.length === 1 ? calendarHits : [];
        if (toDelete.length === 0) {
          calendarOutcome = "not_found";
        } else {
          for (const ev of toDelete) {
            const r = await deleteCalendarEvent(ctx.callerChatId, ev.id, ev.calendar_id);
            if (r === true) calendarEventsDeleted++;
            else calendarEventsFailed++;
          }
          calendarOutcome = calendarEventsFailed === 0
            ? "deleted"
            : calendarEventsDeleted > 0 ? "partial" : "failed";
        }
      } catch (err) {
        console.warn(`[remove_schedule_entry] GCal cleanup failed:`, err);
        calendarOutcome = "failed";
      }
    }

    return {
      removed: true,
      removed_count: removedShifts.length,
      mode: deleteAll ? "delete_all_matching" : allIdentical ? "deduped" : "single",
      entry: {
        date: target.date,
        start_time: target.start_time,
        end_time: target.end_time,
        label: target.label ?? null,
      },
      calendar_event_deleted: calendarOutcome,
      calendar_events_deleted_count: calendarEventsDeleted,
      calendar_events_failed_count: calendarEventsFailed,
    };
  },
};

// --- Tool 6e: mirror_to_calendar ---
//
// Sync-gap closer. add_personal_event now mirrors to GCal on create, but
// entries that pre-date that change live ONLY on the bot. When the caller
// asks "ensure everything is synced to my calendar" or "the calendar is
// missing my mobility class on Sat 6 Jun — put it there", this tool
// creates a Google Calendar event from given coordinates WITHOUT touching
// D1. No-op when not /connect'd.

const mirrorToCalendarTool: ToolDefinition = {
  name: "mirror_to_calendar",
  description:
    "Create a Google Calendar event from given date+times+title WITHOUT writing to the bot's D1 schedule. Use this ONLY to close sync gaps — i.e. an entry already exists in the bot's schedule (visible in [STATE]) but is missing from Google Calendar, and the caller wants the two sides in sync. Do NOT use this for new commitments (use add_personal_event — that writes both sides). Do NOT use this for meetups with attendees (use book_meetup). Best-effort: returns calendar_event_created: true | 'token_expired' | 'skipped_not_connected' | 'failed'. When the caller asks 'ensure everything is synced' / 'push my gym/mobility/etc to calendar', look at each personal entry in [STATE] (non-work non-meetup busy blocks), check whether a same-time event already appears in the date's calendar enrichment, and call mirror_to_calendar for each missing one. Be conservative — never mirror work shifts (those are bot-side only by design).",
  input_schema: {
    type: "object",
    required: ["date", "start_time", "end_time", "title"],
    properties: {
      date: { type: "string", description: "YYYY-MM-DD in caller's timezone." },
      start_time: { type: "string", description: "HH:MM (24h)." },
      end_time: { type: "string", description: "HH:MM (24h)." },
      title: { type: "string", description: "Event title for Calendar (typically the same label as the D1 entry, e.g. 'Mobility', 'Yin', 'doctor')." },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const date = typeof input.date === "string" ? input.date.trim() : "";
    const startTime = typeof input.start_time === "string" ? input.start_time.trim() : "";
    const endTime = typeof input.end_time === "string" ? input.end_time.trim() : "";
    const title = typeof input.title === "string" ? input.title.trim().slice(0, 120) : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: `Invalid date '${date}'.` };
    if (!/^\d{2}:\d{2}$/.test(startTime)) return { error: `Invalid start_time '${startTime}'.` };
    if (!/^\d{2}:\d{2}$/.test(endTime)) return { error: `Invalid end_time '${endTime}'.` };
    if (!title) return { error: "title required." };

    if (
      !ctx.snapshot.callerCalendarConnected
      || ctx.snapshot.callerCalendarTokenInvalid
      || ctx.snapshot.callerCalendarRefreshFailing
    ) {
      return {
        calendar_event_created: "skipped_not_connected",
        message: "Caller's Google Calendar isn't connected (or token is invalid). Tell them honestly — nothing was written. They need to run /connect.",
      };
    }
    const tz = resolveCallerTimezone(ctx);
    // Guard against re-mirroring something already on the calendar — the
    // "it re-added my booking" report. If a same-title event already sits at
    // this start time on the date, the two sides are already in sync; do
    // nothing rather than create a duplicate. Best-effort: a failed pre-check
    // falls through to create so a transient read error never blocks a
    // genuine mirror.
    try {
      const existing = await findCalendarEventsOnDate(ctx.callerChatId, date, title, tz);
      // Match the full time window, not just the start, so a coincidental
      // same-title event at the same start but a different length doesn't
      // wrongly suppress a genuine mirror.
      if (existing.some((e) => e.start_time === startTime && e.end_time === endTime)) {
        return {
          calendar_event_created: "already_exists",
          message: `A '${title}' event already exists at ${startTime}–${endTime} on ${date} — calendar is already in sync, nothing created.`,
          event: { date, start_time: startTime, end_time: endTime, title },
        };
      }
    } catch (err) {
      console.warn(`[mirror_to_calendar] existence pre-check failed:`, err instanceof Error ? err.message : err);
    }
    try {
      const r = await createCalendarEvent(ctx.callerChatId, date, startTime, endTime, title, tz);
      if (r === true) {
        return { calendar_event_created: true, event: { date, start_time: startTime, end_time: endTime, title } };
      }
      if (r === "token_expired") return { calendar_event_created: "token_expired", message: "Token expired — caller must re-run /connect." };
      return { calendar_event_created: "failed", message: "Google rejected the create — try again or check the dashboard." };
    } catch (err) {
      console.warn(`[mirror_to_calendar] failed:`, err);
      return { calendar_event_created: "failed", message: `Calendar API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

// --- Tool 6b: set_person_hidden ---

const setPersonHiddenTool: ToolDefinition = {
  name: "set_person_hidden",
  description:
    "Hide or unhide a person from the caller's visible pool. Use when the user says things like 'not interested in Sofia anymore' / 'remove Sofia from my list' (hidden=true) or 'bring Sofia back' / 'I want Sofia again' (hidden=false). Hidden contacts are excluded from the snapshot's person list and from 'who's available' results. Data is preserved — nothing is deleted, and unhiding restores the person with their schedule/notes intact.",
  input_schema: {
    type: "object",
    required: ["person_name", "hidden"],
    properties: {
      person_name: { type: "string", description: "The name the user referred to (matched against the caller's person_notes, normalized)." },
      hidden: { type: "boolean", description: "true to hide, false to unhide." },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const personName = typeof input.person_name === "string" ? input.person_name.trim() : "";
    if (!personName) return { error: "person_name required." };
    if (typeof input.hidden !== "boolean") return { error: "hidden must be a boolean." };
    const ok = await setPersonNoteHidden(ctx.callerChatId, personName, input.hidden);
    if (!ok) {
      return {
        error: "not_found",
        message: `No contact named '${personName}' in your list. If you meant to add them, mention their name and I'll start tracking them.`,
      };
    }
    return {
      ok: true,
      person_name: personName,
      hidden: input.hidden,
      action: input.hidden ? "hidden" : "unhidden",
    };
  },
};

// --- Tool 7a: query_schedule_history ---
//
// The snapshot's [STATE] block only renders shifts inside an active window
// (today−14d → today+60d). Full schedule history lives in
// users.latest_schedule_json (or person_notes.schedule_json) forever — the
// per-date merge in persistShifts never prunes — but rendering every date
// each turn would balloon token cost as months pass. So out-of-window
// dates are reachable via this tool. Claude calls it when the user asks
// "what was my September look like" / "did I work last Christmas" /
// "what's penciled in for December".

const queryScheduleHistoryTool: ToolDefinition = {
  name: "query_schedule_history",
  description:
    "Look up shifts on dates OUTSIDE the active window shown in [STATE] (today−14d → today+60d). Use whenever the user asks about a specific past date older than two weeks ago, or a future date more than two months out, that is NOT in the inline shift list. Examples: 'was I working on 12 March?', 'what was my schedule in September?', 'do I have anything penciled for Christmas?'. Returns shifts in the date range, grouped by date. Reads the full stored schedule — nothing is ever deleted, so even years-old uploads come back. Don't fabricate; if the tool returns no rows for a date, tell the user honestly that nothing's on file for that date.",
  input_schema: {
    type: "object",
    required: ["start_date", "end_date"],
    properties: {
      start_date: {
        type: "string",
        description: "Inclusive start date in YYYY-MM-DD. Pick a sensible window around what the user asked — e.g. for 'September' use 2026-09-01. Don't query single-day windows just to check one date — a 3-7 day window is fine and gives you context.",
      },
      end_date: {
        type: "string",
        description: "Inclusive end date in YYYY-MM-DD. Must be >= start_date.",
      },
      contact_name: {
        type: "string",
        description: "Optional. The name of a contact (must already be in the caller's person_notes) whose history to query. Omit to query the caller's own history.",
      },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const start = typeof input.start_date === "string" ? input.start_date : "";
    const end = typeof input.end_date === "string" ? input.end_date : "";
    const contactName = typeof input.contact_name === "string" ? input.contact_name.trim() : "";
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRe.test(start) || !dateRe.test(end)) {
      return { error: "start_date and end_date must be YYYY-MM-DD." };
    }
    if (start > end) {
      return { error: `start_date (${start}) must be on or before end_date (${end}).` };
    }

    let scheduleJson: string | null;
    let target: string;
    if (contactName) {
      const note = ctx.snapshot.personNotes.find(
        (n) => n.name.toLowerCase() === contactName.toLowerCase(),
      );
      if (!note) {
        return {
          error: "contact_not_found",
          message: `No contact named '${contactName}' in your list.`,
        };
      }
      scheduleJson = note.schedule_json;
      target = `person_note:${contactName}`;
    } else {
      scheduleJson = ctx.snapshot.user.latest_schedule_json;
      target = `user:${ctx.callerChatId}`;
    }

    if (!scheduleJson) {
      return {
        target,
        range: { start, end },
        shifts: [],
        notes: "no schedule on file for this target",
      };
    }

    const parsedHistory = parseScheduleBlob(scheduleJson);
    if (!parsedHistory) {
      return { error: "schedule_json unparseable for target — corrupt blob in D1." };
    }
    const allShifts: ScheduleShift[] = parsedHistory;

    const inRange = allShifts
      .filter((s) => typeof s.date === "string" && s.date >= start && s.date <= end)
      .sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time));

    return {
      target,
      range: { start, end },
      shift_count: inRange.length,
      shifts: inRange,
    };
  },
};

// --- Tools 7b/7c: show_schedule / show_availability (deterministic display) ---
//
// The schedule the user sees used to be hand-typed by Claude into its reply
// — a ~30-line transcription that could silently drop a line (the reported
// "where's the cooking with fran" bug, where an OFF-day activity vanished
// from one render). These tools render the block in CODE (group-by-date,
// OFF+activity merge, work→💼, sensitive-label redaction) and deliver it
// verbatim, so an entry can never go missing in display. Both are terminal
// like reply.

// Telegram caps a message at 4096 chars; stay under to leave room for the
// ``` fences. Split only on whole lines so a date is never cut in half.
const SCHEDULE_MSG_CHAR_BUDGET = 3500;

function chunkLinesToCodeBlocks(lines: string[], budget: number): string[] {
  // Defensive: a single line longer than the budget can't fit in a message
  // on its own. Hard-split it (last resort) so a pathologically long line is
  // never silently dropped by Telegram's 4096-char limit — the whole point
  // of this path is "no entry goes missing".
  const safeLines: string[] = [];
  for (const line of lines) {
    if (line.length <= budget) {
      safeLines.push(line);
    } else {
      for (let i = 0; i < line.length; i += budget) safeLines.push(line.slice(i, i + budget));
    }
  }

  const messages: string[] = [];
  let current: string[] = [];
  let len = 0;
  const flush = () => {
    if (current.length > 0) {
      messages.push("```\n" + current.join("\n") + "\n```");
      current = [];
      len = 0;
    }
  };
  for (const line of safeLines) {
    const add = line.length + 1; // +1 for the joining newline
    if (current.length > 0 && len + add > budget) flush();
    current.push(line);
    len += add;
  }
  flush();
  return messages;
}

// How far forward to pull a person's OWN calendar events when rendering a
// display (show_schedule / show_availability). Stored shifts render to their
// last date with no cap, but externally-booked calendar events only need the
// near-term window — matches the [STATE] enrichment horizon.
const DISPLAY_CAL_WINDOW_DAYS = 60;

/**
 * Merge a person's genuinely-external Google Calendar events into their stored
 * schedule for the deterministic display renderers. Bot-mirrored events (and
 * any pre-marker duplicate of a stored entry) are stripped via
 * filterExternalCalendarEvents, so an externally-booked appointment shows up
 * on the schedule while the bot's own entries never double. Calendar surfacing
 * is an enhancement: on no-connection / read failure, the stored JSON is
 * returned unchanged. `sanitise` opaques a contact's titles (privacy boundary).
 */
async function mergeExternalCalendarForDisplay(
  chatId: string,
  scheduleJson: string | null,
  tz: string,
  sanitise: boolean,
): Promise<string | null> {
  try {
    const todayISO = todayIsoInTimezone(tz);
    const windowEnd = isoDateOffset(todayISO, DISPLAY_CAL_WINDOW_DAYS);
    const events = await listCalendarEventsInWindow(chatId, todayISO, windowEnd, tz);
    if (events.length === 0) return scheduleJson;
    const existing = parseScheduleBlob(scheduleJson) ?? [];
    let external = filterExternalCalendarEvents(events, existing);
    if (external.length === 0) return scheduleJson;
    if (sanitise) external = external.map(sanitiseContactCalendarEvent);
    return JSON.stringify([...existing, ...external]);
  } catch (err) {
    console.warn(
      `[display] calendar merge failed for chat=${chatId}:`,
      err instanceof Error ? err.message : err,
    );
    return scheduleJson;
  }
}

const showScheduleTool: ToolDefinition = {
  name: "show_schedule",
  description:
    "Display the CALLER'S OWN schedule to them, rendered deterministically by the system. Use for ANY request to see/show/display/list their schedule — 'schedule', 'show my schedule', 'what's my week', 'what have I got coming up', 'the full thing'. The block is built from storage (every entry from ~2 weeks ago through the last stored date — NOT truncated; work shown as 💼; sensitive items shown as '(appointment)') and sent to the user verbatim. You MUST NOT hand-type, summarise, or re-list the schedule yourself — that risks silently dropping an entry. TERMINAL tool like reply: once you call it your turn is done; do NOT also call reply with the schedule. Pass an optional one-line `intro` for a friendly lead-in ('Here's your full schedule 🙂') — keep schedule data OUT of it. For a specific past/far-future date, or a CONTACT'S schedule, use query_schedule_history and answer in prose instead.",
  input_schema: {
    type: "object",
    properties: {
      intro: {
        type: "string",
        description: "Optional one-line conversational lead-in, sent as its own bubble before the schedule. Keep it short; do NOT put any schedule data in it.",
      },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const tz = resolveCallerTimezone(ctx);
    // Start from the RAW canonical schedule in D1 (the bot's own entries),
    // then fold in the caller's genuinely-external Google Calendar events —
    // an appointment they booked elsewhere should appear here too. The
    // origin marker + tuple-dedupe (mergeExternalCalendarForDisplay) strips
    // the bot's own mirror, so entries never double the way they did when
    // this path naively read the calendar-enriched snapshot.
    const rawSchedule = await getLatestScheduleForUser(ctx.callerChatId);
    const scheduleJson = await mergeExternalCalendarForDisplay(ctx.callerChatId, rawSchedule, tz, false);
    const lines = renderScheduleForDisplay(scheduleJson, tz);
    const messages: string[] = [];
    const intro = typeof input.intro === "string" ? input.intro.trim() : "";
    if (intro) messages.push(intro);
    if (lines.length === 0) {
      messages.push("Your schedule's empty right now — send me your shifts or any plans and I'll save them. 🙂");
    } else {
      messages.push(...chunkLinesToCodeBlocks(lines, SCHEDULE_MSG_CHAR_BUDGET));
    }
    ctx.pendingReply = { messages };
    ctx.replySent = true;
    const dateCount = lines.filter((l) => !l.startsWith("──")).length;
    return {
      delivered: true,
      date_count: dateCount,
      notes: "Schedule rendered and sent to the user verbatim. Do NOT repeat or re-type it in another message — your turn is complete.",
    };
  },
};

const showAvailabilityTool: ToolDefinition = {
  name: "show_availability",
  description:
    "Display a WHO'S-FREE availability grid (caller + their non-hidden contacts) to the caller, rendered deterministically by the system. Use when the caller wants to SEE everyone's availability — 'who's free this week', 'show me everyone's schedule', 'when's everyone around'. The grid is built from each person's stored + calendar-enriched schedule (grouped by day; work as 💼; OTHER people's sensitive items abstracted) and sent verbatim — you MUST NOT hand-type or summarise the grid yourself. TERMINAL tool like reply. Pass an optional one-line `intro`. To FIND/PROPOSE a specific meeting slot (not just show the grid) use compute_overlap and answer in prose; to BOOK use book_meetup.",
  input_schema: {
    type: "object",
    properties: {
      intro: {
        type: "string",
        description: "Optional one-line lead-in bubble before the grid. No schedule data in it.",
      },
      only_contacts: {
        type: "array",
        items: { type: "string" },
        description: "Optional. Limit the grid to these named contacts (case-insensitive) plus the caller. Omit for all non-hidden contacts.",
      },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const tz = resolveCallerTimezone(ctx);
    const onlyFilter = Array.isArray(input.only_contacts)
      ? (input.only_contacts as unknown[]).filter((v): v is string => typeof v === "string").map((s) => s.toLowerCase())
      : null;

    // Canonical D1 schedules plus each person's genuinely-external calendar
    // events (bot mirrors + pre-marker duplicates stripped by
    // mergeExternalCalendarForDisplay). Contacts' event titles are opaqued.
    const rawCallerSchedule = await getLatestScheduleForUser(ctx.callerChatId);
    const callerSchedule = await mergeExternalCalendarForDisplay(ctx.callerChatId, rawCallerSchedule, tz, false);
    const people: Array<{ name: string; scheduleJson: string | null }> = [
      { name: ctx.snapshot.user.name ?? "You", scheduleJson: callerSchedule },
    ];
    const notes = await getPersonNotesForOwner(ctx.callerChatId); // excludes hidden
    // Resolve each contact's schedule in PARALLEL — each linked contact needs a
    // Google Calendar round-trip, so a sequential loop would stack N × up-to-5s.
    const resolved = await Promise.all(
      notes
        .filter((n) => !onlyFilter || onlyFilter.includes(n.name.toLowerCase()))
        .map(async (n) => {
          // Prefer the on-behalf schedule; else the linked user's canonical one.
          let sched = n.schedule_json;
          if (!sched && n.linked_chat_id) sched = await getLatestScheduleForUser(n.linked_chat_id);
          if (!sched) return null;
          // A linked contact has a real calendar we can read; fold in their
          // external events too (titles opaqued for the privacy boundary).
          if (n.linked_chat_id) {
            sched = await mergeExternalCalendarForDisplay(n.linked_chat_id, sched, tz, true);
          }
          return { name: n.name, scheduleJson: sched };
        }),
    );
    for (const p of resolved) {
      if (p) people.push(p);
    }

    const intro = typeof input.intro === "string" ? input.intro.trim() : "";
    if (people.length < 2) {
      ctx.pendingReply = {
        messages: [intro, "I don't have any contacts with a schedule saved yet — add someone and upload their schedule, then I can show everyone's availability together."].filter((m): m is string => !!m),
      };
      ctx.replySent = true;
      return { delivered: true, people: people.length, notes: "No contacts with schedules to compare — nudged the caller to add one." };
    }

    const lines = renderAvailabilityBlock(people, tz);
    const messages: string[] = [];
    if (intro) messages.push(intro);
    if (lines.length === 0) {
      messages.push("Nobody's got anything on file for the next few weeks.");
    } else {
      messages.push(...chunkLinesToCodeBlocks(lines, SCHEDULE_MSG_CHAR_BUDGET));
    }
    ctx.pendingReply = { messages };
    ctx.replySent = true;
    return {
      delivered: true,
      people: people.length,
      notes: "Availability grid rendered and sent to the user verbatim. Do NOT repeat or re-type it — your turn is complete.",
    };
  },
};

// --- Tool 7: reset_conversation ---

const sessionActionTool: ToolDefinition = {
  name: "reset_conversation",
  description:
    "Wipe the caller's recent conversation history with the bot so the next turn starts fresh. Use when the user says 'start over', 'fresh start', 'new session', 'forget what we were just talking about'. Does NOT delete contacts, schedules, or reminders — those are the user's data and survive. Only the recent-messages log for THIS caller is cleared. The previous system had a stricter 'session' concept; in the shared-hub model there's nothing else to reset.",
  input_schema: { type: "object", properties: {} },
  async execute(_input, ctx): Promise<ToolResult> {
    await query("DELETE FROM conversation_log WHERE chat_id = ?", [ctx.callerChatId]);
    ctx.snapshot.recentHistory = [];
    return {
      ok: true,
      notes: "Conversation history cleared. Tell the user clearly: chat history wiped, but ALL their data is safe — contacts, schedules, reminders, calendar connections, everything. Nothing lost except the message thread.",
    };
  },
};

// --- Tool 8: reply (terminal) ---

const replyTool: ToolDefinition = {
  name: "reply",
  description:
    "Send the user a reply. This is the terminal tool of your turn. Use text for a single message, messages[] for multiple messages in order, or buttons[] for one-tap yes/no replies (buttons attach to the last message).",
  input_schema: {
    type: "object",
    properties: {
      text: { type: "string", description: "A single reply message." },
      messages: {
        type: "array",
        items: { type: "string" },
        description: "Multiple messages to send in order. Use instead of `text` when you need more than one bubble.",
      },
      buttons: {
        type: "array",
        description: "Inline keyboard buttons to attach to the last message.",
        items: {
          type: "object",
          required: ["text", "callback"],
          properties: {
            text: { type: "string" },
            callback: { type: "string", enum: ["confirm", "reject", "yes", "no", "new_session"] },
          },
        },
      },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const messages: string[] = [];
    if (Array.isArray(input.messages)) {
      for (const m of input.messages) if (typeof m === "string" && m.trim()) messages.push(m);
    }
    if (typeof input.text === "string" && input.text.trim()) {
      messages.push(input.text);
    }
    if (messages.length === 0) {
      return { error: "reply requires non-empty text or messages." };
    }
    const buttons: ReplyButton[] | undefined = Array.isArray(input.buttons)
      ? (input.buttons.filter(
          (b): b is ReplyButton =>
            !!b &&
            typeof b === "object" &&
            typeof (b as ReplyButton).text === "string" &&
            ["confirm", "reject", "yes", "no", "new_session"].includes((b as ReplyButton).callback),
        ) as ReplyButton[])
      : undefined;
    ctx.pendingReply = { messages, buttons: buttons && buttons.length > 0 ? buttons : undefined };
    ctx.replySent = true;
    return { queued: true, message_count: messages.length };
  },
};

// --- Tool 8: schedule_reminder ---

const MAX_ACTIVE_REMINDERS_PER_USER = 20;

const scheduleReminderTool: ToolDefinition = {
  name: "schedule_reminder",
  description:
    "Schedule a reminder that the bot will send back to the user as a Telegram message at a chosen time. Use when the user says things like 'remind me tomorrow at 6am to call mum', 'ping me Friday 3pm', 'every Monday at 9am tell me to stretch'. Always parse their natural-language time into a local ISO timestamp in THEIR timezone (shown in [STATE]). The 'when_local' argument is a wall-clock time in the user's local timezone — NOT UTC. For recurring, pass recurrence='daily'|'weekly'|'monthly'.",
  input_schema: {
    type: "object",
    required: ["text", "when_local"],
    properties: {
      text: {
        type: "string",
        description: "What to remind the user about. Short, first-person-ish ('call mum', 'stretch', 'take meds'). Max 500 chars.",
      },
      when_local: {
        type: "string",
        description: "Wall-clock time in the user's timezone, ISO format 'YYYY-MM-DDTHH:MM' (e.g. '2026-04-15T06:00'). Must be in the future.",
      },
      recurrence: {
        type: "string",
        enum: ["daily", "weekly", "monthly"],
        description: "Optional. Omit for one-shot. 'daily'/'weekly'/'monthly' fires repeatedly, advancing by that interval each fire.",
      },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const text = typeof input.text === "string" ? input.text.trim().slice(0, 500) : "";
    if (!text) return { error: "text required." };
    const whenLocal = typeof input.when_local === "string" ? input.when_local.trim() : "";
    if (!whenLocal) return { error: "when_local required (ISO like '2026-04-15T06:00')." };
    const recurrence =
      input.recurrence === "daily" || input.recurrence === "weekly" || input.recurrence === "monthly"
        ? (input.recurrence as ReminderRecurrence)
        : null;

    const tz = resolveCallerTimezone(ctx);
    const fireAtEpoch = localIsoToUtcEpoch(whenLocal, tz);
    if (fireAtEpoch === null) {
      return { error: `Couldn't parse when_local='${whenLocal}'. Use 'YYYY-MM-DDTHH:MM'.` };
    }
    const nowEpoch = Math.floor(Date.now() / 1000);
    if (fireAtEpoch <= nowEpoch) {
      return { error: "when_local is in the past — please pick a future time." };
    }

    // Cap active reminders per user so a mischievous turn can't spam.
    const active = await listUserReminders(ctx.callerChatId, { limit: MAX_ACTIVE_REMINDERS_PER_USER + 1 });
    if (active.length >= MAX_ACTIVE_REMINDERS_PER_USER) {
      return {
        error: "reminder_cap",
        message: `You already have ${MAX_ACTIVE_REMINDERS_PER_USER} active reminders — cancel one first.`,
      };
    }

    const id = await createReminder(ctx.callerChatId, text, fireAtEpoch, tz, recurrence);
    return {
      ok: true,
      reminder_id: id,
      text,
      fires_at_local: whenLocal,
      fires_at_epoch: fireAtEpoch,
      timezone: tz,
      recurrence,
    };
  },
};

// --- Tool 9: list_reminders ---

const listRemindersTool: ToolDefinition = {
  name: "list_reminders",
  description:
    "List the caller's active (PENDING) reminders, soonest-first. Use when the user asks things like 'what reminders do I have?' / 'show my reminders'. Returns id, text, fire_at_local, recurrence for each.",
  input_schema: { type: "object", properties: {} },
  async execute(_input, ctx): Promise<ToolResult> {
    const rows = await listUserReminders(ctx.callerChatId);
    const tz = resolveCallerTimezone(ctx);
    const items = rows.map((r) => {
      // Format fire_at as local wall-clock for display.
      const localStr = new Intl.DateTimeFormat("en-GB", {
        timeZone: r.timezone || tz,
        weekday: "short",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(r.fire_at * 1000));
      return {
        id: r.id,
        text: r.text,
        fires_at_local: localStr,
        fires_at_epoch: r.fire_at,
        recurrence: r.recurrence,
      };
    });
    return { ok: true, count: items.length, reminders: items };
  },
};

// --- Tool 10: cancel_reminder ---

const cancelReminderTool: ToolDefinition = {
  name: "cancel_reminder",
  description:
    "Cancel an active reminder by id. Use when the user says 'cancel that reminder' / 'don't remind me about X anymore'. Pass the reminder_id from list_reminders. Cancellation is owner-scoped — you can't cancel someone else's reminders.",
  input_schema: {
    type: "object",
    required: ["reminder_id"],
    properties: {
      reminder_id: { type: "string", description: "UUID returned from list_reminders." },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const id = typeof input.reminder_id === "string" ? input.reminder_id.trim() : "";
    if (!id) return { error: "reminder_id required." };
    const ok = await cancelReminder(ctx.callerChatId, id);
    if (!ok) return { error: "not_found", message: "No active reminder with that id." };
    return { ok: true, reminder_id: id, status: "CANCELLED" };
  },
};

// --- Tool 12: relay_message ---

const RELAY_MAX_TEXT_LEN = 500;

const relayMessageTool: ToolDefinition = {
  name: "relay_message",
  description:
    "Send a message on the caller's behalf to someone they've already added (a person_note whose linked_chat_id is set). Use when the caller explicitly asks to pass something on: 'tell Kurt I want to meet Saturday', 'remind Joejoe to send his schedule', 'let Sofia know I'm running late'. You GHOSTWRITE the message in the bot's natural voice, naming the caller inside the body where it helps — e.g. 'Hey Kurt 👋 Riccardo asked me to nudge you — could you share your schedule this week?'. Do NOT quote the caller literally, do NOT use stiff attribution like 'Riccardo says: …'. Match your usual warm, direct style. CRITICAL confirmation gate: always draft the exact text back to the caller FIRST (via reply with yes/no buttons, or by asking 'send this to Kurt? [draft]') — only call this tool AFTER the caller explicitly confirms. Never call on an implied/ambiguous request. Never send without showing the draft. IMPORTANT: draft the message in the RECIPIENT's preferred_language, not the caller's — the recipient will read it; the caller is only approving it. Show the caller the draft in their own language for approval but send the recipient-language version. If you can't see the recipient's language in [STATE], default to the caller's.",
  input_schema: {
    type: "object",
    required: ["to_person_name", "text"],
    properties: {
      to_person_name: {
        type: "string",
        description: "Name of the person to send to. Must resolve to a person_note with linked_chat_id set (they have to be a real bot user the caller has added).",
      },
      text: {
        type: "string",
        description: `The message body — your ghostwritten draft in the bot's voice, already confirmed by the caller. Sent verbatim. Max ${RELAY_MAX_TEXT_LEN} chars.`,
      },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const toName = typeof input.to_person_name === "string" ? input.to_person_name.trim() : "";
    const text = typeof input.text === "string" ? input.text.trim().slice(0, RELAY_MAX_TEXT_LEN) : "";
    if (!toName) return { error: "to_person_name required." };
    if (!text) return { error: "text required." };

    const note = await findPersonNote(ctx.callerChatId, toName);
    if (!note) {
      return {
        error: "not_found",
        message: `No contact named '${toName}' in the caller's list. Add them first (name + phone) before relaying.`,
      };
    }
    if (!note.linked_chat_id) {
      return {
        error: "not_joined",
        message: `${toName} hasn't joined the bot yet — can't message them until they do.`,
      };
    }
    if (note.linked_chat_id === ctx.callerChatId) {
      return { error: "self_target", message: "Can't send a message to yourself." };
    }

    // Sent verbatim — Claude is responsible for drafting in the bot's voice.
    try {
      await sendTextMessage(note.linked_chat_id, text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { error: "send_failed", message: `Telegram rejected the send: ${msg}` };
    }

    return { ok: true, sent_to: note.name, to_chat_id: note.linked_chat_id, chars: text.length };
  },
};

// --- Tool 13: watch_schedule_upload ---

const watchScheduleUploadTool: ToolDefinition = {
  name: "watch_schedule_upload",
  description:
    "Register a one-shot follow-through: the NEXT time the named contact uploads a schedule, the bot pings the caller automatically. Use this whenever you promise to 'let them know' or 'ping them once X uploads' — otherwise the promise is empty. The contact must already be in the caller's person_notes with linked_chat_id (i.e. a real bot user). Safe to call repeatedly for the same (caller, contact) pair — idempotent.",
  input_schema: {
    type: "object",
    required: ["person_name"],
    properties: {
      person_name: {
        type: "string",
        description: "Name of the contact whose schedule-upload you want to be notified about.",
      },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const name = typeof input.person_name === "string" ? input.person_name.trim() : "";
    if (!name) return { error: "person_name required." };
    const note = await findPersonNote(ctx.callerChatId, name);
    if (!note) return { error: "not_found", message: `No contact named '${name}'.` };
    if (!note.linked_chat_id) {
      return {
        error: "not_joined",
        message: `${name} isn't a bot user yet — can't watch for an upload that can't happen.`,
      };
    }
    await createScheduleWatch(ctx.callerChatId, note.linked_chat_id);
    return { ok: true, watching: note.name, watching_chat_id: note.linked_chat_id };
  },
};

// --- Tool 14: book_meetup ---

const bookMeetupTool: ToolDefinition = {
  name: "book_meetup",
  description:
    "Commit a meetup to Google Calendar for the caller and each named attendee. CANONICAL 'lock in' action — a real calendar event on every /connect'd participant's primary calendar, plus a busy block appended to each person's in-bot schedule so future 'who's free' queries treat the slot as taken. Single-day event only: one date, one start time, one end time — and end_time is OPTIONAL, so never hold up a booking to ask the caller how long it'll run (omit it and the tool assumes a sensible length from the title). For recurring, tell the caller to duplicate from Google Calendar's UI — no recurrence here. Anyone without Google Calendar connected is listed in skipped_not_connected; the caller's OWN event is still created unconditionally (booking on the caller's calendar never requires the contact's consent or connection). After booking, reply with ONE line ('booked — it's on your calendar') and stop. When the caller defers ('just pick', 'just book it', 'you choose'), you are authorised to choose concrete values (date, start_time, end_time, title) yourself and book immediately — do not re-ask for specifics after a defer.",
  input_schema: {
    type: "object",
    required: ["date", "start_time", "title"],
    properties: {
      date: { type: "string", description: "YYYY-MM-DD, in the caller's timezone." },
      start_time: { type: "string", description: "HH:MM (24h), local to the caller's timezone." },
      end_time: { type: "string", description: "OPTIONAL HH:MM (24h), local to the caller's timezone. Pass it when the caller stated or implied a length, or when you can judge it better. OMIT it when they didn't say how long — the tool assumes a sensible length from the title (dinner/drinks 2h, lunch 1.5h, party 3h, movie 2.5h, anything else 1h) and returns end_time_assumed=true with the window it used. NEVER ask the caller how long the meetup will be — assume it, book it, and mention the window in your one-line confirmation." },
      title: { type: "string", description: "Short event title, e.g. 'Cat walk with Kurt', 'Dinner with Sofia'." },
      attendee_names: {
        type: "array",
        items: { type: "string" },
        description: "Names of the caller's contacts (must be in their person_notes with linked_chat_id) to also book on their calendars. Omit to book only for the caller.",
      },
      override_conflicts: {
        type: "boolean",
        description: "When false/omitted, the tool refuses to book if any participant is busy at the requested time, returning conflicts[]. When true, books anyway. Only set true if the caller has explicitly acknowledged the conflict and asked to proceed.",
      },
      override_sleep_warning: {
        type: "boolean",
        description: "When false/omitted, the tool refuses to book if the proposed slot leaves <9h between the caller's adjacent work shift and the event (8h sleep + 1h commute). Returns sleep_warnings[]. When true, books anyway. Set true only after surfacing the sleep_warnings verbatim to the caller and getting their explicit yes.",
      },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const date = typeof input.date === "string" ? input.date.trim() : "";
    const startTime = typeof input.start_time === "string" ? input.start_time.trim() : "";
    const rawEndTime = typeof input.end_time === "string" ? input.end_time.trim() : "";
    const title = typeof input.title === "string" ? input.title.trim().slice(0, 120) : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "date must be YYYY-MM-DD." };
    if (!/^\d{2}:\d{2}$/.test(startTime)) return { error: "start_time must be HH:MM." };
    if (!title) return { error: "title required." };

    // Same rule as add_personal_event: an omitted end_time is assumed from the
    // title, never asked back. Length assumptions are cheap to correct; an
    // extra round-trip on every booking is not.
    const endTimeAssumed = rawEndTime === "";
    const endTime = endTimeAssumed ? defaultEndTime(startTime, title) : rawEndTime;
    if (!/^\d{2}:\d{2}$/.test(endTime)) return { error: "end_time must be HH:MM, or omit it to have the length assumed." };

    const tz = resolveCallerTimezone(ctx);
    const attendeeNames = Array.isArray(input.attendee_names)
      ? (input.attendee_names as unknown[]).filter((v): v is string => typeof v === "string")
      : [];

    // Resolve attendee chat_ids from person_notes
    const attendeeTargets: Array<{ name: string; chat_id: string }> = [];
    const unknownAttendees: string[] = [];
    for (const n of attendeeNames) {
      const note = await findPersonNote(ctx.callerChatId, n);
      if (note?.linked_chat_id) attendeeTargets.push({ name: note.name, chat_id: note.linked_chat_id });
      else unknownAttendees.push(n);
    }

    // Conflict check BEFORE writing anything: for each participant, union
    // their stored schedule + their live Google Calendar events, and see
    // if the requested slot overlaps any busy block. If anyone's busy,
    // bail out with conflicts so Claude can either suggest a different
    // time or re-ask the user with the override flag.
    const conflictTargets = [
      { name: ctx.snapshot.user.name ?? "you", chat_id: ctx.callerChatId },
      ...attendeeTargets,
    ];
    const conflicts: Array<{ name: string; reason: string }> = [];
    const reqStart = timeToMinutes(startTime);
    const reqEnd = timeToMinutes(endTime);
    for (const t of conflictTargets) {
      // Sanitise calendar labels for non-caller targets so a conflict
      // reason like "busy calendar: Therapy with Dr X (15:00–16:00)"
      // never makes it into the caller-facing reply. Caller's own
      // events stay as full labels.
      const sanitiseCal = t.chat_id !== ctx.callerChatId;
      const busy = await gatherBusyBlocksForDate(t.chat_id, date, tz, sanitiseCal);
      const hit = busy.find((b) => reqStart < b.end && reqEnd > b.start);
      if (hit) {
        conflicts.push({
          name: t.name,
          reason: `busy ${hit.label} (${minutesToTime(hit.start)}–${minutesToTime(hit.end)})`,
        });
      }
    }
    const override = input.override_conflicts === true;
    if (conflicts.length > 0 && !override) {
      return {
        error: "conflict",
        conflicts,
        message: `At least one participant is busy at ${date} ${startTime}–${endTime}. Either pick a different time, or call book_meetup again with override_conflicts=true if the caller explicitly wants to book over the conflict.`,
      };
    }

    // Sleep + commute buffer check for the CALLER only — we don't impose
    // the caller's sleep buffer on attendees (their notes drive their own
    // logistics, per the system prompt). Hard-block by default so the
    // user can't accidentally end up with a 5h-sleep morning slot; allow
    // override after explicit acknowledgement.
    const sleepWarnings = computeSleepWarnings(
      ctx.snapshot.user.latest_schedule_json,
      date,
      startTime,
      endTime,
    );
    const sleepOverride = input.override_sleep_warning === true;
    if (sleepWarnings.length > 0 && !sleepOverride) {
      return {
        error: "sleep_window_violation",
        sleep_warnings: sleepWarnings,
        message: `This slot breaks the caller's 8h-sleep + 1h-commute buffer around work. Surface the sleep_warnings to the caller verbatim, ask explicitly whether to book anyway, and re-call with override_sleep_warning=true only if they say yes. Don't silently re-attempt.`,
      };
    }

    // Book for caller + each attendee
    const booked: string[] = [];
    const skippedNotConnected: string[] = [];
    const failed: string[] = [];
    // Partial failures that don't block the "booked" confirmation but DO
    // need to surface to the user — so Claude can mention them honestly
    // instead of the bot saying "booked!" when half the side-effects
    // silently failed (bus block write, attendee notify, etc.).
    const partialFailures: string[] = [];
    const allTargets = [
      { name: ctx.snapshot.user.name ?? "you", chat_id: ctx.callerChatId },
      ...attendeeTargets,
    ];
    const busyLabel = `meetup: ${title}`;

    // Gather emails for attendees who have them (captured on OAuth). These
    // go as attendees on the single shared event created on the caller's
    // calendar — Google auto-invites them, so they get the event on their
    // own calendar with proper RSVP/edit/delete semantics.
    // Batch the per-attendee email lookup into ONE D1 round-trip instead
    // of N sequential getUser() calls. The same emailByChatId map is
    // reused below for the "mark booked" step, halving D1 RTTs again.
    const emailByChatId = new Map<string, string | null>();
    if (attendeeTargets.length > 0) {
      const placeholders = attendeeTargets.map(() => "?").join(", ");
      const rows = await query<{ chat_id: string; email: string | null }>(
        `SELECT chat_id, email FROM users WHERE chat_id IN (${placeholders})`,
        attendeeTargets.map((t) => t.chat_id),
      );
      for (const r of rows.results) emailByChatId.set(r.chat_id, r.email);
    }
    const attendeeEmails: string[] = [];
    const attendeesWithoutEmail: Array<{ name: string; chat_id: string }> = [];
    for (const t of attendeeTargets) {
      const email = emailByChatId.get(t.chat_id) ?? null;
      if (email) attendeeEmails.push(email);
      else attendeesWithoutEmail.push(t);
    }

    // Create ONE event on the caller's calendar with all email-attendees.
    // If THIS write fails (token expired, env missing, network), short-circuit
    // with an honest error — historically the tool returned ok:true with an
    // empty booked[], and Claude misread it as "booked!" and lied to the user.
    // We also skip the bot-side busy-memory write below so the stored
    // schedule doesn't show phantom events that don't exist on the calendar.
    try {
      const r = await createCalendarEvent(ctx.callerChatId, date, startTime, endTime, title, tz, attendeeEmails);
      if (r === true) {
        booked.push(ctx.snapshot.user.name ?? "you");
        // Mark email-attendees as booked too — Google sent them the invite.
        // Reuse the batched emailByChatId map; no extra D1 round-trips.
        for (const t of attendeeTargets) {
          if (emailByChatId.get(t.chat_id)) booked.push(t.name);
        }
      } else if (r === "token_expired") {
        return {
          error: "calendar_token_expired",
          message: "The caller's Google Calendar token is expired or revoked. Tell them their /connect needs to be re-run, and do NOT claim the meetup is booked. Nothing was written.",
        };
      } else {
        return {
          error: "calendar_unavailable",
          message: "Couldn't write the event to the caller's Google Calendar (refresh failed — check Trigger.dev env vars or the prior console.warn for detail). Tell the caller honestly that booking did not go through; do NOT say 'booked'. Nothing was written.",
        };
      }
    } catch (err) {
      console.warn(`[book_meetup] shared event failed:`, err);
      return {
        error: "calendar_write_failed",
        message: `Calendar API threw an error (${err instanceof Error ? err.message : String(err)}). Tell the caller honestly that booking did not go through. Nothing was written.`,
      };
    }

    // For attendees WITHOUT email (not OAuth-connected), fall back to
    // creating a parallel event on their own calendar if they're connected
    // that way (unlikely — no email means no /connect), otherwise they
    // just get a Telegram ping and a memory-schedule update.
    for (const t of attendeesWithoutEmail) {
      try {
        const r = await createCalendarEvent(t.chat_id, date, startTime, endTime, title, tz);
        if (r === true) booked.push(t.name);
        else skippedNotConnected.push(t.name);
      } catch (err) {
        failed.push(t.name);
        partialFailures.push(`couldn't create calendar event for ${t.name}`);
        console.warn(`[book_meetup] fallback event failed for ${t.chat_id}:`, err);
      }
    }

    // Write busy block into EVERYONE's schedule memory, connected or not.
    for (const t of allTargets) {
      try {
        await appendBusyBlockToUser(t.chat_id, date, startTime, endTime, busyLabel);
        if (t.chat_id === ctx.callerChatId) {
          const updated = await getLatestScheduleForUser(ctx.callerChatId);
          if (updated) ctx.snapshot.user = { ...ctx.snapshot.user, latest_schedule_json: updated };
        }
      } catch (err) {
        partialFailures.push(`couldn't update bot-side busy memory for ${t.name} (future conflict-checks may miss this slot)`);
        console.warn(`[book_meetup] memory-schedule append failed for ${t.chat_id}:`, err);
      }
    }

    // Ping attendees (who got booked) with a short confirmation
    const callerName = ctx.snapshot.user.name ?? "your contact";
    for (const t of attendeeTargets) {
      if (!booked.includes(t.name)) continue;
      try {
        await sendTextMessage(
          t.chat_id,
          `📅 ${callerName} just booked "${title}" for ${date} ${startTime}–${endTime} — it's on your Google Calendar.`,
        );
      } catch (err) {
        partialFailures.push(`couldn't notify ${t.name} on Telegram — may want to nudge them directly`);
        console.warn(`[book_meetup] attendee notify failed for ${t.chat_id}:`, err);
      }
    }

    return {
      ok: true,
      booked,
      skipped_not_connected: skippedNotConnected,
      failed,
      unknown_attendees: unknownAttendees,
      partial_failures: partialFailures,
      event: { date, start_time: startTime, end_time: endTime, title },
      end_time_assumed: endTimeAssumed,
      ...(endTimeAssumed ? { assumed_duration_minutes: inferEventMinutes(title) } : {}),
    };
  },
};

// --- Tool 15: cancel_meetup ---

const cancelMeetupTool: ToolDefinition = {
  name: "cancel_meetup",
  description:
    "Cancel a previously-booked meetup on the caller's primary calendar. Two-stage flow: call once with date+optional title_hint to LIST candidates (returns events[]); then call again with event_id+confirmed=true to actually delete. The destructive call sends Google cancellation invites to attendees automatically AND clears the busy block from each attendee's bot-side schedule memory (when their email is known). Single-instance only — for recurring series, the caller should cancel from Google Calendar's UI to choose 'this event' vs 'this and following' vs 'all'. Past events: allowed (cleanup). Secondary calendars: not supported (book_meetup only creates on primary).",
  input_schema: {
    type: "object",
    required: ["date"],
    properties: {
      date: { type: "string", description: "YYYY-MM-DD of the meetup to cancel, in caller's timezone." },
      title_hint: { type: "string", description: "Optional case-insensitive substring to filter events by title (e.g. 'football' to skip the dentist appt that's also that day)." },
      event_id: { type: "string", description: "Google Calendar event id, from a previous list call. Required when confirmed=true and there were multiple candidates." },
      confirmed: { type: "boolean", description: "Set true ONLY after showing the caller exactly which event you're about to cancel and getting their explicit yes. Without this, the tool returns a preview/list and DOES NOT delete." },
    },
  },
  async execute(input, ctx): Promise<ToolResult> {
    const date = typeof input.date === "string" ? input.date.trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "date must be YYYY-MM-DD." };
    const titleHint = typeof input.title_hint === "string" ? input.title_hint.trim() : "";
    const eventId = typeof input.event_id === "string" ? input.event_id.trim() : "";
    const confirmed = input.confirmed === true;

    // Always list candidates first — even with event_id we re-fetch to be
    // sure it's still on the calendar and to get its attendees for cleanup.
    const candidates = await findCalendarEventsOnDate(ctx.callerChatId, date, titleHint, resolveCallerTimezone(ctx));
    if (candidates.length === 0) {
      return { error: "not_found", message: `No events on ${date}${titleHint ? ` matching '${titleHint}'` : ""} across the caller's calendars.` };
    }

    // Preview-only call (or ambiguous + no pick).
    if (!confirmed || (candidates.length > 1 && !eventId)) {
      return {
        preview: true,
        date,
        candidates: candidates.map((c) => ({
          event_id: c.id,
          summary: c.summary,
          start_time: c.start_time,
          end_time: c.end_time,
          attendees: c.attendee_emails.length,
        })),
        notes:
          candidates.length > 1
            ? "Multiple events match — show the caller, ask which one to cancel, then call again with event_id + confirmed=true."
            : "Show the caller this event and ask 'cancel it?' before calling again with confirmed=true.",
      };
    }

    // Pick the target. If event_id given, validate it's in the list. If not
    // given (only possible when there's exactly 1 candidate), use that.
    const target = eventId
      ? candidates.find((c) => c.id === eventId)
      : candidates[0];
    if (!target) {
      return {
        error: "stale_event_id",
        message: `event_id ${eventId} no longer matches any event on ${date}. The event may have been deleted or changed; re-list candidates.`,
      };
    }

    // Hard delete — pass the calendar_id so secondary-calendar events
    // delete correctly (findCalendarEventsOnDate now spans all calendars).
    const result = await deleteCalendarEvent(ctx.callerChatId, target.id, target.calendar_id);
    if (result === "not_found") {
      return { error: "already_deleted", message: "Event was already deleted on Google's side. Nothing to do." };
    }
    if (result !== true) {
      return { error: "delete_failed", message: "Google rejected the delete. Try again or remove from Calendar UI." };
    }

    // Clean up bot-side busy blocks. The label format from book_meetup is
    // "meetup: {title}" — match that on the caller's row plus every
    // attendee's row whose email we have on file.
    const labelMatch = `meetup: ${target.summary}`;
    let cleared = 0;
    cleared += await removeBusyBlockFromUser(ctx.callerChatId, date, labelMatch);
    if (target.attendee_emails.length > 0) {
      const attendeeChatIds = await findChatIdsByEmails(target.attendee_emails);
      for (const cid of attendeeChatIds) {
        cleared += await removeBusyBlockFromUser(cid, date, labelMatch);
      }
    }
    // Sync caller's in-turn snapshot.
    if (cleared > 0) {
      const updated = await getLatestScheduleForUser(ctx.callerChatId);
      ctx.snapshot.user = { ...ctx.snapshot.user, latest_schedule_json: updated };
    }

    return {
      ok: true,
      cancelled: { event_id: target.id, summary: target.summary, date, start_time: target.start_time, end_time: target.end_time },
      attendees_notified: target.attendee_emails.length,
      busy_blocks_cleared: cleared,
    };
  },
};

// --- Dispatcher ---

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  parseScheduleTool,
  addOrInvitePartnerTool,
  removePartnerTool,
  computeAndDeliverMatchTool,
  upsertKnowledgeTool,
  addPersonalEventTool,
  removeScheduleEntryTool,
  mirrorToCalendarTool,
  setPersonHiddenTool,
  queryScheduleHistoryTool,
  showScheduleTool,
  showAvailabilityTool,
  sessionActionTool,
  scheduleReminderTool,
  listRemindersTool,
  cancelReminderTool,
  relayMessageTool,
  watchScheduleUploadTool,
  bookMeetupTool,
  cancelMeetupTool,
  replyTool,
];

/** JSON tool schemas in the shape Anthropic's messages API expects. */
export const TOOL_SCHEMAS = TOOL_DEFINITIONS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.input_schema,
}));

/** Look up and execute a tool by name. Returns the structured result the turn handler
 *  serialises into a tool_result block for Claude. Unknown tools return an error. */
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tool = TOOL_DEFINITIONS.find((t) => t.name === name);
  if (!tool) return { error: `Unknown tool: ${name}` };
  try {
    return await tool.execute(input, ctx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Tool '${name}' threw: ${msg}` };
  }
}
